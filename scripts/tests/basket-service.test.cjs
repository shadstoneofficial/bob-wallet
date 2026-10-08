const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
process.env.NODE_BACKEND = 'js';
require('@babel/register')({configFile: false, babelrc: false,
  presets: [['@babel/preset-env', {targets: {node: 'current'}}]]});
const {parseSync} = require('@babel/core');
const {Output} = require('hsd/lib/primitives');
const {types, hashName, blind} = require('hsd/lib/covenants/rules');
const {basketScope, assertBasketScope, assertBasketEligibility, basketScopeError} = require('../../app/utils/basketScope');
const {reconcileBasketOutputs} = require('../../app/background/wallet/basketValidation');
const {WalletMutationCoordinator, broadcastAndRecord, reserveTransactionInputs} = require('../../app/background/wallet/transactionSafety');
const source = fs.readFileSync(path.join(__dirname, '../../app/background/wallet/service.js'), 'utf8');
const ast = parseSync(source, {configFile: false, babelrc: false, parserOpts: {plugins: ['classProperties']}});
const walletClass = ast.program.body.find(node => node.type === 'ClassDeclaration' && node.id.name === 'WalletService');
const rows = [{name: 'harm', bid: 2400000000, lockup: 5000000000},
  {name: 'backrub', bid: 50000000, lockup: 300000000}];
const txid = 'aa'.repeat(32);
const deferred = () => {let resolve; const promise = new Promise(res => {resolve = res;}); return {resolve, promise};};

function fixture() {
  const counts = {construct: 0, sign: 0, broadcast: 0, locks: 0, reserved: 0};
  const values = new Map();
  class FakeMTX {
    constructor() {
      this.inputs = [{prevout: {}}];
      this.outputs = rows.map((row, index) => {
        const nonce = Buffer.alloc(32, index + 1);
        const commitment = blind(row.bid, nonce);
        values.set(commitment.toString('hex'), {value: row.bid, nonce});
        const out = new Output(); out.value = row.lockup;
        out.covenant.type = types.BID;
        out.covenant.pushHash(hashName(Buffer.from(row.name, 'ascii')));
        out.covenant.pushU32(100); out.covenant.push(Buffer.from(row.name, 'ascii'));
        out.covenant.pushHash(commitment);
        return out;
      });
      this.fee = 21600;
    }
    hasCoins() {return true;}
    getFee() {return this.fee;}
    txid() {return txid;}
    hash() {return Buffer.from(txid, 'hex');}
    toTX() {return this;}
    toHex() {return 'fixture-only';}
    check() {}
    sign() {assert(wallet.master.key, 'signing needs fresh unlock'); counts.sign++;}
  }
  let expired = false;
  const wallet = {
    master: {encrypted: true, key: null},
    wdb: {height: 120}, network: {type: 'regtest'},
    getNameState: async () => ({height: 100, isBidding: () => !expired}),
    getBlind: async hash => values.get(hash.toString('hex')),
    getPath: async () => ({account: 0}),
    deriveInputs: async () => [{}],
    lockCoin: () => {counts.reserved++;}, unlockCoin: () => {counts.reserved--;},
    getTX: async () => ({fixture: true}),
  };
  const service = {
    name: 'disposable', networkName: 'regtest', walletSelectionGeneration: 0, rescanBackendGeneration: 0,
    preparedBidManyAttempts: new Map(), walletMutationCoordinator: new WalletMutationCoordinator(),
    node: {wdb: {get: async () => wallet, addTX: async () => {}}},
    nodeService: {getDir: async () => '/unused-disposable-fixture',
      getNameInfo: async () => ({info: {state: expired ? 'REVEAL' : 'BIDDING'}}),
      broadcastRawTx: async (_, options = {}) => {options.assertCurrent?.(); counts.broadcast++;}},
    client: {lock: async () => {counts.locks++; wallet.master.key = null;}},
    getWalletInfo: async () => ({watchOnly: false}), getAccountInfo: async () => ({type: 'pubkeyhash'}),
    parseMtx: async (_, mtx) => ({mtx, metadata: {inputs: []}}),
    _executeTransactionRPC: async method => {assert.equal(method, 'createbatch'); counts.construct++; return new FakeMTX();},
    _setBasketSubmissionProgress() {}, _recordBasketTiming: () => 0,
  };
  const bindings = {basketScope, assertBasketScope, assertBasketEligibility, basketScopeError,
    reconcileBasketOutputs, reserveTransactionInputs, broadcastAndRecord, MTX: FakeMTX,
    hashName, crypto: require('node:crypto'), ONE_MINUTE: 60000, TRANSACTION_TIMEOUT_MS: 120000,
    Script: {hashType: {ALL: 1}}, PRIVATE_KEY_ERROR_MESSAGE: 'No private key available.',
    displayBalance: value => value / 1e6,
    storageHealth: {preflight: async () => {}, reportError() {}}};
  // Execute the actual source method bodies, with all I/O dependencies injected.
  // Do not import the service singleton or start Electron/HSD/real profile stores.
  for (const name of ['_normalizeBidManyActions', 'prepareBidMany', 'signPreparedBidMany',
    'cancelBidManyAttempt', 'broadcastPreparedBidMany', '_discardBidMany', '_assertBidManyCurrent',
    '_validateBidManyEligibility', '_walletProxy', '_walletProxyUnchecked']) {
    const node = walletClass.body.body.find(node => node.key.name === name);
    const factory = new Function(...Object.keys(bindings), `return function(){ return (${source.slice(node.value.start, node.value.end)}); };`);
    service[name] = factory(...Object.values(bindings)).call(service);
  }
  const quote = () => service.prepareBidMany(rows, `basket-${counts.construct}-abc`, {walletId: 'disposable', network: 'regtest'});
  const cleanup = () => {for (const attempt of service.preparedBidManyAttempts.values()) service._discardBidMany(attempt);};
  return {service, wallet, counts, quote, cleanup, expire: () => {expired = true;}};
}

