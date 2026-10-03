// Disposable regtest fixture: real hsd Chain/WalletDB/NodeClient; no sockets.
process.env.NODE_BACKEND = 'js';
process.env.BABEL_DISABLE_CACHE = '1';
const watchdog = setTimeout(() => {console.error('Fixture exceeded 20 seconds'); process.exit(1);}, 20000);
require('@babel/register')({configFile: false, babelrc: false, presets: [['@babel/preset-env', {targets: {node: 'current'}}]]});
const {installLocalRescan} = require('../../app/background/wallet/localRescan');
const assert = require('assert/strict');
const net = require('net');
const dgram = require('dgram');
net.Socket.prototype.connect = net.connect = net.createConnection = net.Server.prototype.listen = () => {throw new Error('Sockets forbidden');};
dgram.createSocket = () => {throw new Error('Sockets forbidden');};
const EventEmitter = require('events');
const BlockStore = require('hsd/lib/blockstore/level');
const Chain = require('hsd/lib/blockchain/chain');
const Miner = require('hsd/lib/mining/miner');
const WalletDB = require('hsd/lib/wallet/walletdb');
const NodeClient = require('hsd/lib/wallet/nodeclient');
const WorkerPool = require('hsd/lib/workers/workerpool');
function deferred() {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};}
const tick = () => new Promise(r => setImmediate(r));
async function scenario(count, overlap, fail = false, race = false) {
  const workers = new WorkerPool({enabled: false});
  const blocks = new BlockStore({memory: true, network: 'regtest'});
  const chain = new Chain({memory: true, blocks, network: 'regtest', workers});
  const miner = new Miner({chain, workers});
  const source = new WalletDB({memory: true, network: 'regtest', workers});
  const node = new EventEmitter(); Object.assign(node, {chain, spv: false, pool: {queueFilterLoad() {}, setFilter() {}}, broadcast: async () => {throw new Error("Broadcast forbidden");}});
  const connectReached = deferred(); const releaseConnect = deferred();
  if (race) chain.on("connect", async () => {
    if (chain.height === 21) {connectReached.resolve(); await releaseConnect.promise;}
  });
  const client = new NodeClient(node);
  const wdb = new WalletDB({memory: true, network: 'regtest', workers, client});
  if (!process.argv.includes("--baseline")) installLocalRescan(wdb, node);
  const errors = [];
  wdb.on('error', e => errors.push(e.message));
  try {
    await blocks.open(); await chain.open(); await miner.open(); await source.open(); await tick();
    const keys = []; const addresses = [];
    for (let i = 0; i < count; i++) {
      const wallet = await source.create();
      keys.push(wallet.master.key.toBase58('regtest'));
      addresses.push(await wallet.receiveAddress());
    }
    for (let i = 0; i < 20; i++) {
      miner.addresses.length = 0; miner.addresses.push(addresses[i % count]);
      const job = await miner.cpu.createJob();
      job.refresh(); const block = await job.mineAsync(); await chain.add(block);
    }
    await wdb.open(); await tick();
    // Wait on hsd's own lock so startup synchronization is fully drained.
    const unlock = await wdb.txLock.lock(); unlock();
    assert.equal(wdb.height, 20);
    if (race) {
      await wdb.create({id: 'restore-race', master: keys[0]});
      const job = await miner.cpu.createJob(); job.refresh();
      const block = await job.mineAsync();
      let blockSettled = false; let scanSettled = false;
      const adding = chain.add(block).finally(() => {blockSettled = true;});
      await connectReached.promise; // chain lock is held, before WalletDB delivery.
      const scanning = wdb.rescan(0).finally(() => {scanSettled = true;});
      // Wait until the rescan has reached the actual chain mutex.
      for (let i = 0; i < 100 && chain.locker.jobs.length === 0; i++) await tick();
      assert.equal(chain.locker.jobs.length, 1);
      releaseConnect.resolve();
      for (let i = 0; i < 10; i++) await tick();
      if (!process.argv.includes('--baseline')) {
        await Promise.all([adding, scanning]);
        assert.equal(chain.height, 21); assert.equal(wdb.height, 21);
        assert.equal(wdb.txLock.busy, false); assert.equal(chain.locker.busy, false);
        return {lockCyclePrevented: true, chainHeight: chain.height, walletHeight: wdb.height};
      }
      assert.equal(wdb.txLock.busy, true);
      assert.equal(chain.locker.busy, true);
      assert.equal(wdb.txLock.jobs.length, 1, 'block awaits WalletDB lock');
      assert.equal(chain.locker.jobs.length, 1, 'rescan awaits chain lock');
      assert.equal(blockSettled, false); assert.equal(scanSettled, false);
      console.log(JSON.stringify({confirmedLockCycle: true, chainHeight: chain.height,
        walletHeight: wdb.height, sockets: 0, storage: 'memory'}));
      // Intentional process boundary: both real locks are deadlocked. Never unlock
      // or delete a real database to make this fixture pass.
      process.exit(0);
    }
    const reached = deferred(); const release = deferred();
    let scans = 0; let active = 0; let maxActive = 0;
    const starts = [];
    const originalMethod = client.rescan;
    const originalScan = chain.db.scan.bind(chain.db);
    chain.db.scan = async (hash, filter, iter) => {
      const ordinal = ++scans;
      starts.push((await chain.getEntry(hash)).height);
      active++; maxActive = Math.max(maxActive, active);
      try {
        return await originalScan(hash, filter, async (entry, txs) => {
          if (ordinal === 1 && entry.height === 5) {
            reached.resolve();
            if (overlap) await release.promise;
            if (fail) throw new Error('injected scan failure');
          }
          await iter(entry, txs);
        });
      } finally {active--;}
    };
    const pending = [];
    await wdb.create({id: 'restore-0', master: keys[0]});
    pending.push(wdb.rescan(0).catch(e => e));
    await reached.promise;
    if (overlap) {
      assert.equal(wdb.height, 4);
      for (let i = 1; i < count; i++) {
        await wdb.create({id: `restore-${i}`, master: keys[i]});
        pending.push(wdb.rescan(0).catch(e => e));
      }
      await tick(); assert.equal(scans, 1, 'hsd queues overlaps behind txLock');
      release.resolve();
    } else {
      await pending[0];
      for (let i = 1; i < count; i++) {
        await wdb.create({id: `restore-${i}`, master: keys[i]});
        pending.push(wdb.rescan(0)); await pending[pending.length - 1];
      }
    }
    const results = await Promise.all(pending);
    assert.equal(maxActive, 1);
    assert.equal(wdb.height, 20);
    assert.deepEqual(starts, Array(count).fill(0));
    if (fail) assert.match(results[0].message, /injected/);
    for (let i = 0; i < count; i++) {
      const wallet = await wdb.get(`restore-${i}`);
      const balance = await wallet.getBalance();
      assert(balance.confirmed > 0, 'every restored wallet discovers its coinbase history');
    }
    assert.deepEqual(errors, []);
    assert.equal(client.rescan, originalMethod, "real NodeClient.rescan remains installed");
    return {count, overlap, injectedFailure: fail, scans, maxActive, walletHeight: wdb.height, allWalletHistoriesRecovered: true};
  } finally {
    if (client.opened) await wdb.close(); if (source.client.opened) await source.close(); await miner.close(); await chain.close(); await blocks.close(); await workers.close();
  }
}
(async () => {
  if (process.argv.includes("--lock-cycle")) {
    console.log(JSON.stringify(await scenario(2, true, false, true))); return;
  }
  const results = [];
  for (const args of [[2,true],[5,true],[5,false],[5,true,true]]) results.push(await scenario(...args));
  console.log(JSON.stringify({network:'regtest', storage:'memory', sockets:0, results}, null, 2));
})().catch(e => {console.error(e); process.exitCode = 1;}).finally(() => clearTimeout(watchdog));
