const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const {test} = require('node:test');
const fetch = require('node-fetch');

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
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('Shakedex node-fetch strips credentials across host redirects', async () => {
  assert.equal(require('node-fetch/package.json').version, '2.7.0');

  let forwardedHeaders;
  const destination = http.createServer((request, response) => {
    forwardedHeaders = request.headers;
    response.end('ok');
  });
  const redirect = http.createServer((request, response) => {
    response.writeHead(302, {
      location: `http://destination.invalid:${destinationPort}/capture`,
    });
    response.end();
  });

  let destinationPort;
  try {
    destinationPort = await listen(destination);
    const redirectPort = await listen(redirect);
    const agent = new http.Agent({
      lookup(_hostname, options, callback) {
        if (options && options.all) {
          callback(null, [{address: '127.0.0.1', family: 4}]);
          return;
        }
        callback(null, '127.0.0.1', 4);
      },
    });

    const response = await fetch(`http://origin.invalid:${redirectPort}/redirect`, {
      agent,
      headers: {
        authorization: 'Bearer test-secret',
        'www-authenticate': 'test-challenge',
        cookie: 'session=test-secret',
        cookie2: 'session-2=test-secret',
      },
    });

    assert.equal(await response.text(), 'ok');
    for (const name of ['authorization', 'www-authenticate', 'cookie', 'cookie2']) {
      assert.equal(forwardedHeaders[name], undefined, `${name} must not cross hosts`);
    }
    agent.destroy();
  } finally {
    await Promise.all([close(redirect), close(destination)]);
  }
});

test('Shakedex database backup remains a creation-only tar operation', async () => {
  const {backupDb} = require('shakedex/src/backup.js');
  const tarPath = require.resolve('tar', {
    paths: [require.resolve('shakedex/src/backup.js')],
  });
  const tar = require(tarPath);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bob-shakedex-backup-'));
  const dbPath = path.join(temp, 'wallet.db');
  const archivePath = path.join(temp, 'wallet.db.tgz');

  try {
    await fs.writeFile(dbPath, 'synthetic database fixture');
    await backupDb(dbPath, archivePath);
    const entries = [];
    await tar.t({
      file: archivePath,
      onentry: (entry) => entries.push(entry.path),
    });
    assert.deepEqual(entries, ['wallet.db']);
    assert.equal(await fs.readFile(dbPath, 'utf8'), 'synthetic database fixture');
  } finally {
    await fs.rm(temp, {recursive: true, force: true});
  }
});
