const assert = require('node:assert/strict');
const dgram = require('dgram');
const net = require('net');

const {
  PHASES,
  isChainReady,
  validateResolverContext,
} = require('../contract');
const {SystemDnsController} = require('../controller');
const {createAddonResolverContract} = require('../addonContract');
const {LoopbackDnsBridge} = require('../loopbackBridge');

function dnsPacket(id = 0x1234) {
  const packet = Buffer.alloc(12);
  packet.writeUInt16BE(id, 0);
  packet.writeUInt16BE(0x0100, 2);
  return packet;
}

function responseFor(query) {
  const response = Buffer.from(query);
  response.writeUInt16BE(0x8180, 2);
  return response;
}

function listenUdp(socket, port = 0) {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, '127.0.0.1', () => {
      socket.off('error', reject);
      resolve(socket.address());
    });
  });
}

function listenTcp(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise(resolve => {
    try { server.close(() => resolve()); } catch (error) { resolve(); }
  });
}

function udpQuery(port, query) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('UDP prototype query timed out.'));
    }, 2000);
    socket.once('message', response => {
      clearTimeout(timer);
      socket.close();
      resolve(response);
    });
    socket.once('error', reject);
    socket.send(query, port, '127.0.0.1');
  });
}

function tcpQuery(port, query) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host: '127.0.0.1', port});
    const frame = Buffer.alloc(query.length + 2);
    frame.writeUInt16BE(query.length, 0);
    query.copy(frame, 2);
    let response = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('TCP prototype query timed out.'));
    }, 2000);
    socket.on('connect', () => socket.write(frame));
    socket.on('data', chunk => { response = Buffer.concat([response, chunk]); });
    socket.on('end', () => {
      clearTimeout(timer);
      resolve(response.subarray(2));
    });
    socket.on('error', reject);
  });
}

function readyContext(overrides = {}) {
  return {
    connectionType: 'p2p',
    nodeMode: 'spv',
    network: 'main',
    running: true,
    noDns: false,
    resolverHost: '127.0.0.1',
    resolverPort: 10892,
    chain: {height: 250, bestPeerHeight: 250, progress: 1, synced: true},
    ...overrides,
  };
}

function createHarness({context = readyContext(), probeFailure = null} = {}) {
  const events = [];
  let stored = null;
  const platform = {
    async preflight() { events.push('platform:preflight'); },
    async capture() {
      events.push('platform:capture');
      return [{
        stableId: 'service-wifi',
        displayLabel: 'Wi-Fi',
        previousMode: 'dhcp',
        previousServers: ['192.0.2.53', '192.0.2.54'],
      }];
    },
    async apply(record, address) {
      events.push(`platform:apply:${address.port}`);
      assert.deepEqual(record.targets[0].previousServers, ['192.0.2.53', '192.0.2.54']);
    },
    async rollback(record) {
      events.push(`platform:rollback:${record.targets[0].previousServers.join(',')}`);
    },
    async inspectOwnership() {
      events.push('platform:ownership');
      return {owned: true};
    },
    async restore(record) {
      events.push(`platform:restore:${record.targets[0].previousMode}:${record.targets[0].previousServers.join(',')}`);
    },
    async verifyRestored() { events.push('platform:verify-restored'); },
  };
  const bridge = {
    async start(options) {
      events.push(`bridge:start:${options.upstreamPort}`);
      return {host: '127.0.0.1', port: 15353};
    },
    async stop() { events.push('bridge:stop'); },
  };
  const recordStore = {
    async write(record) {
      stored = JSON.parse(JSON.stringify(record));
      events.push(`record:write:${record.phase}`);
    },
    async read() { return stored && JSON.parse(JSON.stringify(stored)); },
    async clear() { stored = null; events.push('record:clear'); },
  };
  const passing = {hns: true, icann: true, dnssec: true, tcp: true};
  const probe = {
    async direct(endpoint) {
      events.push(`probe:direct:${endpoint.port}`);
      return probeFailure === 'direct' ? {...passing, hns: false} : passing;
    },
    async bridge(endpoint) {
      events.push(`probe:bridge:${endpoint.port}`);
      return probeFailure === 'bridge' ? {...passing, tcp: false} : passing;
    },
    async system() {
      events.push('probe:system');
      return probeFailure === 'system' ? {...passing, icann: false} : passing;
    },
  };
  const controller = new SystemDnsController({
    nodeProvider: {async getResolverContext() { return context; }},
    bridge,
    platform,
    recordStore,
    probe,
    installId: 'test-install',
    platformName: 'darwin',
    helperVersion: '0.0.0-test',
    now: () => '2026-10-02T00:00:00.000Z',
  });
  return {controller, events, platform, bridge, recordStore, getStored: () => stored};
}

async function testContracts() {
  assert.equal(isChainReady({height: 10, bestPeerHeight: 11, synced: true}), false);
  assert.equal(isChainReady({height: 10, bestPeerHeight: 10, synced: true}), true);
  assert.equal(isChainReady({progress: 0.99995}), true);
  assert.equal(validateResolverContext(readyContext()).resolverPort, 10892,
    'uses Bob-published port rather than assuming 9892');
  assert.equal(validateResolverContext(readyContext({nodeMode: 'full'})).nodeMode, 'full');
  assert.throws(
    () => validateResolverContext(readyContext({connectionType: 'custom'})),
    error => error.code === 'ECUSTOMRPC',
  );
  assert.throws(
    () => validateResolverContext(readyContext({resolverHost: '192.0.2.1'})),
    error => error.code === 'EUPSTREAMHOST',
  );
}

