import test from 'tape';
import sinon from 'sinon';
import walletClient from '../../utils/walletClient';
import {sendUpdate, submitNameUpdate} from '../names';

for (const scenario of ['wallet-switch', 'stale-records', 'switch-during-review']) {
  test(`name UPDATE rejects ${scenario} after unlock without calling wallet`, async t => {
    let state = {wallet: {wid: 'a', requestGeneration: 1}};
    const getState = () => state;
    const send = sinon.stub(walletClient, 'sendUpdate').resolves({});
    let reviewed = false;
    const dispatch = action => {
      if (typeof action === 'function') return action(dispatch, getState);
      if (action.payload?.resolve) {
        if (scenario === 'wallet-switch') state = {wallet: {wid: 'b', requestGeneration: 2}};
        action.payload.resolve();
      }
      return action;
    };
    try {
      await sendUpdate('example', {records: []}, async () => {
        reviewed = true;
        if (scenario === 'stale-records') throw new Error('canonical resource changed');
        state = {wallet: {wid: 'b', requestGeneration: 2}};
      })(dispatch, getState);
      t.fail('must reject');
    } catch (error) {
      t.match(error.message, /changed/);
      t.equal(send.callCount, 0, 'no wallet submission');
      t.equal(reviewed, scenario !== 'wallet-switch', 'review occurs only for the current wallet');
    } finally {send.restore();}
    t.end();
  });
}

test('name UPDATE checks review lifecycle synchronously after deferred storage', async t => {
  let resolveStore, enteredStore;
  const entered = new Promise(resolve => {enteredStore = resolve;});
  const stored = new Promise(resolve => {resolveStore = resolve;});
  const send = sinon.stub(walletClient, 'sendUpdate').resolves({});
  let active = true, reviewed = false, refreshed = false;
  try {
    const pending = submitNameUpdate('example', {records: []}, {
      unlock: async () => {},
      beforeSend: async () => {reviewed = true;},
      assertCurrent: () => {if (!active) throw new Error('review unmounted');},
      storeName: () => {enteredStore(); return stored;},
      send: (...args) => walletClient.sendUpdate(...args),
      refreshPending: async () => {refreshed = true;},
    });
    await entered;
    t.equal(reviewed, true, 'asynchronous canonical review already completed');
    active = false;
    resolveStore();
    try {await pending; t.fail('must reject stale review');}
    catch (error) {t.equal(error.message, 'review unmounted');}
    t.equal(send.callCount, 0, 'no wallet call after unmount during storage');
    t.equal(refreshed, false, 'no post-send refresh for an aborted submission');
  } finally {send.restore();}
  t.end();
});
