const assert = require('assert');
const crypto = require('crypto');
const Block = require('hsd/lib/primitives/block');
const BlockStore = require('hsd/lib/blockstore/level');
const Chain = require('hsd/lib/blockchain/chain');
const Miner = require('hsd/lib/mining/miner');
const WorkerPool = require('hsd/lib/workers/workerpool');
const {assertAcceptanceHsdDirectory} = require('./policy');
const STATE_KEY = 'acceptance-embedded-restore-v1';
const JOURNAL_KEY = Buffer.from('ff626f622d72657363616e2d7631', 'hex');
const WALLET_IDS = ['acceptance-primary', 'acceptance-secondary',
  'acceptance-restore-03', 'acceptance-restore-04', 'acceptance-restore-05'];
const BLOCK_ALLOCATION = [8, 5, 4, 2, 1];
const BLOCK_WALLET_INDEXES = BLOCK_ALLOCATION.flatMap((count, index) => Array(count).fill(index));
assert.strictEqual(BLOCK_WALLET_INDEXES.length, 20);
const waitForDisk = () => new Promise(resolve => setTimeout(resolve, 10));

async function initializeEmbeddedRestore(services, config) {
  assert(['restore-full', 'restore-spv', 'restore-overlap'].includes(config.scenario), 'Fixed restore scenario required.');
  const nodeService = services.node?.service;
  const walletService = services.wallet?.service;
  assert(nodeService?.hsd && walletService?.node?.wdb,
    'Embedded restore requires the isolated NodeService/WalletService profile.');
  assertAcceptanceHsdDirectory(config.userData, await nodeService.getDir());
  const node = nodeService.hsd;
  const wdb = walletService.node.wdb;
  assert.strictEqual(wdb, node.get('walletdb').wdb, 'Fixture wallets must belong to the embedded node.');
  assert.strictEqual(node.network.type, 'regtest');
  const chain = node.chain;
  const pending = async () => {
    const raw = await wdb.db.get(JOURNAL_KEY);
    return raw ? JSON.parse(raw.toString('utf8')).requests : [];
  };
  const balances = async () => Promise.all(WALLET_IDS.map(async walletId => {
    const wallet = await wdb.get(walletId);
    assert(wallet, 'Selectable generated wallet missing.');
    const account = await wallet.getAccount('default');
    const balance = (await wallet.getBalance(account.accountIndex)).getJSON();
    const history = await wallet.getHistory();
    const spendable = balance.unconfirmed - balance.lockedUnconfirmed;
    assert([balance.confirmed, balance.unconfirmed, balance.lockedUnconfirmed, spendable]
      .every(amount => Number.isSafeInteger(amount) && amount >= 0),
    'Generated wallet must have a coherent nonnegative balance snapshot.');
    return {walletId, confirmed: balance.confirmed, unconfirmed: balance.unconfirmed,
      lockedUnconfirmed: balance.lockedUnconfirmed, spendable, historyCount: history.length};
  }));
  let state = await services.db.get(STATE_KEY);
  if (!state) {
    assert.strictEqual(chain.height, 0, 'Only a fresh disposable chain may generate fixture history.');
    const addresses = [];
    for (const id of WALLET_IDS) addresses.push(await (await wdb.get(id)).receiveAddress());
    const workers = new WorkerPool({enabled: false});
    const blocks = node.spv ? new BlockStore({memory: true, network: 'regtest'}) : null;
    const miningChain = node.spv ? new Chain({memory: true, blocks, network: 'regtest', workers}) : chain;
    const miner = node.spv ? new Miner({chain: miningChain, workers}) : node.miner;
    const history = [];
    try {
      if (node.spv) {await blocks.open(); await miningChain.open(); await miner.open();}
      for (let i = 0; i < 20; i++) {
        miner.addresses.length = 0; miner.addresses.push(addresses[BLOCK_WALLET_INDEXES[i]]);
        const job = await miner.cpu.createJob(); job.refresh();
        const block = await job.mineAsync();
        assert.strictEqual(block.txs.length, 1, 'Only a generated coinbase is permitted.');
        assert(block.txs[0].isCoinbase());
        if (node.spv) await miningChain.add(block);
        await chain.add(block);
        history.push(block.toRaw().toString('hex'));
      }
    } finally {
      if (node.spv) {await miner.close(); await miningChain.close(); await blocks.close();}
      await workers.close();
    }
    const expected = await balances();
    assert(expected.every(value => value.confirmed > 0 && value.historyCount > 0));
    assert(expected[0].confirmed > expected[1].confirmed,
      'Disposable primary wallet must have a distinct larger balance.');
    state = {version: 1, scenario: config.scenario, phase: 'generated', target: 20,
      requestId: crypto.randomBytes(16).toString('hex'), history, expected};
    await services.db.put(STATE_KEY, state);
  }
  assert.strictEqual(state.scenario, config.scenario);
  assert.strictEqual(state.version, 1);
  assert.strictEqual(state.target, 20);
  assert.match(state.requestId, /^[a-f0-9]{32}$/);
  assert(['generated', 'paused', 'complete'].includes(state.phase));
  assert(Array.isArray(state.history) && state.history.length === 20);
  assert(state.history.every(raw => typeof raw === 'string' && /^[a-f0-9]+$/.test(raw)));
  assert.deepStrictEqual(state.expected.map(value => value.walletId), WALLET_IDS);
  const snapshot = async phase => ({status: phase, scenario: config.scenario,
    facility: 'embedded-NodeService-WalletService', requestId: state.requestId,
    target: state.target, height: wdb.height, backendState: {...wdb.bobRescanState},
    recoveryAdmissionClosed: walletService.recoveryAdmission.isBusy(),
    pendingRequestIds: (await pending()).map(request => request.requestId), balances: await balances(),
    overlapEvidence: state.overlapEvidence || null,
    rawSigningAllowed: false, liveBroadcastCalls: 0, packagedBackendStatus: 'NOT TESTED'});
  if (state.phase === 'generated') {
    if (node.spv) {
      await wdb.rescan(0, {requestId: state.requestId});
      if (config.scenario === 'restore-overlap') {
        assert(walletService.recoveryAdmission.isBusy());
        const overlaps = await Promise.allSettled(Array.from({length: 5}, () => walletService.rescan(0)));
        assert(overlaps.every(result => result.status === 'rejected' && /not ready/.test(result.reason.message)));
        await assert.rejects(
          walletService.importSeed('acceptance-overlap', '', 'phrase', '', 1, 1, 0),
          {code: 'WALLET_RECOVERY_BUSY'},
        );
        await assert.rejects(walletService.importNames([{name: 'acceptance-overlap', height: 0}]),
          {code: 'WALLET_RECOVERY_BUSY'});
        assert(!await wdb.get('acceptance-overlap'));
        state.overlapEvidence = {rescanRejections: overlaps.length,
          importSeedAdmissionRejected: true, importNamesAdmissionRejected: true,
          noExtraWallet: true, backend: 'actual-WalletService-admission',
          importSeedContentsRead: false, liveBroadcastCalls: 0};
        await services.db.put(STATE_KEY, state);
      }
      for (const raw of state.history.slice(0, 5)) await chain.add(Block.fromRaw(Buffer.from(raw, 'hex')));
    } else {
      const originalScan = chain.db.scan;
      chain.db.scan = async function(hash, filter, iter) {
        return originalScan.call(this, hash, filter, async (entry, txs) => {
          await iter(entry, txs);
          if (entry.height === 5) throw new Error('Fixed acceptance pause: quit and reuse this disposable profile.');
        });
      };
      let paused = false;
      try {await wdb.rescan(0, {requestId: state.requestId});}
      catch (error) {assert.match(error.message, /Fixed acceptance pause/); paused = true;}
      finally {chain.db.scan = originalScan;}
      assert(paused);
    }
    assert.strictEqual(wdb.height, 5);
    assert((await pending()).some(request => request.requestId === state.requestId && request.target === 20));
    assert(walletService.recoveryAdmission.isBusy());
    state.phase = 'paused';
    await services.db.put(STATE_KEY, state);
    return snapshot('EMBEDDED REPLAY PAUSED FOR DISPOSABLE QUIT/REUSE');
  }
  if (state.phase === 'paused' && node.spv) {
    assert.strictEqual(wdb.bobRescanState.target, 20);
    assert.strictEqual(wdb.bobRescanState.ready, false);
    assert(walletService.recoveryAdmission.isBusy());
    assert((await pending()).some(request => request.requestId === state.requestId));
    for (const raw of state.history.slice(chain.height)) await chain.add(Block.fromRaw(Buffer.from(raw, 'hex')));
  }
  const deadline = Date.now() + 10000;
  while ((!wdb.bobRescanState.ready || (await pending()).length > 0
      || walletService.recoveryAdmission.isBusy()) && Date.now() < deadline) {
    await waitForDisk();
  }
  assert.strictEqual(wdb.height, 20);
  assert.strictEqual(wdb.bobRescanState.ready, true);
  assert.strictEqual((await pending()).length, 0);
  assert.strictEqual(walletService.recoveryAdmission.isBusy(), false);
  assert.deepStrictEqual(await balances(), state.expected);
  state.phase = 'complete';
  await services.db.put(STATE_KEY, state);
  return snapshot('EMBEDDED REPLAY COMPLETE');
}

module.exports = {initializeEmbeddedRestore, WALLET_IDS, BLOCK_ALLOCATION, BLOCK_WALLET_INDEXES, STATE_KEY};
