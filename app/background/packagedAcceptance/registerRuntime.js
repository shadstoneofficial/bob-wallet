const {RegisterAllJournal} = require('../wallet/registerAll');
const crypto = require('crypto');

const STATE_KEY = 'acceptance-register-state-v1';
const JOURNAL_PREFIX = 'acceptance-register-journal:';

function createRegisterRuntime(plan, db) {
  if (!plan.fixtureType.startsWith('register-') || plan.network !== 'regtest') {
    throw new Error('Register All fixture requires a fixed regtest scenario.');
  }
  const walletId = 'acceptance-primary';
  let state;
  let delay;
  const journal = new RegisterAllJournal({
    get: key => db.get(`${JOURNAL_PREFIX}${key}`),
    put: (key, value) => db.put(`${JOURNAL_PREFIX}${key}`, value),
  });
  const load = async () => {
    if (!state) state = await db.get(STATE_KEY) || {scenario: plan.scenario,
      constructionCalls: 0, inertBoundaryCalls: 0, liveBroadcastCalls: 0,
      signatureCalls: 0, acceptedNames: [], injectedFailure: false};
    if (state.scenario !== plan.scenario) throw new Error('Cannot change a disposable registration scenario.');
    return state;
  };
  const save = () => db.put(STATE_KEY, state);
  const check = (context, requireId = false) => {
    if (context?.network !== 'regtest' || context?.walletId !== walletId
        || (requireId && !/^[a-zA-Z0-9-]{1,100}$/.test(context.operationId || ''))) {
      throw new Error('Controlled Register All fixture refused non-fixture context.');
    }
  };
  const walletMethods = {
    async getRegisterAllStatus(context) {
      check(context);
      // Deliberately negative evidence: absence cannot release uncertainty.
      return journal.status(context, async () => false);
    },
    async cancelRegisterAll(context) {
      check(context, true);
      const cancelled = journal.cancel(context);
      if (delay?.operationId === context.operationId) {
        clearTimeout(delay.timer);
        delay.resolve();
        delay = null;
      }
      return cancelled;
    },
    async sendRegisterAll(passphrase, context) {
      check(context, true);
      if (passphrase !== undefined && passphrase !== null && passphrase !== '') {
        throw new Error('Disposable registration fixture does not accept credentials.');
      }
      await load();
      return journal.run(context, {
        assertCurrent: () => check(context, true),
        getNames: async () => plan.registrationNames.filter(name => !state.acceptedNames.includes(name)),
        submit: async (name, hooks) => {
          if (!plan.registrationNames.includes(name)) throw new Error('Non-fixture registration blocked.');
          state.constructionCalls++;
          await save();
          if (plan.fixtureType === 'register-cancel') {
            await new Promise(resolve => {
              const timer = setTimeout(() => {delay = null; resolve();}, 10000);
              delay = {timer, resolve, operationId: context.operationId};
            });
            hooks.assertCurrent();
          }
          // Stage only: no key derivation, signature, or real WalletService proxy.
          await hooks.onStage('signing');
          if (plan.fixtureType === 'register-partial' && name === plan.registrationNames[6] && !state.injectedFailure) {
            state.injectedFailure = true;
            await save();
            throw new Error('Controlled seventh-registration preparation failure; no transaction sent for this name.');
          }
          const txid = crypto.createHash('sha256').update(`inert-register:${name}`).digest('hex');
          await hooks.beforeBroadcast(txid);
          state.inertBoundaryCalls++;
          if (plan.fixtureType !== 'register-ambiguous') state.acceptedNames.push(name);
          await save();
          if (plan.fixtureType === 'register-ambiguous') {
            throw new Error('Controlled ambiguous registration result; no real signature or broadcast occurred.');
          }
          return {txid: () => txid};
        },
      });
    },
  };
  return {walletMethods, async describe() {
    await load();
    return {...state, journal: 'real-RegisterAllJournal', walletServiceProxy: 'MOCKED',
      transport: 'INERT', packagedStatus: 'NOT TESTED'};
  }};
}

module.exports = {createRegisterRuntime, STATE_KEY, JOURNAL_PREFIX};