async function testControllerSuccessAndExactRestore() {
  const harness = createHarness();
  const enabled = await harness.controller.enable();
  assert.equal(enabled.phase, PHASES.ON);
  assert.equal(enabled.recursivePort, 10892);
  assert.equal(harness.getStored().phase, 'active');
  assert.equal(harness.getStored().targets[0].previousMode, 'dhcp');
  assert.deepEqual(harness.getStored().targets[0].previousServers, ['192.0.2.53', '192.0.2.54']);
  assert(harness.events.indexOf('record:write:pending') < harness.events.indexOf('platform:apply:15353'));

  const disabled = await harness.controller.disable();
  assert.equal(disabled.phase, PHASES.OFF);
  assert(harness.events.includes('platform:restore:dhcp:192.0.2.53,192.0.2.54'));
  assert(harness.events.indexOf('platform:verify-restored') < harness.events.lastIndexOf('bridge:stop'));
  assert.equal(harness.getStored(), null);
}

async function testFailedEnableRollsBack() {
  const harness = createHarness({probeFailure: 'system'});
  await assert.rejects(harness.controller.enable(), error => error.code === 'EPROBE');
  assert(harness.events.includes('platform:rollback:192.0.2.53,192.0.2.54'));
  assert(harness.events.indexOf('platform:rollback:192.0.2.53,192.0.2.54')
    < harness.events.lastIndexOf('bridge:stop'));
  assert.equal(harness.controller.getStatus().phase, PHASES.OFF);
  assert.equal(harness.getStored(), null);
}

async function testOwnershipAndStartupRecovery() {
  const harness = createHarness();
  await harness.controller.enable();
  harness.platform.inspectOwnership = async () => ({owned: false});
  await assert.rejects(harness.controller.disable(), error => error.code === 'EOWNERSHIP');
  assert.equal(harness.controller.getStatus().phase, PHASES.NEEDS_REPAIR);
  assert(harness.getStored(), 'keeps backup when ownership is ambiguous');

  harness.platform.inspectOwnership = async () => ({owned: true});
  const recovered = await harness.controller.reconcileOnStartup();
  assert.equal(recovered.phase, PHASES.OFF);
  assert.equal(harness.getStored(), null);
}

async function testAddonBoundary() {
  const harness = createHarness();
  let approvals = 0;
  let approve = false;
  const request = createAddonResolverContract({
    controller: harness.controller,
    requestCoreConfirmation: async () => { approvals++; return approve; },
  });
  const status = await request('resolver.getStatus');
  assert.equal(Object.hasOwn(status, 'recursivePort'), false, 'does not expose Bob resolver port');
  assert.equal(Object.hasOwn(status, 'activeInterfaces'), false, 'does not expose network identifiers');
  assert.equal(Object.hasOwn(status.lastError || {}, 'message'), false, 'does not expose internal errors');
  assert.equal((await request('resolver.requestEnable')).approved, false);
  assert.equal(harness.events.length, 0, 'denial causes no resolver or platform activity');
  approve = true;
  assert.equal((await request('resolver.requestEnable')).approved, true);
  assert.equal(approvals, 2);
  await assert.rejects(request('resolver.rawHelperCommand'), error => error.code === 'EADDONMETHOD');
}

async function testUnprivilegedLoopbackBridge() {
  const upstreamUdp = dgram.createSocket('udp4');
  upstreamUdp.on('message', (query, peer) => {
    upstreamUdp.send(responseFor(query), peer.port, peer.address);
  });
  const upstreamAddress = await listenUdp(upstreamUdp);
  const upstreamTcp = net.createServer(socket => {
    let data = Buffer.alloc(0);
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length < 2) return;
      const length = data.readUInt16BE(0);
      if (data.length < length + 2) return;
      const response = responseFor(data.subarray(2, length + 2));
      const frame = Buffer.alloc(response.length + 2);
      frame.writeUInt16BE(response.length, 0);
      response.copy(frame, 2);
      socket.end(frame);
    });
  });
  await listenTcp(upstreamTcp, upstreamAddress.port);

  assert.throws(
    () => new LoopbackDnsBridge({listenPort: 53, upstreamPort: upstreamAddress.port}),
    error => error.code === 'EPRIVILEGEDPORT',
  );
  assert.throws(
    () => new LoopbackDnsBridge({upstreamHost: '192.0.2.1', upstreamPort: upstreamAddress.port}),
    error => error.code === 'EUPSTREAM',
  );

  const bridge = new LoopbackDnsBridge({
    listenPort: 0,
    upstreamPort: upstreamAddress.port,
    timeoutMs: 1000,
  });
  try {
    const address = await bridge.start();
    assert(address.port >= 1024, 'uses an unprivileged ephemeral port');
    const query = dnsPacket();
    assert.deepEqual(await udpQuery(address.port, query), responseFor(query));
    assert.deepEqual(await tcpQuery(address.port, query), responseFor(query));
  } finally {
    await bridge.stop();
    await closeServer(upstreamUdp);
    await closeServer(upstreamTcp);
  }
}

(async () => {
  await testContracts();
  await testControllerSuccessAndExactRestore();
  await testFailedEnableRollsBack();
  await testOwnershipAndStartupRecovery();
  await testAddonBoundary();
  await testUnprivilegedLoopbackBridge();
  console.log('System DNS prototype checks passed: Bob port discovery, SPV/full readiness, Custom RPC rejection, exact restore, rollback, ownership repair, add-on isolation, and unprivileged UDP/TCP forwarding.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

