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
  let state;
  let pending;
  let preparedAttempt = null;
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
    async getAuctionInfo(name) {
      if (!names.includes(name)) reject('non-fixture auction');
      return {name, state: 'BIDDING'};
    },
    async findBasketBidTransactions(values) {
      assertNames(values);
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
        if (state.uncertain || state.inertBoundaryCalls) reject('persisted ambiguous duplicate');
        if (pending) reject('overlapping preparation');
        state.preparationCalls += 1;
        preparedAttempt = null;
        await save();
        if (plan.fixtureType === 'auction-retry') {
          const error = new Error('Controlled pre-signing construction failure. Retry is safe; no transaction was created.');
          error.code = 'BASKET_BUILD_FAILED';
          throw error;
        }
        if (plan.fixtureType === 'basket-delayed') {
          delayed = new Promise((resolve, rejectPromise) => {
            const timer = setTimeout(() => {
              pending = null;
              preparedAttempt = attemptId;
              resolve({attemptId, txid: 'inert-fixture-only'});
            }, 10000);
            pending = {attemptId, timer, reject: rejectPromise};
          });
        }
        if (plan.fixtureType === 'basket-ambiguous') preparedAttempt = attemptId;
      });
      return delayed || {attemptId, txid: 'inert-fixture-only'};
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
        await save();
        return {cancelled, broadcastAttempted: false};
      });
    },
    async broadcastPreparedBidMany(attemptId) {
      assertAttempt(attemptId);
      return serialized(async () => {
        await load();
        if (plan.fixtureType !== 'basket-ambiguous' || state.inertBoundaryCalls
            || preparedAttempt !== attemptId) reject('broadcast boundary');
        // This journal is written before returning the inert ambiguous error.
        state.inertBoundaryCalls = 1;
        state.uncertain = true;
        preparedAttempt = null;
        await save();
        const error = new Error('Controlled ambiguous result. No signing or network broadcast occurred; duplicate attempts remain locked.');
        error.code = 'ETXBROADCASTUNCERTAIN';
        throw error;
      });
    },
  } : {};
  return {
    walletMethods,
    nodeMethods: names.length ? {
      async getNameInfo(name) {
        if (!names.includes(name)) reject('non-fixture name');
        return {start: {reserved: false}, info: {state: 'BIDDING', height: 100, stats: {hoursUntilReveal: 10}}};
      },
    } : {},
    initializeRestore() {
      if (plan.fixtureType !== 'restore-history') reject('non-restore initialization');
      if (!restoreInitialization) {
        restoreInitialization = require('./restoreReplay').runControlledRestore(config.scenario)
          .then(result => {restoreEvidence = result; return result;});
      }
      return restoreInitialization;
    },
    async describe() {
      await queue;
      await load();
      return {plan, walletId: 'acceptance-primary', state: {...state}, restoreEvidence, listings: FIXED_LISTINGS,
        packagedStatus: 'NOT TESTED'};
    },
  };
}

function installProductRuntime(config, db, server) {
  if (!config) return;
  runtime = createProductRuntime(config, db);
  server.withService('Acceptance', {describe: runtime.describe});
}

module.exports = {createProductRuntime, installProductRuntime, getProductRuntime: () => runtime};
