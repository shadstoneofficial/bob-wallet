const assert = require('assert');
const crypto = require('crypto');
const {EventEmitter} = require('events');
const BlockStore = require('hsd/lib/blockstore/level');
const Chain = require('hsd/lib/blockchain/chain');
const Miner = require('hsd/lib/mining/miner');
const WalletDB = require('hsd/lib/wallet/walletdb');
const NodeClient = require('hsd/lib/wallet/nodeclient');
const WorkerPool = require('hsd/lib/workers/workerpool');
const {installLocalRescan} = require('../wallet/localRescan');

const JOURNAL_KEY = Buffer.from('ff626f622d72657363616e2d7631', 'hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
const journal = async wdb => {
  const raw = await wdb.db.get(JOURNAL_KEY);
  return raw ? JSON.parse(raw.toString('utf8')).requests : [];
};

// No Node, sockets, relay, caller-supplied seed, or production database is used.
// Only generated coinbases are mined; the native replay/lock/journal code is real.
async function runControlledRestore(scenario) {
  if (!['restore-spv', 'restore-full'].includes(scenario)) {
    throw new Error('Restore fixture requires a fixed restore scenario.');
  }
  const spvMode = scenario === 'restore-spv';
  const workers = new WorkerPool({enabled: false});
  const blocks = new BlockStore({memory: true, network: 'regtest'});
  const full = new Chain({memory: true, blocks, network: 'regtest', workers});
  const chain = spvMode ? new Chain({memory: true, spv: true, network: 'regtest', workers}) : full;
  const miner = new Miner({chain: full, workers});
  const source = new WalletDB({memory: true, network: 'regtest', workers});
  const forbidden = () => {throw new Error('Restore fixture forbids signing and relay.');};
  const node = new EventEmitter();
  Object.assign(node, {chain, spv: spvMode, network: chain.network,
    pool: {setFilter() {}, queueFilterLoad() {}},
    relay: forbidden, relayClaim: forbidden, relayAirdrop: forbidden, broadcast: forbidden});
  chain.on('reset', tip => node.emit('reset', tip));
  const errors = [];
  const checkpoints = [];
  let wdb;
  const makeWalletDB = database => {
    const value = new WalletDB({memory: true, network: 'regtest', spv: spvMode,
      workers, client: new NodeClient(node)});
    if (database) value.db = database;
    value.on('error', error => errors.push(error.message));
    installLocalRescan(value, node);
    return value;
  };
  const checkpoint = async label => {
    checkpoints.push({label, chainHeight: chain.height, walletHeight: wdb.height,
      status: wdb.bobRescanState.status, target: wdb.bobRescanState.target,
      ready: wdb.bobRescanState.ready, pendingJournalEntries: (await journal(wdb)).length});
  };
  const restart = async () => {
    const database = wdb.db;
    const unlock = await wdb.txLock.lock(); unlock();
    await wdb.close();
    chain.removeAllListeners('connect');
    chain.removeAllListeners('disconnect');
    chain.removeAllListeners('full');
    node.removeAllListeners('reset');
    node.removeAllListeners('tx');
    wdb = makeWalletDB(database);
    await wdb.open(); await tick(); await wdb.syncNode();
  };
  const waitComplete = async () => {
    for (let i = 0; i < 100 && !wdb.bobRescanState.ready; i++) await tick();
    assert.equal(wdb.bobRescanState.ready, true);
    assert.equal((await journal(wdb)).length, 0);
  };
  try {
    await blocks.open(); await full.open();
    if (spvMode) await chain.open();
    await miner.open(); await source.open(); await tick();
    const masters = [];
    const addresses = [];
    const history = [];
    for (let i = 0; i < 5; i++) {
      const wallet = await source.create();
      masters.push(wallet.master.key.toBase58('regtest'));
      addresses.push(await wallet.receiveAddress());
    }
    for (let i = 0; i < 20; i++) {
      miner.addresses.length = 0; miner.addresses.push(addresses[i % addresses.length]);
      const job = await miner.cpu.createJob(); job.refresh();
      const block = await job.mineAsync();
      await full.add(block);
      if (spvMode) await chain.add(block);
      history.push(block);
    }
    wdb = makeWalletDB();
    await wdb.open(); await tick(); await wdb.syncNode();
    assert.equal(wdb.height, 20);

    const balances = [];
    let overlapRejections = 0;
    let overlapCompletions = 0;
    let failureObserved = false;
    for (let i = 0; i < 5; i++) {
      const id = `restore-fixed-${i}`;
      await wdb.create({id, master: masters[i]});
      const requestId = crypto.randomBytes(16).toString('hex');
      if (spvMode && i === 0) {
        const originalReset = chain._reset;
        chain._reset = async () => {throw new Error('Fixed injected restore reset failure.');};
        try {await wdb.rescan(0, {requestId});}
        catch (error) {
          assert.match(error.message, /Fixed injected/);
          failureObserved = true;
        } finally {chain._reset = originalReset;}
        assert(failureObserved);
        assert.equal((await journal(wdb)).length, 1);
        await checkpoint('failed-reset-journal-retained');
        await restart();
        await checkpoint('failed-reset-recovered-after-walletdb-reopen');
      } else if (!spvMode && i === 0) {
        const originalScan = chain.db.scan;
        chain.db.scan = async function(hash, filter, iter) {
          return originalScan.call(this, hash, filter, async (entry, txs) => {
            if (entry.height === 5) throw new Error('Fixed injected restore scan failure.');
            await iter(entry, txs);
          });
        };
        try {await wdb.rescan(0, {requestId});}
        catch (error) {
          assert.match(error.message, /Fixed injected/);
          failureObserved = true;
        } finally {chain.db.scan = originalScan;}
        assert(failureObserved);
        assert.equal((await journal(wdb)).length, 1);
        await checkpoint('failed-scan-journal-retained');
        await restart();
        await checkpoint('failed-scan-recovered-after-walletdb-reopen');
      } else {
        await wdb.rescan(0, {requestId});
      }
      if (spvMode) {
        if (i === 0) {
          const overlaps = await Promise.allSettled(Array.from({length: 5}, () => wdb.rescan(0)));
          for (const result of overlaps) {
            assert.equal(result.status, 'rejected');
            assert.match(result.reason.message, /not ready/);
            overlapRejections++;
          }
          for (const block of history.slice(0, 5)) await chain.add(block);
          assert.equal(wdb.height, 5);
          assert.equal((await journal(wdb)).length, 1);
          await checkpoint('partial-replay-journal-retained');
          await restart();
          assert.equal(wdb.bobRescanState.target, 20);
          assert.equal(wdb.bobRescanState.ready, false);
          await checkpoint('partial-replay-walletdb-reopened');
        }
        for (const block of history.slice(chain.height)) await chain.add(block);
      }
      await waitComplete();
      const balance = await (await wdb.get(id)).getBalance();
      assert(balance.confirmed > 0);
      balances.push({walletId: id, confirmed: balance.confirmed});
      await checkpoint(`restored-wallet-${i}`);
    }
    if (!spvMode) {
      await Promise.all(Array.from({length: 5}, (_, index) =>
        wdb.rescan(0, {requestId: crypto.createHash('md5').update(`fixed-overlap-${index}`).digest('hex')})
          .then(() => {overlapCompletions++;})));
      await waitComplete();
      assert.equal(overlapCompletions, 5);
      assert.equal(chain.locker.busy, false);
      assert.equal(wdb.txLock.busy, false);
      await checkpoint('five-overlapping-scans-completed');
    }
    assert.deepEqual(errors, []);
    const result = {status: 'SOURCE REVIEWED REPLAY PASSED', scenario,
      storage: 'memory', source: 'actual-generated-hsd-regtest-coinbases',
      reviewedAdapter: 'installLocalRescan', balances, checkpoints,
      sequentialRestores: balances.length, overlapRejections, overlapCompletions,
      failureObserved, pendingJournalEntries: (await journal(wdb)).length,
      walletHeight: wdb.height, chainHeight: chain.height, sockets: 0,
      signingCalls: 0, liveBroadcastCalls: 0,
      restartCoverage: 'WalletDB close/reopen over its retained real database; not an OS crash or fsync test',
      packagedBackendStatus: 'NOT TESTED'};
    return result;
  } finally {
    if (wdb?.client.opened) await wdb.close();
    if (source.client.opened) await source.close();
    await miner.close();
    if (spvMode) await chain.close();
    await full.close(); await blocks.close(); await workers.close();
  }
}

module.exports = {runControlledRestore};