test('actual service quotes while locked, refuses expired unlock, then signs/broadcasts exact scope once', async () => {
  const f = fixture();
  try {
    const first = await f.quote();
    assert.deepEqual(first.scope, basketScope(rows, 21600));
    assert.equal(f.counts.sign, 0);
    await assert.rejects(f.service.signPreparedBidMany(first.attemptId, first.scope), {code: 'BASKET_SIGN_FAILED'});
    assert.equal(f.counts.broadcast, 0);
    const second = await f.quote();
    f.wallet.master.key = {fixture: true};
    const signed = await f.service.signPreparedBidMany(second.attemptId, second.scope);
    assert.equal(signed.txid, txid);
    const result = await f.service.broadcastPreparedBidMany(second.attemptId);
    assert.deepEqual(result.scope, second.scope);
    assert.equal(f.counts.sign, 1);
    assert.equal(f.counts.broadcast, 1);
    assert.equal(f.counts.reserved, 0);
    await assert.rejects(f.service.broadcastPreparedBidMany(second.attemptId), {code: 'BASKET_DUPLICATE_BLOCKED'});
  } finally {f.cleanup();}
});

test('actual service rejects subset construction, changed fees and expired names before signing', async () => {
  for (const scenario of ['subset', 'fee', 'expired', 'wallet']) {
    const f = fixture();
    try {
      if (scenario === 'subset') {
        const create = f.service._executeTransactionRPC;
        f.service._executeTransactionRPC = async () => {const mtx = await create('createbatch'); mtx.outputs.pop(); return mtx;};
        await assert.rejects(f.quote(), {code: 'BASKET_SCOPE_CHANGED'});
      } else {
        const quote = await f.quote(); f.wallet.master.key = {fixture: true};
        if (scenario === 'fee') f.service.preparedBidManyAttempts.get(quote.attemptId).mtx.fee++;
        if (scenario === 'expired') f.expire();
        if (scenario === 'wallet') f.service.walletSelectionGeneration++;
        await assert.rejects(f.service.signPreparedBidMany(quote.attemptId, quote.scope), {code: 'BASKET_SCOPE_CHANGED'});
      }
      assert.equal(f.counts.sign, 0, scenario);
      assert.equal(f.counts.broadcast, 0, scenario);
    } finally {f.cleanup();}
  }
});

