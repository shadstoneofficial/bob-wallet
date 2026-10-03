// Reproduce the packaged SPV startup ordering without opening sockets.
process.env.NODE_BACKEND = 'js';
process.env.BABEL_DISABLE_CACHE = '1';
const watchdog = setTimeout(() => {
  console.error('Fixture exceeded 20 seconds');
  process.exit(1);
}, 20000);
require('@babel/register')({configFile: false, babelrc: false, presets: [['@babel/preset-env', {targets: {node: 'current'}}]]});
const assert = require('node:assert/strict');
const net = require('net');
const dgram = require('dgram');
net.Socket.prototype.connect = net.Server.prototype.listen = () => {throw new Error('Sockets forbidden');};
dgram.createSocket = () => {throw new Error('Sockets forbidden');};
const SPVNode = require('hsd/lib/node/spvnode');
const walletPlugin = require('hsd/lib/wallet/plugin');
const {installLocalRescan} = require('../../app/background/wallet/localRescan');
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  const node = new SPVNode({
    memory: true,
    network: 'regtest',
    workers: false,
    listen: false,
    noDns: true,
    maxOutbound: 1,
  });
  const wallet = node.use(walletPlugin);
  // Exercise node/plugin open and close without binding HTTP or peer sockets.
  node.http.open = async () => {};
  node.http.close = async () => {};
  node.pool.close = async () => {};
  wallet.http.open = async () => {};
  wallet.http.close = async () => {};
  const errors = [];
  node.on('error', error => errors.push(error.message));
  if (!process.argv.includes('--baseline')) installLocalRescan(wallet.wdb, node);

  try {
    await node.open();
    await tick(); await tick();
    if (process.argv.includes('--baseline')) {
      assert(errors.some(message => message.includes('Pool is not connected')),
        `expected the baseline startup assertion; errors=${JSON.stringify(errors)}`);
    } else {
      assert.deepEqual(errors, [], 'WalletDB startup sync is deferred until pool connection');
      assert.equal(wallet.wdb.bobRescanState.status, 'waiting');
      assert.equal(wallet.wdb.bobRescanState.ready, false,
        'pending startup recovery is not exposed as idle or ready');
      // Match NodeService's post-connect handoff without calling Pool.connect,
      // which would open network listeners in this fixture.
      node.pool.connected = true;
      await wallet.wdb.resumeLocalSync();
      assert.deepEqual(errors, [], 'deferred first sync succeeds after local pool readiness');
      assert.equal(wallet.wdb.bobRescanState.status, 'idle');
    }
    console.log(JSON.stringify({
      mode: 'SPV',
      baseline: process.argv.includes('--baseline'),
      errors,
      sockets: 0,
      storage: 'memory',
      recoveredAfterPoolReady: !process.argv.includes('--baseline'),
    }));
  } finally {
    if (node.opened) await node.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => clearTimeout(watchdog));
