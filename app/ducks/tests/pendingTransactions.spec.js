import test from 'tape';
import sinon from 'sinon';

import walletClient from '../../utils/walletClient';
import {
  fetchPendingTransactions,
  processPendingTransactions,
} from '../walletActions';
import {
  SET_PENDING_TRANSACTIONS,
  SET_PENDING_TRANSACTIONS_WARNING,
} from '../walletReducer';

function output(action, hash, index, value = 1000) {
  const items = [hash, 'height'];
  if (action === 'BID') items.push('name', `blind-${index}`);
  return {
    value,
    address: `address-${index}`,
    covenant: {action, items},
  };
}

function nameState(entries) {
  return Object.fromEntries(entries.map(([name, hash]) => [name, {
    name,
    hash,
    bids: [],
    reveals: [],
  }]));
}

test('one external batch transaction processes all 20 BID outputs', async t => {
  const entries = Array.from({length: 20}, (_, index) => [
    `batch-name-${index}`,
    `hash-${index}`,
  ]);
  const blindStub = sinon.stub(walletClient, 'getBlind').callsFake(async blind => ({
    value: Number(blind.split('-').pop()) + 1,
  }));

  const result = await processPendingTransactions(
    nameState(entries),
    [{tx: {outputs: entries.map(([, hash], index) => output('BID', hash, index))}}],
  );

  t.equal(blindStub.callCount, 20, 'every bid output is resolved');
  for (const [name] of entries) {
    t.equal(result.names[name].pendingOperationMeta.bids.length, 1, `${name} is retained`);
  }
  t.equal(result.warning, null, 'valid batch has no warning');
  blindStub.restore();
  t.end();
});

test('multiple pending bids for one name remain arrays across transactions', async t => {
  const hash = 'same-name-hash';
  const blindStub = sinon.stub(walletClient, 'getBlind').resolves({value: 500});
  const result = await processPendingTransactions(
    nameState([['same-name', hash]]),
    [
      {tx: {outputs: [output('BID', hash, 1, 1000)]}},
      {tx: {outputs: [output('BID', hash, 2, 2000)]}},
    ],
  );

  t.deepEqual(
    result.names['same-name'].pendingOperationMeta.bids.map(bid => bid.value),
    [1000, 2000],
    'both bids retain deterministic encounter order',
  );
  t.equal(result.names['same-name'].pendingOperationMeta.operations.length, 2);
  blindStub.restore();
  t.end();
});

test('mixed covenant ordering is deterministic and never changes BID array shape', async t => {
  const firstHash = 'bid-then-reveal';
  const secondHash = 'reveal-then-bid';
  const blindStub = sinon.stub(walletClient, 'getBlind').resolves({value: 500});
  const result = await processPendingTransactions(
    nameState([['first', firstHash], ['second', secondHash]]),
    [{tx: {outputs: [
      output('BID', firstHash, 1),
      output('REVEAL', firstHash, 2),
      output('REVEAL', secondHash, 3),
      output('BID', secondHash, 4),
    ]}}],
  );

  t.equal(result.names.first.pendingOperation, 'REVEAL', 'last encountered operation is primary');
  t.equal(result.names.second.pendingOperation, 'BID', 'reverse order has a stable primary');
  t.equal(result.names.first.pendingOperationMeta.bids.length, 1, 'earlier bid remains available');
  t.equal(result.names.second.pendingOperationMeta.bids.length, 1, 'later bid remains available');
  t.deepEqual(
    result.names.first.pendingOperationMeta.operations.map(op => op.action),
    ['BID', 'REVEAL'],
  );
  blindStub.restore();
  t.end();
});

test('punycode names and malformed neighboring entries are isolated', async t => {
  const hash = 'punycode-hash';
  const otherHash = 'other-hash';
  const blindStub = sinon.stub(walletClient, 'getBlind').resolves({value: 881});
  const result = await processPendingTransactions(
    nameState([['xn--ev9h', hash], ['unrelated', otherHash]]),
    [
      null,
      {tx: {outputs: [null, output('BID', hash, 881)]}},
    ],
  );

  t.equal(result.names['xn--ev9h'].pendingOperationMeta.bids.length, 1);
  t.equal(result.names.unrelated.pendingOperation, null);
  t.deepEqual(result.names.unrelated.pendingOperationMeta.bids, []);
  t.equal(result.warning.general, true, 'unattributed malformed metadata is reported');
  blindStub.restore();
  t.end();
});

test('a BID with missing blind metadata remains pending and retry-protected', async t => {
  const hash = 'missing-blind-hash';
  const malformedBid = output('BID', hash, 1);
  malformedBid.covenant.items = [hash, 'height', 'name'];
  const blindStub = sinon.stub(walletClient, 'getBlind');

  const result = await processPendingTransactions(
    nameState([['missing-blind', hash]]),
    [{tx: {outputs: [malformedBid]}}],
  );

  const domain = result.names['missing-blind'];
  t.equal(domain.pendingOperation, 'BID');
  t.equal(domain.pendingOperationMeta.bids.length, 1, 'the pending covenant is not hidden');
  t.equal(domain.pendingOperationMeta.bids[0].bid.blind, null);
  t.ok(result.warning.hashes.includes(hash));
  t.equal(blindStub.callCount, 0, 'missing blind is not sent to the wallet RPC');
  blindStub.restore();
  t.end();
});

test('pending metadata failure is nonfatal and does not replace names', async t => {
  const errorStub = sinon.stub(console, 'error');
  const pendingStub = sinon.stub(walletClient, 'getPendingTransactions')
    .rejects(new Error('fixture pending RPC failure'));
  const actions = [];
  const state = {
    names: nameState([['core-name', 'core-hash']]),
    wallet: {initialized: true, wid: 'fixture', requestGeneration: 0},
  };

  await fetchPendingTransactions()(action => actions.push(action), () => state);

  t.equal(actions.filter(action => action.type === SET_PENDING_TRANSACTIONS).length, 0,
    'valid core name state is not replaced');
  const warning = actions.find(action => action.type === SET_PENDING_TRANSACTIONS_WARNING);
  t.ok(warning?.payload?.general, 'the optional enrichment warning is exposed');
  pendingStub.restore();
  errorStub.restore();
  t.end();
});

test('late pending metadata from wallet A cannot update wallet B', async t => {
  let resolvePending;
  const pending = new Promise(resolve => { resolvePending = resolve; });
  const pendingStub = sinon.stub(walletClient, 'getPendingTransactions').returns(pending);
  const actions = [];
  let state = {
    names: nameState([['wallet-a-name', 'wallet-a-hash']]),
    wallet: {initialized: true, wid: 'wallet-a', requestGeneration: 0},
  };

  const request = fetchPendingTransactions()(action => actions.push(action), () => state);
  state = {
    names: nameState([['wallet-b-name', 'wallet-b-hash']]),
    wallet: {initialized: true, wid: 'wallet-b', requestGeneration: 1},
  };
  resolvePending([]);
  await request;

  t.equal(actions.filter(action => action.type === SET_PENDING_TRANSACTIONS).length, 0);
  t.equal(actions.filter(action => action.type === SET_PENDING_TRANSACTIONS_WARNING).length, 0);
  pendingStub.restore();
  t.end();
});
