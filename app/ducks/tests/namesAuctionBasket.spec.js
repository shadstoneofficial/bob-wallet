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
    broadcast: async () => ({txid: 'basket-tx'}),
    storeName: async () => {},
    refreshPending: async () => {},
    ...overrides,
  };
}

test('basket rescan completes normally and submission continues exactly once', async t => {
  let auctionChecks = 0;
  let broadcasts = 0;
  let syncWaits = 0;
  const phases = [];
  const result = await submitBidManyLifecycle(entries, lifecycleDeps({
    getAuctionInfo: async () => {
      auctionChecks++;
      if (auctionChecks === 1) throw new Error('Auction not found.');
      return {};
    },
    waitForSync: async () => { syncWaits++; },
    broadcast: async () => {
      broadcasts++;
      return {txid: 'normal-rescan-tx'};
    },
  }), {onPhase: phase => phases.push(phase)});

  t.equal(syncWaits, 1, 'waits for the one bulk rescan');
  t.equal(broadcasts, 1, 'broadcasts exactly once');
  t.equal(result.txid, 'normal-rescan-tx', 'returns the transaction ID');
  t.deepEqual(phases, [
    BID_SUBMISSION_PHASES.PREPARING,
    BID_SUBMISSION_PHASES.RESCANNING,
    BID_SUBMISSION_PHASES.BROADCASTING,
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
    broadcast: async () => {
      broadcasts++;
      return {txid: 'hung-import-tx'};
    },
  }), {preparationTimeoutMs: 50});

  t.equal(result.txid, 'hung-import-tx', 'continues after observed rescan completion');
  t.equal(broadcasts, 1, 'does not duplicate the submission');
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

test('pre-broadcast timeout permits retry only after history verifies no transaction', async t => {
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
      broadcast: async () => { broadcasts++; return {txid: 'unexpected'}; },
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
      broadcast: () => {
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
