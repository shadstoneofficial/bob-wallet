const {buildControlledScenarioPlan} = require('./scenarios');
const {FIXED_LISTINGS} = require('./data');

let runtime = null;
const STATE_KEY = 'acceptance-fixed-product-state-v1';

function reject(message) {
  const error = new Error(`Controlled acceptance fixture refused ${message}.`);
  error.code = 'ERR_PACKAGED_ACCEPTANCE_POLICY';
  throw error;
}

function createProductRuntime(config, db) {
  const plan = buildControlledScenarioPlan(config.scenario);
  const names = plan.names || (plan.name ? [plan.name] : []);
  const registration = plan.fixtureType.startsWith('register-')
    ? require('./registerRuntime').createRegisterRuntime(plan, db) : null;
  let state;
  let pending;
  let walletService;
  let preparedAttempt = null;
  let approvedAttempt = null;
  const fixedScope = () => ({
    rows: names.map(name => ({name, bid: 1000000, blind: 1000000, lockup: 2000000})),
    totalBid: names.length * 1000000, totalBlind: names.length * 1000000,
    totalLockup: names.length * 2000000, fee: 10000, transactionCount: 1,
  });
  let restoreEvidence = null;
  let restoreInitialization = null;
  let queue = Promise.resolve();
  const serialized = callback => {
    const result = queue.then(callback);
    queue = result.catch(() => {});
    return result;
  };
  const load = async () => {
    if (!state) {
      state = await db.get(STATE_KEY) || {
        scenario: config.scenario, preparationCalls: 0, cancellationCalls: 0,
        inertBoundaryCalls: 0, uncertain: false, liveBroadcastCalls: 0,
        controlStep: 0, selectedWallet: 'acceptance-primary', historyLookupCalls: 0,
        backendGuardRejections: 0,
      };
      if (state.scenario !== config.scenario) reject('profile scenario change');
    }
    return state;
  };
  const save = () => db.put(STATE_KEY, state);
  const assertNames = values => {
    if (!Array.isArray(values) || values.length !== names.length
        || values.some((value, index) => value !== names[index])) reject('non-fixture basket');
  };
  const assertAttempt = value => {
    if (typeof value !== 'string' || !/^basket-[0-9]+-[a-f0-9]+$/.test(value)) reject('invalid attempt');
  };
  const walletMethods = names.length ? {
    async getPendingTransactions() {return [];},
    async getAuctionInfo(name) {
      if (!names.includes(name)) reject('non-fixture auction');
      await load();
      return {name, state: plan.fixtureType === 'basket-expired' && state.controlStep === 1 && name === names[0]
        ? 'CLOSED' : 'BIDDING'};
    },
    async findBasketBidTransactions(values) {
      assertNames(values);
      await load();
      state.historyLookupCalls += 1;
      await save();
      if (!state.inertBoundaryCalls) return [];
      if (plan.fixtureType === 'basket-reconcile-exact') return [{txid: 'ac'.repeat(32)}];
      if (plan.fixtureType === 'basket-reconcile-wrong') return [{txid: 'bd'.repeat(32)}];
      return [];
    },
    async prepareBidMany(payload, attemptId) {
      assertAttempt(attemptId);
      if (!Array.isArray(payload)) reject('non-fixture basket');
      if (payload.some(row => !row || typeof row !== 'object')) reject('non-fixture rows');
      assertNames(payload.map(row => row.name));
      const exactAmount = (value, expected) => value === expected || value === String(expected);
      if (payload.some(row => !exactAmount(row.bid, 1000000)
          || !exactAmount(row.lockup, 2000000))) reject('non-fixture amounts');
      let delayed;
      await serialized(async () => {
        await load();
        if (state.uncertain || state.inertBoundaryCalls) reject('persisted inert boundary duplicate');
        if (pending) reject('overlapping preparation');
        if (plan.fixtureType === 'basket-expired' && state.controlStep) reject('expired reviewed name');
        if (plan.fixtureType === 'basket-wallet-switch' && !walletService) reject('missing disposable wallet service');
        state.preparationCalls += 1;
        preparedAttempt = null;
        approvedAttempt = null;
        await save();
        if (plan.fixtureType === 'auction-retry') {
          const error = new Error('Controlled pre-signing construction failure. Retry is safe; no transaction was created.');
          error.code = 'BASKET_BUILD_FAILED';
          throw error;
        }
        if (plan.fixtureType === 'basket-delayed' || plan.fixtureType === 'basket-wallet-switch') {
          const backendAttempt = plan.fixtureType === 'basket-wallet-switch' ? {
            cancelled: false, node: walletService.node, walletId: walletService.name,
            selectionGeneration: walletService.walletSelectionGeneration,
            backendGeneration: walletService.rescanBackendGeneration,
          } : null;
          delayed = new Promise((resolve, rejectPromise) => {
            const timer = setTimeout(async () => {
              pending = null;
              if (backendAttempt) {
                try {walletService._assertBidManyCurrent(backendAttempt);}
                catch (error) {
                  state.backendGuardRejections = (state.backendGuardRejections || 0) + 1;
                  await save();
                  rejectPromise(error);
                  return;
                }
              }
              preparedAttempt = attemptId;
              resolve({attemptId, scope: fixedScope()});
            }, 10000);
            pending = {attemptId, timer, reject: rejectPromise};
          });
        }
        if (plan.fixtureType === 'basket-ambiguous' || plan.fixtureType.startsWith('basket-reconcile-')) {
          preparedAttempt = attemptId;
        }
      });
      return delayed || {attemptId, scope: fixedScope()};
    },
    async signPreparedBidMany(attemptId, scope) {
      assertAttempt(attemptId);
      return serialized(async () => {
        await load();
        if (preparedAttempt !== attemptId || approvedAttempt || state.uncertain
            || JSON.stringify(scope) !== JSON.stringify(fixedScope())) reject('unreviewed scope');
        // Approval marker only: no keys, signatures or wallet methods are used.
        approvedAttempt = attemptId;
        return {attemptId, scope: fixedScope(), txid: 'ac'.repeat(32), inert: true};
      });
    },
    async cancelBidManyAttempt(attemptId) {
      assertAttempt(attemptId);
      return serialized(async () => {
        await load();
        state.cancellationRequests = (state.cancellationRequests || 0) + 1;
        const cancelled = pending?.attemptId === attemptId || preparedAttempt === attemptId;
        if (cancelled) state.cancellationCalls += 1;
        if (pending?.attemptId === attemptId) {
          clearTimeout(pending.timer);
          const error = new Error('Controlled construction cancelled before signing.');
          error.code = 'BASKET_SUBMISSION_CANCELLED';
          pending.reject(error);
          pending = null;
        }
        if (preparedAttempt === attemptId) preparedAttempt = null;
        if (approvedAttempt === attemptId) approvedAttempt = null;
        await save();
        return {cancelled, broadcastAttempted: false};
      });
    },
    async broadcastPreparedBidMany(attemptId) {
      assertAttempt(attemptId);
      return serialized(async () => {
        await load();
        if (!['basket-ambiguous', 'basket-delayed', 'basket-reconcile-exact', 'basket-reconcile-wrong'].includes(plan.fixtureType) || state.inertBoundaryCalls
            || preparedAttempt !== attemptId || approvedAttempt !== attemptId) reject('broadcast boundary');
        // Journal either inert outcome before returning; never sign or relay.
        state.inertBoundaryCalls = 1;
        state.uncertain = plan.fixtureType === 'basket-ambiguous' || plan.fixtureType.startsWith('basket-reconcile-');
        if (!state.uncertain) state.inertTxid = 'ac'.repeat(32);
        preparedAttempt = null;
        approvedAttempt = null;
        await save();
        if (!state.uncertain) return {txid: state.inertTxid, scope: fixedScope(), inert: true};
        const error = new Error('Controlled ambiguous result. No signing or network broadcast occurred; duplicate attempts remain locked.');
        error.code = 'ETXBROADCASTUNCERTAIN';
        throw error;
      });
    },
  } : {};
  return {
    walletMethods: {...walletMethods, ...registration?.walletMethods},
    async attachWalletService(service) {
      await load();
      if (service?.networkName !== 'regtest' || service.node?.wdb?.network?.type !== 'regtest'
          || typeof service.setWallet !== 'function'
          || typeof service._assertBidManyCurrent !== 'function') reject('non-disposable wallet service');
      if (service.name !== state.selectedWallet) {
        const switching = ['basket-wallet-switch', 'register-wallet-switch'].includes(plan.fixtureType);
        if (!switching || !['acceptance-primary', 'acceptance-secondary'].includes(state.selectedWallet)) {
          reject('unexpected disposable wallet selection');
        }
        service.setWallet(state.selectedWallet);
      }
      if (service.name !== state.selectedWallet) reject('disposable wallet selection was not restored');
      walletService = service;
      if (registration) await registration.attachWalletService(service);
    },
    nodeMethods: names.length ? {
      async getNameInfo(name) {
        if (!names.includes(name)) reject('non-fixture name');
        await load();
        const expired = plan.fixtureType === 'basket-expired' && state.controlStep === 1 && name === names[0];
        return {start: {reserved: false}, info: {state: expired ? 'CLOSED' : 'BIDDING', height: 100,
          stats: {hoursUntilReveal: expired ? 0 : 10}}};
      },
    } : {},
    async advance(...args) {
      if (typeof args[args.length - 1] === 'function') args.pop();
      if (args.length) reject('caller-controlled transition arguments');
      return serialized(async () => {
        await load();
        const switching = ['basket-wallet-switch', 'register-wallet-switch'].includes(plan.fixtureType);
        const oneStep = ['basket-expired', 'basket-scope-mismatch',
          'register-reconcile-exact', 'register-reconcile-wrong'].includes(plan.fixtureType);
        if ((!switching && !oneStep) || state.controlStep >= (switching ? 2 : 1)) {
          reject('unsupported or repeated fixture transition');
        }
        const nextStep = state.controlStep + 1;
        if (switching) {
          if (!walletService) reject('missing disposable wallet service');
          const next = nextStep === 1 ? 'acceptance-secondary' : 'acceptance-primary';
          const previousGeneration = walletService.walletSelectionGeneration;
          walletService.setWallet(next);
          if (walletService.name !== next || walletService.walletSelectionGeneration <= previousGeneration) {
            reject('wallet service did not change selection generation');
          }
          state.selectedWallet = next;
        }
        state.controlStep = nextStep;
        await save();
        return {controlStep: state.controlStep, selectedWallet: state.selectedWallet};
      });
    },
    initializeRestore(services) {
      if (plan.fixtureType !== 'restore-history') reject('non-restore initialization');
      if (!restoreInitialization) {
        const replay = services
          ? require('./embeddedRestore').initializeEmbeddedRestore(services, config)
          : require('./restoreReplay').runControlledRestore(config.scenario);
        restoreInitialization = replay
          .then(result => {restoreEvidence = result; return result;});
      }
      return restoreInitialization;
    },
    async describe() {
      await queue;
      await load();
      return {plan, walletId: state.selectedWallet || 'acceptance-primary', state: {...state},
        backendSelectionGeneration: walletService?.walletSelectionGeneration ?? null,
        registration: registration ? await registration.describe() : null,
        restoreEvidence, listings: FIXED_LISTINGS, packagedStatus: 'NOT TESTED'};
    },
  };
}

function installProductRuntime(config, db, server) {
  if (!config) return;
  runtime = createProductRuntime(config, db);
  server.withService('Acceptance', {describe: runtime.describe, advance: runtime.advance});
}

module.exports = {createProductRuntime, installProductRuntime, getProductRuntime: () => runtime};
