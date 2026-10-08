import test from 'tape';

import {
  BID_SUBMISSION_PHASES,
  submitBidManyLifecycle as runLifecycle,
} from '../names';
import {AuctionBasket} from '../../pages/AuctionBasket';
import {basketScope} from '../../utils/basketScope';

const TXID = 'ab'.repeat(32);
const submitBidManyLifecycle = (rows, deps, options = {}) => runLifecycle(rows, deps, {
  confirmScope: async scope => scope,
  ...options,
});

const entries = [{name: 'basket-fixture', bid: 1000000, lockup: 2000000, height: 100}];

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
    getNameInfo: async () => ({info: {height: 101, state: 'BIDDING'}}),
    importNames: async () => ({rescanStarted: true}),
    waitForSync: async () => {},
    prepare: async (payload, attemptId) => ({attemptId, scope: basketScope(payload, 21600)}),
    signPrepared: async (attemptId, scope) => ({attemptId, txid: TXID, scope}),
    cancel: async () => ({cancelled: true, broadcastAttempted: false}),
    broadcastPrepared: async () => ({txid: TXID}),
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
      return {txid: TXID};
    },
  }), {onPhase: phase => phases.push(phase)});

  t.equal(syncWaits, 1, 'waits for the one bulk rescan');
  t.match(importedRequestId, /^[a-f0-9]{32}$/, 'bulk import receives an immutable request token');
  t.equal(waitedRequestId, importedRequestId, 'readiness waits for that exact import token');
  t.equal(broadcasts, 1, 'broadcasts exactly once');
  t.equal(result.txid, TXID, 'returns the transaction ID');
  t.deepEqual(phases, [
    BID_SUBMISSION_PHASES.CHECKING,
    BID_SUBMISSION_PHASES.RESCANNING,
    BID_SUBMISSION_PHASES.BUILDING,
    BID_SUBMISSION_PHASES.REVIEWING,
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
      return {txid: TXID};
    },
  }), {preparationTimeoutMs: 50});

  t.equal(result.txid, TXID, 'continues after observed rescan completion');
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
      return {attemptId, scope: basketScope(payload, 21600), timings: {createbatch: 15000}};
    },
    broadcastPrepared: async () => {
      broadcasts++;
      return {txid: TXID};
    },
  }), {preparationTimeoutMs: 100, onPhase: phase => phases.push(phase)});

  t.equal(prepares, 1, 'constructs exactly once');
  t.equal(broadcasts, 1, 'broadcasts exactly once');
  t.equal(result.txid, TXID);
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
    order: ['basket-fixture'],
    items: {'basket-fixture': {name: 'basket-fixture', bidAmount: '1', blindAmount: '1'}},
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
    order: ['basket-fixture'],
    items: {'basket-fixture': {name: 'basket-fixture', bidAmount: '1', blindAmount: '1'}},
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
    order: ['basket-fixture'],
    items: {'basket-fixture': {name: 'basket-fixture', bidAmount: '1', blindAmount: '1'}},
    spendableBalance: 10000000,
    network: 'regtest',
    addNamesToBasket() {},
    removeFromBasket() {},
    updateBasketItem() {},
    clearBasket: () => { clears++; },
    sendBidMany: async (rows, options) => {
      await options.confirmScope(basketScope(rows, 21600));
      return broadcast.promise;
    },
    showError: message => t.fail(message),
    showSuccess() {},
    history: {push() {}},
  });
  component.context = {t: key => key};
  component._mounted = true;
  component.state = {...component.state, step: 'review', accepted: true, reviewedScope: basketScope(entries)};
  component.setState = (patch, callback) => {
    component.state = {...component.state, ...patch};
    if (callback) callback();
  };
  component.refreshStatuses = async () => ({
    'basket-fixture': {state: 'BIDDING', height: 100},
  });

  const submission = component.onSubmit();
  await Promise.resolve();
  await Promise.resolve();
  t.equal(clears, 0, 'keeps the basket while no transaction ID exists');
  t.equal(component.state.accepted, false, 'actual fee requires new explicit approval');
  component.state.accepted = true;
  component.onConfirmPrepared();
  broadcast.resolve({txid: TXID, scope: basketScope(entries, 21600)});
  await submission;
  t.equal(clears, 1, 'clears after the transaction ID is returned');
  t.equal(component.state.submissionTxid, TXID, 'retains the transaction ID');
  t.end();
});

const twoNames = [
  {name: 'harm', bid: 2400000000, lockup: 5000000000, height: 100},
  {name: 'backrub', bid: 50000000, lockup: 300000000, height: 100},
];

