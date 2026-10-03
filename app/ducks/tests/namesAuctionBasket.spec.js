import test from 'tape';

import {
  BID_SUBMISSION_PHASES,
  submitBidManyLifecycle,
} from '../names';
import {AuctionBasket} from '../../pages/AuctionBasket';

const entries = [{name: 'example', bid: 1000000, lockup: 2000000, height: 100}];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function lifecycleDeps(overrides = {}) {
  return {
    findTransactions: async () => [],
    requestPassphrase: async () => {},
    getAuctionInfo: async () => ({}),
    getNameInfo: async () => ({info: {height: 101}}),
    importNames: async () => ({rescanStarted: true}),
    waitForSync: async () => {},
    prepare: async (payload, attemptId) => ({attemptId, txid: 'basket-tx'}),
    cancel: async () => ({cancelled: true, broadcastAttempted: false}),
    broadcastPrepared: async () => ({txid: 'basket-tx'}),
    storeName: async () => {},
    refreshPending: async () => {},
    ...overrides,
  };
}

test('basket rescan completes normally and submission continues exactly once', async t => {
  let auctionChecks = 0;
  let broadcasts = 0;
  let syncWaits = 0;
  let importedRequestId = null;
  let waitedRequestId = null;
  const phases = [];
  const result = await submitBidManyLifecycle(entries, lifecycleDeps({
    getAuctionInfo: async () => {
      auctionChecks++;
      if (auctionChecks === 1) throw new Error('Auction not found.');
      return {};
    },
    importNames: async (names, options) => {
      importedRequestId = options.recoveryRequestId;
      return {rescanStarted: true};
    },
    waitForSync: async options => {
      syncWaits++;
      waitedRequestId = options.recoveryRequestId;
    },
    broadcastPrepared: async () => {
      broadcasts++;
      return {txid: 'normal-rescan-tx'};
    },
  }), {onPhase: phase => phases.push(phase)});

  t.equal(syncWaits, 1, 'waits for the one bulk rescan');
  t.match(importedRequestId, /^[a-f0-9]{32}$/, 'bulk import receives an immutable request token');
  t.equal(waitedRequestId, importedRequestId, 'readiness waits for that exact import token');
  t.equal(broadcasts, 1, 'broadcasts exactly once');
  t.equal(result.txid, 'normal-rescan-tx', 'returns the transaction ID');
  t.deepEqual(phases, [
    BID_SUBMISSION_PHASES.CHECKING,
    BID_SUBMISSION_PHASES.RESCANNING,
    BID_SUBMISSION_PHASES.BUILDING,
    BID_SUBMISSION_PHASES.SIGNING,
    BID_SUBMISSION_PHASES.BROADCASTING,
    BID_SUBMISSION_PHASES.VERIFYING,
    BID_SUBMISSION_PHASES.SUBMITTED,
  ], 'reports explicit lifecycle phases');
  t.end();
});

test('completed rescan is authoritative when the import RPC never resolves', async t => {
  let auctionChecks = 0;
  let broadcasts = 0;
  const never = new Promise(() => {});
  const result = await submitBidManyLifecycle(entries, lifecycleDeps({
    getAuctionInfo: async () => {
      auctionChecks++;
      if (auctionChecks === 1) throw new Error('auction not found');
      return {};
    },
    importNames: () => never,
    waitForSync: async () => {},
    broadcastPrepared: async () => {
      broadcasts++;
      return {txid: 'hung-import-tx'};
    },
  }), {preparationTimeoutMs: 50});

  t.equal(result.txid, 'hung-import-tx', 'continues after observed rescan completion');
  t.equal(broadcasts, 1, 'does not duplicate the submission');
  t.end();
});

