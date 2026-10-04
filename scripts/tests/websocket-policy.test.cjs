const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const {test} = require('node:test');
const bsock = require('bsock');
const {NodeClient, WalletClient} = require('hsd/lib/client');
const {
  installHsdWebSocketUpgradePolicies,
} = require('../../app/background/node/websocketPolicy');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function createHsdHTTPFixture() {
  const nodeHTTP = http.createServer();
  const walletHTTP = http.createServer();
  const nodeWebSockets = bsock.server();
  const walletWebSockets = bsock.server();
  nodeWebSockets.attach(nodeHTTP);
  walletWebSockets.attach(walletHTTP);

  for (const websocket of [nodeWebSockets, walletWebSockets]) {
    websocket.on('socket', socket => {
      socket.hook('auth', key => key === 'fixture-api-key');
      socket.hook('watch chain', () => true);
      socket.hook('watch mempool', () => true);
      socket.hook('probe', () => 'authenticated');
    });
  }

  const observedUpgradeEvents = {node: 0, wallet: 0};
  nodeHTTP.on('upgrade', () => observedUpgradeEvents.node++);
  walletHTTP.on('upgrade', () => observedUpgradeEvents.wallet++);

  installHsdWebSocketUpgradePolicies({
    http: {http: nodeHTTP},
    get(name) {
      assert.equal(name, 'walletdb');
      return {http: {http: walletHTTP}};
    },
  });

  return {
    endpoints: [
      {name: 'node', http: nodeHTTP, websocket: nodeWebSockets},
      {name: 'wallet', http: walletHTTP, websocket: walletWebSockets},
    ],
    observedUpgradeEvents,
  };
}

function sendLegacyHixie76Handshake(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let response = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for the unsupported-protocol response.'));
    }, 2000);

    socket.on('connect', () => {
      socket.write([
        'GET /socket.io/?transport=websocket HTTP/1.1',
        'Host: localhost',
        'Upgrade: WebSocket',
        'Connection: Upgrade',
        'Origin: http://localhost',
        'Sec-WebSocket-Key1: 4 @1  46546xW%0l 1 5',
        'Sec-WebSocket-Key2: 12998 5 Y3 1  .P00',
        '',
        '^n:ds[4U',
      ].join('\r\n'));
    });
    socket.on('data', chunk => {
      response += chunk.toString('latin1');
      if (!response.includes('\r\n\r\n')) return;
      clearTimeout(timer);
      socket.destroy();
      resolve(response);
    });
    socket.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function connectBSock(port) {
  const client = bsock.socket();
  client.reconnection = false;

  const connected = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for RFC6455 connect.')), 2000);
    client.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    client.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });

  client.connect(port, '127.0.0.1', false);
  return {client, connected};
}

test('node and wallet HTTP servers reject Hixie-76 before bsock sees the upgrade', async () => {
  const fixture = createHsdHTTPFixture();
  const ports = new Map();

  try {
    for (const endpoint of fixture.endpoints) {
      ports.set(endpoint.name, await listen(endpoint.http));
    }

    for (const endpoint of fixture.endpoints) {
      const response = await sendLegacyHixie76Handshake(ports.get(endpoint.name));
      assert.match(response, /^HTTP\/1\.1 426 Upgrade Required\r\n/);
      assert.match(response, /Sec-WebSocket-Version: 13\r\n/i);
      assert.equal(fixture.observedUpgradeEvents[endpoint.name], 0);
      assert.equal(endpoint.websocket.sockets.size, 0);
    }
  } finally {
    await Promise.all(fixture.endpoints.map(endpoint => close(endpoint.http)));
  }
});

test('node and wallet HTTP servers still accept the supported RFC6455 v13 handshake', async () => {
  const fixture = createHsdHTTPFixture();

  try {
    for (const endpoint of fixture.endpoints) {
      const port = await listen(endpoint.http);
      const {client, connected} = connectBSock(port);
      await connected;
      assert.equal(client.ws.version, 'hybi-13');
      assert.equal(endpoint.websocket.sockets.size, 1);
      client.destroy();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally {
    for (const endpoint of fixture.endpoints) {
      await endpoint.websocket.close();
      await close(endpoint.http);
    }
  }
});

test('HSD node and wallet clients authenticate and make calls through the guarded endpoints', async () => {
  const fixture = createHsdHTTPFixture();

  try {
    for (const endpoint of fixture.endpoints) {
      const port = await listen(endpoint.http);
      const Client = endpoint.name === 'node' ? NodeClient : WalletClient;
      const client = new Client({host: '127.0.0.1', port, password: 'fixture-api-key'});
      const connected = new Promise((resolve, reject) => {
        client.once('connect', resolve);
        client.once('error', reject);
      });

      await client.open();
      await connected;
      assert.equal(await client.call('probe'), 'authenticated');
      await client.close();
    }
  } finally {
    for (const endpoint of fixture.endpoints) {
      await endpoint.websocket.close();
      await close(endpoint.http);
    }
  }
});

test('bsock rejects a malformed RFC6455 response without legacy fallback', async () => {
  let requestVersion;
  const server = http.createServer();
  server.on('upgrade', (request, socket) => {
    requestVersion = request.headers['sec-websocket-version'];
    socket.end([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: intentionally-wrong',
      '',
      '',
    ].join('\r\n'));
  });

  let port;
  let client;
  try {
    port = await listen(server);
    client = bsock.socket();
    client.reconnection = false;
    let connectCount = 0;
    client.on('connect', () => connectCount++);

    const handshakeError = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out validating the malformed response.')), 2000);
      let settled = false;
      client.on('error', error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(error);
      });
    });

    client.connect(port, '127.0.0.1', false);
    const error = await handshakeError;
    assert.equal(requestVersion, '13');
    assert.match(error.message, /Sec-WebSocket-Accept mismatch/);
    assert.equal(connectCount, 0);
  } finally {
    client?.destroy();
    await close(server);
  }
});