test('actual service blocks a deadline crossing after signing and duplicate broadcast calls', async () => {
  for (const expires of [true, false]) {
    const f = fixture();
    try {
      const quote = await f.quote(); f.wallet.master.key = {fixture: true};
      await f.service.signPreparedBidMany(quote.attemptId, quote.scope);
      if (expires) f.expire();
      const first = f.service.broadcastPreparedBidMany(quote.attemptId);
      const rejection = expires ? assert.rejects(first, {code: 'BASKET_PREBROADCAST_FAILED'}) : first;
      await assert.rejects(f.service.broadcastPreparedBidMany(quote.attemptId), {code: 'BASKET_DUPLICATE_BLOCKED'});
      await rejection;
      assert.equal(f.counts.broadcast, expires ? 0 : 1);
    } finally {f.cleanup();}
  }
});

test('actual service retains the coordinator until asynchronous relock finishes', async () => {
  const f = fixture(); const lock = deferred(); const locking = deferred();
  try {
    const quote = await f.quote(); f.wallet.master.key = {fixture: true};
    f.service.client.lock = async () => {locking.resolve(); await lock.promise;};
    const sign = f.service.signPreparedBidMany(quote.attemptId, quote.scope);
    await locking.promise;
    let nextStarted = false;
    const next = f.service.walletMutationCoordinator.run(async () => {nextStarted = true;});
    await Promise.resolve();
    assert.equal(nextStarted, false, 'next operation cannot race a pending wallet lock');
    lock.resolve(); await sign; await next;
    assert.equal(nextStarted, true);
  } finally {lock.resolve(); f.cleanup();}
});

test('actual service cancellation while constructing forbids late approval/broadcast', async () => {
  const f = fixture(); const construction = deferred(); const started = deferred();
  try {
    const original = f.service._executeTransactionRPC;
    f.service._executeTransactionRPC = async () => {started.resolve(); await construction.promise; return original('createbatch');};
    const pending = f.quote();
    const rejected = assert.rejects(pending, {code: 'BASKET_SCOPE_CHANGED'});
    await started.promise;
    await f.service.cancelBidManyAttempt('basket-0-abc');
    construction.resolve(); await rejected;
    assert.equal(f.counts.sign, 0); assert.equal(f.counts.broadcast, 0); assert.equal(f.counts.reserved, 0);
  } finally {construction.resolve(); f.cleanup();}
});

test('awaited relock cannot mask an accepted transaction with a retryable cleanup error', async () => {
  const f = fixture();
  try {
    const quote = await f.quote();
    const mtx = f.service.preparedBidManyAttempts.get(quote.attemptId).mtx;
    f.wallet.master.key = {fixture: true};
    f.service.client.lock = async () => {throw new Error('fixture relock failure');};
    f.service.refreshWalletInfo = async () => {};
    const result = await f.service._walletProxy(() => mtx);
    assert.equal(result.txid(), txid);
    assert.equal(f.counts.broadcast, 1);
  } finally {f.cleanup();}
});

test('wallet switch during asynchronous broadcast preflight cannot reach the transport', async () => {
  const f = fixture(); const preflight = deferred(); const started = deferred();
  try {
    const quote = await f.quote(); f.wallet.master.key = {fixture: true};
    await f.service.signPreparedBidMany(quote.attemptId, quote.scope);
    f.service.nodeService.broadcastRawTx = async (_, {assertCurrent}) => {
      started.resolve(); await preflight.promise;
      assertCurrent(); f.counts.broadcast++;
    };
    const pending = f.service.broadcastPreparedBidMany(quote.attemptId);
    const rejected = assert.rejects(pending, {code: 'BASKET_PREBROADCAST_FAILED'});
    await started.promise;
    f.service.walletSelectionGeneration++;
    preflight.resolve(); await rejected;
    assert.equal(f.counts.broadcast, 0);
    assert.equal(f.counts.reserved, 0);
  } finally {preflight.resolve(); f.cleanup();}
});