test('long rescan and final review precede unlocking; construction and broadcast occur once', async t => {
  let locked = false;
  let imported = false;
  const events = [];
  await submitBidManyLifecycle(twoNames, lifecycleDeps({
    getAuctionInfo: async () => {if (!imported) throw new Error('auction not found');},
    importNames: async () => {imported = true;},
    waitForSync: async () => {locked = true; events.push('rescan');},
    prepare: async (payload, attemptId) => {
      t.equal(locked, true, 'unsigned construction works after the unlock lease expired');
      events.push('construct');
      return {attemptId, scope: basketScope(payload, 21600)};
    },
    requestPassphrase: async () => {events.push('unlock'); locked = false;},
    signPrepared: async (attemptId, scope) => {
      t.equal(locked, false, 'fresh unlock immediately precedes signing');
      events.push('sign');
      return {attemptId, scope, txid: TXID};
    },
    broadcastPrepared: async () => {events.push('broadcast'); return {txid: TXID};},
  }), {confirmScope: async scope => {events.push('approve exact fee'); return scope;}});
  t.deepEqual(events, ['rescan', 'construct', 'approve exact fee', 'unlock', 'sign', 'broadcast']);
  t.end();
});

test('deadline crossing during rescan or final review stops the entire original basket', async t => {
  for (const expiresAt of ['rescan', 'review', 'unlock']) {
    let expired = false;
    let imported = false;
    let signs = 0;
    let broadcasts = 0;
    try {
      await submitBidManyLifecycle(twoNames, lifecycleDeps({
        getAuctionInfo: async () => {if (!imported) throw new Error('auction not found');},
        importNames: async () => {imported = true;},
        waitForSync: async () => {expired = expiresAt === 'rescan';},
        requestPassphrase: async () => {expired = expiresAt === 'unlock';},
        getNameInfo: async name => ({info: {state: expired && name === 'backrub' ? 'REVEAL' : 'BIDDING'}}),
        signPrepared: async () => {signs++;},
        broadcastPrepared: async () => {broadcasts++;},
      }), {confirmScope: async scope => {expired = expiresAt === 'review'; return scope;}});
      t.fail('expired scope must not submit');
    } catch (error) {
      t.equal(error.code, 'BASKET_SCOPE_CHANGED', expiresAt);
      t.match(error.message, /backrub/);
      t.equal(error.broadcastUncertain, false);
    }
    t.equal(signs, 0);
    t.equal(broadcasts, 0, 'harm alone is never silently sent');
  }
  t.end();
});

test('subset construction or a modified final approval cannot reach signing', async t => {
  for (const kind of ['subset', 'fee', 'no-approval']) {
    let signs = 0;
    let broadcasts = 0;
    try {
      await runLifecycle(twoNames, lifecycleDeps({
        prepare: async (rows, attemptId) => ({attemptId, scope: basketScope(kind === 'subset' ? rows.slice(0, 1) : rows, 21600)}),
        signPrepared: async () => {signs++;},
        broadcastPrepared: async () => {broadcasts++;},
      }), {confirmScope: kind === 'no-approval' ? undefined : async scope => ({...scope, fee: scope.fee + 1})});
      t.fail(kind);
    } catch (error) {
      t.equal(error.code, 'BASKET_SCOPE_CHANGED', kind);
    }
    t.equal(signs, 0);
    t.equal(broadcasts, 0);
  }
  t.end();
});

test('an unrelated history transaction or mismatched returned txid never counts as basket success', async t => {
  for (const kind of ['history', 'wrong-id']) {
    let historyCalls = 0;
    try {
      await submitBidManyLifecycle(twoNames, lifecycleDeps({
        findTransactions: async () => ++historyCalls === 1 ? [] : [{txid: 'cd'.repeat(32)}],
        broadcastPrepared: async () => {
          if (kind === 'history') throw new Error('connection lost');
          return {txid: 'cd'.repeat(32)};
        },
      }));
      t.fail('must stay uncertain');
    } catch (error) {
      t.equal(error.retryAllowed, false, kind);
      t.equal(error.broadcastUncertain, true);
      t.equal(error.txid, TXID, 'retain the exact candidate ID for reconciliation');
    }
  }
  t.end();
});

test('history failure after a broadcast response without an ID remains retry locked', async t => {
  let queries = 0;
  try {
    await submitBidManyLifecycle(twoNames, lifecycleDeps({
      broadcastPrepared: async () => ({}),
      findTransactions: async () => {
        if (++queries === 1) return [];
        throw new Error('fixture history unavailable');
      },
    }));
    t.fail('missing acceptance evidence');
  } catch (error) {
    t.equal(error.broadcastUncertain, true);
    t.equal(error.retryAllowed, false);
    t.equal(error.txid, TXID);
  }
  t.end();
});

test('wallet switching does not persist the previous wallet receipt over the next draft', t => {
  const component = new AuctionBasket({walletId: 'wallet-b', network: 'regtest', order: [], items: {}});
  component._mounted = true;
  component.state = {...component.state, submissionPhase: 'broadcasting', broadcastUncertain: true,
    submissionTxid: TXID};
  let persisted = 0;
  let loaded = 0;
  component.persistDraft = () => {persisted++;};
  component.loadSavedDraft = () => {loaded++;};
  component.setState = (patch, callback) => {
    const previous = component.state;
    component.state = {...component.state, ...patch};
    component.componentDidUpdate(component.props, previous);
    callback?.();
  };
  component.componentDidUpdate({...component.props, walletId: 'wallet-a'}, component.state);
  t.equal(persisted, 0, 'never writes A safety state to B');
  t.equal(loaded, 1, 'reads B persisted safety state');
  t.equal(component.state.submissionTxid, '', 'no stale receipt from A');
  t.equal(component.state.submissionPhase, 'idle');
  t.end();
});

