import test from 'tape';
import {applyMiddleware, combineReducers, createStore} from 'redux';
import thunk from 'redux-thunk';

import walletClient from '../../utils/walletClient';
import {sendRedeemAll} from '../names';
import walletStatsReducer, {
  fetchWalletStats,
} from '../walletStats';

const stats = (redeemable, registerable = 0, revealable = 0) => ({
  lockedBalance: {
    bidding: {HNS: 0, num: 0},
    revealable: {HNS: revealable * 10, num: revealable, block: 10},
    finished: {
      HNS: redeemable * 10 + registerable * 20,
      num: redeemable + registerable,
    },
  },
  actionableInfo: {
    revealable: {HNS: revealable * 10, num: revealable, block: 10},
    redeemable: {HNS: redeemable * 10, num: redeemable},
    registerable: {HNS: registerable * 20, num: registerable},
    renewable: {domains: [], block: null},
    transferring: {domains: [], block: null},
    finalizable: {domains: []},
  },
});

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
}

function createStatsStore() {
  return createStore(
    combineReducers({
      walletStats: walletStatsReducer,
      wallet: (state = {watchOnly: true}) => state,
    }),
    applyMiddleware(thunk),
  );
}

test('stale wallet statistics cannot restore redeemed action cards', async t => {
  const originalGetStats = walletClient.getStats;
  const originalSendRedeemAll = walletClient.sendRedeemAll;
  const oldResponse = deferred();
  let call = 0;
  walletClient.getStats = () => {
    call++;
    if (call === 1) return Promise.resolve(stats(30, 2, 3));
    if (call === 2) return oldResponse.promise;
    return Promise.resolve(stats(0, 2, 3));
  };
  walletClient.sendRedeemAll = () => Promise.resolve({txid: 'redeem-tx'});

  const store = createStatsStore();
  await store.dispatch(fetchWalletStats());
  t.equal(
    store.getState().walletStats.actionableInfo.redeemable.num,
    30,
    'wallet initially reports redeemable bids',
  );

  const staleRequest = store.dispatch(fetchWalletStats());
  await store.dispatch(sendRedeemAll());

  oldResponse.resolve(stats(30, 2, 3));
  await staleRequest;

  const current = store.getState().walletStats;
  t.equal(current.actionableInfo.redeemable.num, 0, 'redeem card stays hidden');
  t.equal(current.actionableInfo.registerable.num, 2, 'register card is preserved');
  t.equal(current.actionableInfo.revealable.num, 3, 'reveal card is preserved');

  walletClient.getStats = originalGetStats;
  walletClient.sendRedeemAll = originalSendRedeemAll;
  t.end();
});

test('empty bulk redeem refreshes stats and returns a friendly message', async t => {
  const originalGetStats = walletClient.getStats;
  const originalSendRedeemAll = walletClient.sendRedeemAll;
  walletClient.getStats = () => Promise.resolve(stats(0, 1, 1));
  walletClient.sendRedeemAll = () => Promise.reject(
    new Error('RPC internal error.\nNothing to do.\nat Wallet.makeBatch'),
  );

  const store = createStatsStore();
  try {
    await store.dispatch(sendRedeemAll());
    t.fail('empty redeem should reject with the friendly state message');
  } catch (error) {
    t.equal(error.message, 'No bids remain to redeem.');
  }

  const current = store.getState().walletStats;
  t.equal(current.actionableInfo.redeemable.num, 0, 'stale card is removed');
  t.equal(current.actionableInfo.registerable.num, 1, 'register card remains');
  t.equal(current.actionableInfo.revealable.num, 1, 'reveal card remains');

  walletClient.getStats = originalGetStats;
  walletClient.sendRedeemAll = originalSendRedeemAll;
  t.end();
});
