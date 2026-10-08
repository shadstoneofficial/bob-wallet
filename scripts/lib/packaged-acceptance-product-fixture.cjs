const Module = require('module');

let productModules;

function loadProductModules() {
  if (productModules) return productModules;

  require('@babel/register')({extensions: ['.js']});
  require.extensions['.scss'] = () => {};

  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {isPackaged: true},
        ipcRenderer: {send() {}, on() {}, off() {}},
      };
    }
    const parentPath = String(parent?.filename || '').replace(/\\/g, '/');
    if (request === '../../utils/i18n' && parentPath.includes('/app/pages/AuctionBasket/')) {
      return {I18nContext: {}};
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const names = require('../../app/ducks/names');
    const walletClient = require('../../app/utils/walletClient').default;
    const nodeClient = require('../../app/utils/nodeClient').default;
    const {basketScope} = require('../../app/utils/basketScope');
    const {GET_PASSPHRASE} = require('../../app/ducks/walletReducer');
    const {AuctionBasket} = require('../../app/pages/AuctionBasket');
    productModules = {AuctionBasket, GET_PASSPHRASE, names, walletClient, nodeClient, basketScope};
    return productModules;
  } finally {
    Module._load = originalLoad;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

async function withWalletMethods(methods, callback) {
  const previousWindow = global.window;
  if (!global.window) global.window = {localStorage: memoryLocalStorage()};
  const {walletClient, nodeClient} = loadProductModules();
  const originalInfo = nodeClient.getNameInfo;
  nodeClient.getNameInfo = async () => ({info: {state: 'BIDDING', height: 101}});
  const originals = new Map();
  for (const [name, method] of Object.entries(methods)) {
    originals.set(name, walletClient[name]);
    walletClient[name] = method;
  }
  try {
    return await callback();
  } finally {
    for (const [name, method] of originals) walletClient[name] = method;
    nodeClient.getNameInfo = originalInfo;
    if (previousWindow === undefined) delete global.window;
  }
}

function basketFixture(plan, walletId) {
  const names = plan.names || [plan.name];
  const items = Object.fromEntries(names.map(name => [name, {
    name,
    bidAmount: '1',
    blindAmount: '1',
  }]));
  const events = {
    cleared: 0,
    errors: [],
    successes: [],
  };
  const props = {
    order: [...names],
    items,
    spendableBalance: Number.MAX_SAFE_INTEGER,
    network: 'regtest',
    walletId,
    watchOnly: false,
    walletType: 'hot',
    addNamesToBasket() {},
    removeFromBasket() {},
    updateBasketItem() {},
    importBasketRows() {},
    clearBasket() { events.cleared += 1; },
    showError(message) { events.errors.push(message); },
    showSuccess(message) { events.successes.push(message); },
    history: {push() {}},
  };
  return {events, items, names, props};
}

function mountBasket(props, sendBidMany) {
  const {AuctionBasket} = loadProductModules();
  const component = new AuctionBasket({...props, sendBidMany});
  component.context = {t: (key, value) => value ? `${key}:${value}` : key};
  component._mounted = true;
  component.state = {...component.state, step: 'review', accepted: true, reviewedScope: component.currentBasketScope()};
  component.setState = (patch, callback) => {
    const next = typeof patch === 'function' ? patch(component.state, component.props) : patch;
    component.state = {...component.state, ...next};
    if (callback) callback();
    // This source-only scripted user approves the newly displayed exact fee.
    // The packaged product still requires its real checkbox/button interaction.
    if (next.transactionScope && component.confirmPrepared) {
      component.state.accepted = true;
      component.onConfirmPrepared();
    }
  };
  component.refreshStatuses = async () => Object.fromEntries(
    props.order.map(name => [name, {state: 'BIDDING', height: 100}]),
  );
  return component;
}

function createProductDispatch(walletId) {
  const {GET_PASSPHRASE} = loadProductModules();
  const getState = () => ({wallet: {wid: walletId, type: 'hot', watchOnly: false}});
  const dispatch = action => {
    if (typeof action === 'function') return action(dispatch, getState);
    if (action?.type === GET_PASSPHRASE) action.payload.resolve();
    return action;
  };
  return {dispatch, getState};
}

function productSendBidMany(walletId) {
  const {names} = loadProductModules();
  const {dispatch, getState} = createProductDispatch(walletId);
  return (entries, options) => names.sendBidMany(entries, options)(dispatch, getState);
}

function baseWalletMethods(overrides = {}) {
  return {
    findBasketBidTransactions: async () => [],
    getAuctionInfo: async () => ({}),
    prepareBidMany: async (payload, attemptId) => ({attemptId, scope: loadProductModules().basketScope(payload, 10000)}),
    signPreparedBidMany: async (attemptId, scope) => ({attemptId, scope, txid: 'ac'.repeat(32)}),
    cancelBidManyAttempt: async () => ({cancelled: true, broadcastAttempted: false}),
    broadcastPreparedBidMany: async () => {
      const error = new Error('Inert acceptance boundary refused broadcast.');
      error.code = 'ETXBROADCASTUNCERTAIN';
      throw error;
    },
    ...overrides,
  };
}

async function runAuctionRetry(plan) {
  const walletId = 'acceptance-auction-retry';
  const fixture = basketFixture(plan, walletId);
  let preparationCalls = 0;
  let cancelCalls = 0;
  let inertBroadcastCalls = 0;

  return withWalletMethods(baseWalletMethods({
    prepareBidMany: async () => {
      preparationCalls += 1;
      const error = new Error('Controlled pre-signing construction failure.');
      error.code = 'BASKET_BUILD_FAILED';
      throw error;
    },
    cancelBidManyAttempt: async () => {
      cancelCalls += 1;
      return {cancelled: true, broadcastAttempted: false};
    },
    broadcastPreparedBidMany: async () => {
      inertBroadcastCalls += 1;
      throw new Error('Unexpected inert broadcast boundary call.');
    },
  }), async () => {
    const component = mountBasket(fixture.props, productSendBidMany(walletId));
    await component.onSubmit();
    const firstFailure = {
      error: component.state.submissionError,
      phase: component.state.submissionPhase,
      failedStage: component.state.submissionFailedStage,
      retryAllowed: component.state.retryAllowed,
      visibleErrors: fixture.events.errors.length,
    };
    component.state = {...component.state, accepted: true};
    await component.onSubmit();
    return {
      productPath: 'AuctionBasket.onSubmit -> sendBidMany -> submitBidManyLifecycle',
      firstFailure,
      retryAttempted: preparationCalls === 2,
      preparationCalls,
      cancelCalls,
      inertBroadcastCalls,
      liveBroadcastCalls: 0,
      basketNamesPreserved: component.props.order.length,
    };
  });
}

async function runDelayedBasket(plan, options = {}) {
  const walletId = options.walletId || 'acceptance-basket-delayed';
  const fixture = basketFixture(plan, walletId);
  const preparation = deferred();
  const preparationStarted = deferred();
  let preparationCalls = 0;
  let cancelCalls = 0;
  let inertBroadcastCalls = 0;

  return withWalletMethods(baseWalletMethods({
    prepareBidMany: (payload, attemptId) => {
      preparationCalls += 1;
      preparationStarted.resolve({attemptId, payload});
      return preparation.promise;
    },
    cancelBidManyAttempt: async () => {
      cancelCalls += 1;
      return {cancelled: true, broadcastAttempted: false};
    },
    broadcastPreparedBidMany: async () => {
      inertBroadcastCalls += 1;
      const error = new Error('Inert acceptance boundary refused broadcast.');
      error.code = 'ETXBROADCASTUNCERTAIN';
      throw error;
    },
  }), async () => {
    const component = mountBasket(fixture.props, productSendBidMany(walletId));
    const submission = component.onSubmit();
    const started = await preparationStarted.promise;
    if (options.mutateCancellationGuard) {
      component.setState({step: 'edit'});
    } else {
      component.onBackToBasket();
    }
    preparation.resolve({attemptId: started.attemptId, scope: loadProductModules().basketScope(started.payload, 10000)});
    await submission;
    return {
      productPath: 'AuctionBasket.onSubmit/onBackToBasket -> sendBidMany -> submitBidManyLifecycle',
      namesSubmitted: started.payload.length,
      namesPreserved: component.props.order.length,
      preparationCalls,
      cancelCalls,
      inertBroadcastCalls,
      liveBroadcastCalls: 0,
      returnedToEdit: component.state.step === 'edit',
      cancellationStopsContinuation: inertBroadcastCalls === 0,
      basketClears: fixture.events.cleared,
    };
  });
}

function memoryLocalStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

async function runAmbiguousBasket(plan) {
  const walletId = 'acceptance-basket-ambiguous';
  const fixture = basketFixture(plan, walletId);
  let preparationCalls = 0;
  let inertBroadcastCalls = 0;
  let historyCalls = 0;
  const previousWindow = global.window;
  global.window = {localStorage: memoryLocalStorage()};

  try {
    return await withWalletMethods(baseWalletMethods({
      findBasketBidTransactions: async () => {
        historyCalls += 1;
        return [];
      },
      prepareBidMany: async (payload, attemptId) => {
        preparationCalls += 1;
        return {attemptId, scope: loadProductModules().basketScope(payload, 10000), payloadCount: payload.length};
      },
      broadcastPreparedBidMany: async () => {
        inertBroadcastCalls += 1;
        const error = new Error('Controlled ambiguous inert boundary.');
        error.code = 'ETXBROADCASTUNCERTAIN';
        throw error;
      },
    }), async () => {
      const send = productSendBidMany(walletId);
      const first = mountBasket(fixture.props, send);
      await first.onSubmit();
      const firstFailure = {
        error: first.state.submissionError,
        failedStage: first.state.submissionFailedStage,
        retryAllowed: first.state.retryAllowed,
        broadcastUncertain: first.state.broadcastUncertain,
        visibleErrors: fixture.events.errors.length,
      };
      first.onBackToBasket();
      first.persistDraft();

      const reused = mountBasket(fixture.props, send);
      reused.loadSavedDraft();
      const persistedLock = reused.state.broadcastUncertain === true
        && reused.state.retryAllowed === false;
      reused.state = {...reused.state, step: 'review', accepted: true};
      await reused.onSubmit();

      return {
        productPath: 'AuctionBasket draft/navigation -> sendBidMany duplicate lock -> submitBidManyLifecycle',
        firstFailure,
        persistedLock,
        duplicateBlockedAfterReuse: reused.state.broadcastUncertain && !reused.state.retryAllowed && preparationCalls === 1,
        preparationCalls,
        inertBroadcastCalls,
        liveBroadcastCalls: 0,
        historyCalls,
        basketNamesPreserved: reused.props.order.length,
      };
    });
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

function createProductFixtureAdapter(options = {}) {
  return {
    runAuctionRetry,
    runDelayedBasket: plan => runDelayedBasket(plan, options),
    runAmbiguousBasket,
  };
}

module.exports = {
  createProductFixtureAdapter,
  runAmbiguousBasket,
  runAuctionRetry,
  runDelayedBasket,
};
