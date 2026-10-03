import test from 'tape';
import sinon from 'sinon';

import walletClient from '../../utils/walletClient';
import nodeClient from '../../utils/nodeClient';
import {
  collectOpenedNames,
  fetchTransactions,
  invalidateWalletRequests,
  waitForWalletSync,
} from '../walletActions';
import walletReducer, {
  SET_TRANSACTIONS,
  SET_FETCHING,
} from '../walletReducer';

test('storage failure aborts a pending bid rescan before transaction submission', async t => {
  let submissions = 0;
  const getState = () => ({
    storage: {blocked: true, transactionAttempted: true},
    node: {chain: {height: 1000}},
    wallet: {walletSync: true, walletHeight: 990, rescanHeight: 1000},
  });

  try {
    await waitForWalletSync()(action => action, getState);
    submissions++;
    t.fail('storage failure should reject the wait');
  } catch (error) {
    t.match(error.message, /Bob cannot continue because your device is low on storage/);
    t.match(error.message, /transaction may not have been submitted/);
  }

  t.equal(submissions, 0, 'the transaction path did not continue to submission');
  t.end();
});

test('wallet request generation increments on repeated wallet switches', t => {
  let state = walletReducer(undefined, {type: '@@init'});
  state = walletReducer(state, invalidateWalletRequests());
  state = walletReducer(state, invalidateWalletRequests());
  t.equal(state.requestGeneration, 2);
  t.equal(state.isFetching, false, 'a switch clears stale history loading');
  t.end();
});

test('late wallet-A history cannot update wallet-B state', async t => {
  let resolveHistory;
  const history = new Promise(resolve => { resolveHistory = resolve; });
  const historyStub = sinon.stub(walletClient, 'getTransactionHistory').returns(history);
  const actions = [];
  let state = {
    wallet: {
      network: 'main', wid: 'wallet-a', requestGeneration: 0,
      transactions: new Map(), isFetching: false,
    },
  };
  const dispatch = action => {
    actions.push(action);
    if (action.type === SET_FETCHING) state.wallet.isFetching = action.payload;
    return action;
  };

  const pending = fetchTransactions()(dispatch, () => state);
  state = {
    wallet: {
      network: 'main', wid: 'wallet-b', requestGeneration: 1,
      transactions: new Map(), isFetching: false,
    },
  };
  resolveHistory([]);
  await pending;

  t.equal(actions.filter(action => action.type === SET_TRANSACTIONS).length, 0,
    'the stale result is never committed');
  t.equal(state.wallet.isFetching, false, 'wallet B loading state is unchanged');
  historyStub.restore();
  t.end();
});

test('wallet OPEN covenants resolve history names without hosted RPC growth', async t => {
  const hash = 'ab'.repeat(32);
  const encodedName = Buffer.from('fixture-name').toString('hex');
  const covenant = action => ({action, items: [hash, '', encodedName]});
  const txs = [
    {hash: 'open', time: 1, block: 1, fee: 0, inputs: [],
      outputs: [{value: 0, path: null, covenant: covenant('OPEN')}]},
    {hash: 'bid', time: 2, block: 2, fee: 0, inputs: [],
      outputs: [{value: 1, path: null, covenant: covenant('BID')}]},
  ];
  const opened = collectOpenedNames(txs);
  t.equal(opened.get(hash), 'fixture-name');

  const historyStub = sinon.stub(walletClient, 'getTransactionHistory').resolves(txs);
  const lookupStub = sinon.stub(nodeClient, 'getNameByHash').rejects(new Error('unexpected RPC'));
  const actions = [];
  const state = {
    wallet: {
      network: 'main', wid: 'wallet-a', requestGeneration: 0,
      transactions: new Map(), isFetching: false,
    },
  };
  const dispatch = action => {
    actions.push(action);
    if (action.type === SET_FETCHING) state.wallet.isFetching = action.payload;
    return action;
  };
  await fetchTransactions()(dispatch, () => state);

  t.equal(lookupStub.callCount, 0, 'no getnamebyhash request is needed');
  const result = actions.find(action => action.type === SET_TRANSACTIONS);
  t.equal(result.payload.get('bid').meta.domain, 'fixture-name');
  historyStub.restore();
  lookupStub.restore();
  t.end();
});

test('queued managed recovery cannot reuse the preceding scan completion height', async t => {
  const clock = sinon.useFakeTimers();
  try {
    const state = {node: {chain: {height: 100}}, wallet: {
      walletSync: true, walletHeight: 100, rescanHeight: 100, rescanStatus: 'waiting',
    }};
    let finished = false;
    const wait = waitForWalletSync(10, {pollIntervalMs: 5})(() => {}, () => state).then(() => {finished = true;});
    await clock.tickAsync(5); t.notOk(finished, 'waiting is not completion even at target height');
    state.wallet.rescanStatus = 'scanning';
    await clock.tickAsync(5); t.notOk(finished, 'scan start is not completion before observed progress');
    state.wallet.rescanStatus = 'complete'; state.wallet.walletSync = false;
    await clock.tickAsync(5); await wait;
    t.ok(finished, 'observed backend completion releases wait without an RPC promise');
    state.wallet.rescanStatus = 'failed';
    try {await waitForWalletSync()(() => {}, () => state); t.fail('must reject');}
    catch(e) {t.match(e.message, /recovery is incomplete/);}
  } finally {clock.restore();}
  t.end();
});

test('required rescan generation detects a full scan that finished before the first poll', async t => {
  const state = {node: {chain: {height: 100}}, wallet: {
    walletSync: false,
    walletHeight: 100,
    rescanHeight: null,
    rescanStatus: 'complete',
    rescanGeneration: 9,
  }};
  await waitForWalletSync(10, {
    requireRescanStart: true,
    rescanGenerationBefore: 8,
    pollIntervalMs: 5,
  })(() => {}, () => state);
  t.pass('matching completion generation counts even after waiting observed the fast start-to-complete cycle');

  const stale = {...state, wallet: {...state.wallet, rescanGeneration: 8}};
  const clock = sinon.useFakeTimers();
  let settled = false;
  const waiting = waitForWalletSync(1, {
    requireRescanStart: true,
    rescanGenerationBefore: 8,
    pollIntervalMs: 5,
    timeoutMs: 10,
  })(() => {}, () => stale).catch(() => {settled = true;});
  await clock.tickAsync(10);
  await waiting;
  clock.restore();
  t.ok(settled, 'a stale completion with the prior generation does not satisfy a required rescan');
});