test('a delayed 20-name createbatch completes once without using the short request timeout', async t => {
  const twenty = Array.from({length: 20}, (_, index) => ({
    name: `name${index}`,
    bid: 1000000,
    lockup: 2000000,
    height: 100,
  }));
  let prepares = 0;
  let broadcasts = 0;
  const phases = [];
  const result = await submitBidManyLifecycle(twenty, lifecycleDeps({
    prepare: async (payload, attemptId) => {
      prepares++;
      await new Promise(resolve => setTimeout(resolve, 20));
      t.equal(payload.length, 20, 'keeps the supported 20-name transaction');
      return {attemptId, txid: 'delayed-createbatch-tx', timings: {createbatch: 15000}};
    },
    broadcastPrepared: async () => {
      broadcasts++;
      return {txid: 'delayed-createbatch-tx'};
    },
  }), {preparationTimeoutMs: 100, onPhase: phase => phases.push(phase)});

  t.equal(prepares, 1, 'constructs exactly once');
  t.equal(broadcasts, 1, 'broadcasts exactly once');
  t.equal(result.txid, 'delayed-createbatch-tx');
  t.ok(phases.includes(BID_SUBMISSION_PHASES.BUILDING));
  t.ok(phases.includes(BID_SUBMISSION_PHASES.SIGNING));
  t.ok(phases.includes(BID_SUBMISSION_PHASES.VERIFYING));
  t.end();
});

test('createbatch failure before signing is a safe retry without history proof', async t => {
  let historyCalls = 0;
  let broadcasts = 0;
  try {
    await submitBidManyLifecycle(entries, lifecycleDeps({
      findTransactions: async () => { historyCalls++; return []; },
      prepare: async () => {
        const error = new Error('fetch failed while createbatch was running');
        error.code = 'BASKET_BUILD_FAILED';
        throw error;
      },
      broadcastPrepared: async () => { broadcasts++; return {txid: 'unexpected'}; },
    }));
    t.fail('building should fail');
  } catch (error) {
    t.equal(error.stage, BID_SUBMISSION_PHASES.BUILDING);
    t.equal(error.retryAllowed, true);
    t.equal(error.broadcastUncertain, false);
  }
  t.equal(historyCalls, 1, 'history is read only for the initial baseline');
  t.equal(broadcasts, 0, 'sendrawtransaction is never attempted');
  t.end();
});

test('cancelling while createbatch is running prevents a late broadcast', async t => {
  const building = deferred();
  const controller = new AbortController();
  let cancels = 0;
  let broadcasts = 0;
  const submission = submitBidManyLifecycle(entries, lifecycleDeps({
    prepare: () => building.promise,
    cancel: async () => { cancels++; return {cancelled: true, broadcastAttempted: false}; },
    broadcastPrepared: async () => { broadcasts++; return {txid: 'unexpected'}; },
  }), {signal: controller.signal});

  await Promise.resolve();
  controller.abort();
  try {
    await submission;
    t.fail('submission should be cancelled');
  } catch (error) {
    t.equal(error.code, 'BASKET_SUBMISSION_CANCELLED');
  }
  building.resolve({attemptId: 'late', txid: 'late'});
  await Promise.resolve();
  t.ok(cancels >= 1, 'background attempt is explicitly cancelled');
  t.equal(broadcasts, 0, 'late preparation cannot broadcast');
  t.end();
});

test('leaving during preparation cancels continuation without touching the basket', t => {
  const props = {
    order: ['example'],
    items: {example: {name: 'example', bidAmount: '1', blindAmount: '1'}},
    spendableBalance: 10000000,
    network: 'regtest',
    addNamesToBasket() {},
    removeFromBasket() {},
    updateBasketItem() {},
    clearBasket: () => t.fail('basket must not be cleared'),
    sendBidMany() {},
    showError() {},
    showSuccess() {},
    history: {push() {}},
  };
  const component = new AuctionBasket(props);
  component._mounted = true;
  component.state = {...component.state, step: 'review', submissionPhase: 'rescanning'};
  component.setState = patch => { component.state = {...component.state, ...patch}; };
  component.submissionAbortController = new AbortController();

  component.onBackToBasket();

  t.equal(component.state.step, 'edit', 'returns to the editable basket');
  t.ok(component.submissionAbortController.signal.aborted, 'stops renderer waiting');
  t.deepEqual(component.props.items, props.items, 'preserves basket names and values');
  t.end();
});