test('cancellation during exact review prevents late approval from signing or sending', async t => {
  const review = deferred();
  const controller = new AbortController();
  let signs = 0;
  let broadcasts = 0;
  const pending = submitBidManyLifecycle(twoNames, lifecycleDeps({
    signPrepared: async () => {signs++;}, broadcastPrepared: async () => {broadcasts++;},
  }), {signal: controller.signal, confirmScope: () => {controller.abort(); return review.promise;}});
  try {await pending; t.fail('cancel');} catch (error) {t.equal(error.code, 'BASKET_SUBMISSION_CANCELLED');}
  review.resolve(basketScope(twoNames, 21600));
  await Promise.resolve();
  t.equal(signs, 0);
  t.equal(broadcasts, 0);
  t.end();
});

test('expired retry and signing failures preserve both original basket entries and their values', async t => {
  for (const kind of ['expired-retry', 'sign-failed']) {
    let submissions = 0;
    const items = {
      harm: {bidAmount: '2400', blindAmount: '2600'},
      backrub: {bidAmount: '50', blindAmount: '250'},
    };
    const original = JSON.stringify(items);
    const component = new AuctionBasket({
      order: ['harm', 'backrub'], items, spendableBalance: 10000000000,
      walletId: 'disposable', network: 'regtest', walletType: 'standard',
      clearBasket: () => t.fail('must retain basket'), removeFromBasket: () => t.fail('must retain rows'),
      showError() {}, showSuccess: () => t.fail('no success'),
      sendBidMany: async () => {
        submissions++;
        const error = new Error('The wallet locked before signing. No transaction was sent.');
        Object.assign(error, {code: 'BASKET_SIGN_FAILED', stage: 'signing', retryAllowed: true});
        throw error;
      },
    });
    component.context = {t: key => key};
    component._mounted = true;
    component.state = {...component.state, accepted: true, step: 'review', reviewedScope: basketScope(twoNames)};
    component.setState = patch => {component.state = {...component.state, ...patch};};
    component.refreshStatuses = async () => ({harm: {state: 'BIDDING'}, backrub: {state: kind === 'expired-retry' ? 'REVEAL' : 'BIDDING'}});
    await component.onSubmit();
    t.equal(submissions, kind === 'expired-retry' ? 0 : 1);
    t.equal(JSON.stringify(component.props.items), original, 'all amounts retained');
    t.equal(component.state.accepted, false, 'original confirmation is invalidated');
    t.equal(component.state.submissionRows[1].status, kind === 'expired-retry' ? 'expired' : 'failed');
  }
  t.end();
});

test('the UI persists uncertainty before broadcast and a late success cannot erase a stale basket', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const values = new Map();
  Object.defineProperty(window, 'localStorage', {configurable: true, value: {
    getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
  }});
  const broadcast = deferred();
  let boundary = 0;
  let clears = 0;
  const props = {
    order: ['harm', 'backrub'],
    items: {harm: {bidAmount: '2400', blindAmount: '2600'}, backrub: {bidAmount: '50', blindAmount: '250'}},
    spendableBalance: 10000000000, walletId: 'disposable', network: 'regtest',
    clearBasket: () => {clears++;}, showError: message => t.fail(message), showSuccess() {},
    sendBidMany: async (rows, options) => {
      await options.confirmScope(basketScope(rows, 21600));
      options.onPhase('broadcasting', {txid: TXID});
      t.equal(JSON.parse(values.get(component.getDraftKey())).formState.broadcastUncertain, true, 'durable lock precedes the boundary');
      boundary++;
      return broadcast.promise;
    },
  };
  const component = new AuctionBasket(props);
  component.context = {t: key => key}; component._mounted = true;
  component.state = {...component.state, accepted: true, step: 'review', reviewedScope: basketScope(twoNames)};
  component.setState = patch => {component.state = {...component.state, ...patch};};
  component.refreshStatuses = async () => ({harm: {state: 'BIDDING'}, backrub: {state: 'BIDDING'}});
  try {
    const pending = component.onSubmit();
    await Promise.resolve(); await Promise.resolve();
    component.state.accepted = true; component.onConfirmPrepared();
    await Promise.resolve(); await Promise.resolve();
    t.equal(boundary, 1);
    component.componentWillUnmount();
    broadcast.resolve({txid: TXID, scope: basketScope(twoNames, 21600)});
    await pending;
    t.equal(clears, 0, 'unmounted completion cannot clear any basket');
    const reopened = new AuctionBasket({...props, items: {...props.items, harm: {bidAmount: '2401', blindAmount: '2600'}}});
    reopened.context = component.context; reopened._mounted = true;
    reopened.setState = patch => {reopened.state = {...reopened.state, ...patch};};
    reopened.loadSavedDraft();
    t.equal(reopened.state.broadcastUncertain, true, 'editing amounts cannot bypass the persisted uncertainty lock');
    t.equal(reopened.state.retryAllowed, false);
  } finally {
    if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    else delete window.localStorage;
  }
  t.end();
});
