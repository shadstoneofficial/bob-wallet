import test from 'tape';
import sinon from 'sinon';

import nodeClient from '../../utils/nodeClient';
import walletClient from '../../utils/walletClient';
import {getNameInfo} from '../names';
import {SET_NAME} from '../namesReducer';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return {promise, resolve, reject};
}

test('concurrent name loads share one chain and wallet switching cancels late lookups', async t => {
  const tx = deferred();
  const nameStub = sinon.stub(nodeClient, 'getNameInfo').resolves({
    start: {start: 1},
    info: {state: 'BIDDING', height: 1},
  });
  const auctionStub = sinon.stub(walletClient, 'getAuctionInfo').resolves({
    bids: [
      {prevout: {hash: 'first', index: 0}},
      {prevout: {hash: 'second', index: 0}},
    ],
    reveals: [],
  });
  const txStub = sinon.stub(nodeClient, 'getTx').returns(tx.promise);
  const actions = [];
  let state = {wallet: {wid: 'wallet-a', requestGeneration: 0}};
  const dispatch = action => { actions.push(action); return action; };
  const thunk = getNameInfo('fixture-name');
  const first = thunk(dispatch, () => state);
  const second = thunk(dispatch, () => state);
  let coreSettled = false;
  first.then(() => { coreSettled = true; });

  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  t.equal(coreSettled, true, 'core auction state does not wait for bid history');
  const committedBeforeSwitch = actions.filter(action => action.type === SET_NAME).length;
  state = {wallet: {wid: 'wallet-b', requestGeneration: 1}};
  tx.resolve({height: 1, mtime: 1, outputs: [{address: 'address', value: 1}]});
  const results = await Promise.allSettled([first, second]);
  await Promise.resolve();
  await Promise.resolve();

  t.equal(nameStub.callCount, 1, 'one getnameinfo chain per resource');
  t.equal(txStub.callCount, 1, 'cancellation stops before the second transaction lookup');
  t.ok(results.every(result => result.status === 'fulfilled'));
  t.equal(actions.filter(action => action.type === SET_NAME).length, committedBeforeSwitch,
    'wallet-A data cannot update wallet B');

  nameStub.restore();
  auctionStub.restore();
  txStub.restore();
  t.end();
});

test('aborting a name-page request stops history work and prevents a late update', async t => {
  const tx = deferred();
  const controller = new AbortController();
  const nameStub = sinon.stub(nodeClient, 'getNameInfo').resolves({
    start: {start: 1},
    info: {state: 'BIDDING', height: 1},
  });
  const auctionStub = sinon.stub(walletClient, 'getAuctionInfo').resolves({
    bids: [
      {prevout: {hash: 'first', index: 0}},
      {prevout: {hash: 'second', index: 0}},
    ],
    reveals: [],
  });
  const txStub = sinon.stub(nodeClient, 'getTx').returns(tx.promise);
  const state = {wallet: {wid: 'wallet-a', requestGeneration: 0}};
  const actions = [];
  const dispatch = action => { actions.push(action); return action; };

  await getNameInfo('abort-fixture', {signal: controller.signal})(dispatch, () => state);
  const committedBeforeAbort = actions.filter(action => action.type === SET_NAME).length;
  controller.abort();
  tx.resolve({height: 1, mtime: 1, outputs: [{address: 'address', value: 1}]});
  await Promise.resolve();
  await Promise.resolve();

  t.equal(txStub.callCount, 1, 'no additional history request starts after abort');
  t.equal(actions.filter(action => action.type === SET_NAME).length, committedBeforeAbort,
    'late history does not update the unmounted page');

  nameStub.restore();
  auctionStub.restore();
  txStub.restore();
  t.end();
});

test('successful and malformed name responses both leave the request chain settled', async t => {
  const nameStub = sinon.stub(nodeClient, 'getNameInfo');
  const auctionStub = sinon.stub(walletClient, 'getAuctionInfo').resolves({bids: [], reveals: []});
  const state = {wallet: {wid: 'wallet-a', requestGeneration: 0}};
  const actions = [];
  const dispatch = action => { actions.push(action); return action; };

  nameStub.onFirstCall().resolves({start: {start: 1}, info: {state: 'BIDDING', height: 1}});
  await getNameInfo('success-fixture')(dispatch, () => state);
  t.equal(actions.filter(action => action.type === SET_NAME).length, 1);

  nameStub.onSecondCall().resolves({unexpected: true});
  try {
    await getNameInfo('malformed-fixture')(dispatch, () => state);
    t.fail('malformed response should reject');
  } catch (error) {
    t.match(error.message, /malformed name response/);
  }

  nameStub.restore();
  auctionStub.restore();
  t.end();
});