test('pre-broadcast timeout permits retry because broadcast was structurally impossible', async t => {
  let auctionChecks = 0;
  let broadcasts = 0;
  try {
    await submitBidManyLifecycle(entries, lifecycleDeps({
      getAuctionInfo: async () => {
        auctionChecks++;
        if (auctionChecks === 1) throw new Error('auction not found');
        return {};
      },
      importNames: () => new Promise(() => {}),
      waitForSync: () => new Promise(() => {}),
    broadcastPrepared: async () => { broadcasts++; return {txid: 'unexpected'}; },
    }), {preparationTimeoutMs: 10});
    t.fail('preparation should time out');
  } catch (error) {
    t.equal(error.stage, BID_SUBMISSION_PHASES.RESCANNING, 'identifies the failed stage');
    t.equal(error.retryAllowed, true, 'verified empty history permits retry');
    t.equal(error.broadcastUncertain, false, 'outcome is not ambiguous before broadcast');
  }
  t.equal(broadcasts, 0, 'never constructs or broadcasts after timeout');
  t.end();
});

test('ambiguous broadcast timeout never permits a duplicate retry', async t => {
  let broadcasts = 0;
  try {
    await submitBidManyLifecycle(entries, lifecycleDeps({
    broadcastPrepared: () => {
        broadcasts++;
        return new Promise(() => {});
      },
    }), {broadcastTimeoutMs: 10});
    t.fail('broadcast should time out');
  } catch (error) {
    t.equal(error.stage, BID_SUBMISSION_PHASES.BROADCASTING, 'identifies broadcasting as the stage');
    t.equal(error.retryAllowed, false, 'does not allow a blind retry');
    t.equal(error.broadcastUncertain, true, 'marks the outcome as uncertain');
  }
  t.equal(broadcasts, 1, 'only one broadcast attempt was started');
  t.end();
});

test('returning to edit preserves an ambiguous broadcast safety lock', t => {
  const component = new AuctionBasket({
    order: ['example'],
    items: {example: {name: 'example', bidAmount: '1', blindAmount: '1'}},
    spendableBalance: 10000000,
    network: 'regtest',
    addNamesToBasket() {}, removeFromBasket() {}, updateBasketItem() {}, clearBasket() {},
    sendBidMany() {}, showError() {}, showSuccess() {}, history: {push() {}},
  });
  component._mounted = true;
  component.state = {
    ...component.state,
    step: 'review',
    submissionPhase: 'failed',
    submissionError: 'Broadcast outcome is uncertain.',
    submissionFailedStage: 'broadcasting',
    broadcastUncertain: true,
  };
  component.setState = patch => { component.state = {...component.state, ...patch}; };

  component.onBackToBasket();

  t.equal(component.state.step, 'edit', 'basket remains accessible');
  t.equal(component.state.submissionPhase, 'failed', 'uncertain attempt remains locked');
  t.equal(component.state.broadcastUncertain, true, 'duplicate protection is retained');
  t.end();
});

test('successful broadcast clears the component basket only after a txid is obtained', async t => {
  const broadcast = deferred();
  let clears = 0;
  const component = new AuctionBasket({
    order: ['example'],
    items: {example: {name: 'example', bidAmount: '1', blindAmount: '1'}},
    spendableBalance: 10000000,
    network: 'regtest',
    addNamesToBasket() {},
    removeFromBasket() {},
    updateBasketItem() {},
    clearBasket: () => { clears++; },
    sendBidMany: () => broadcast.promise,
    showError: message => t.fail(message),
    showSuccess() {},
    history: {push() {}},
  });
  component.context = {t: key => key};
  component._mounted = true;
  component.state = {...component.state, step: 'review', accepted: true};
  component.setState = (patch, callback) => {
    component.state = {...component.state, ...patch};
    if (callback) callback();
  };
  component.refreshStatuses = async () => ({
    example: {state: 'BIDDING', height: 100},
  });

  const submission = component.onSubmit();
  await Promise.resolve();
  await Promise.resolve();
  t.equal(clears, 0, 'keeps the basket while no transaction ID exists');

  broadcast.resolve({txid: 'confirmed-component-tx'});
  await submission;
  t.equal(clears, 1, 'clears after the transaction ID is returned');
  t.equal(component.state.submissionTxid, 'confirmed-component-tx', 'retains the transaction ID');
  t.end();
});
