import test from 'tape';
import {
  WalletMutationCoordinator,
  broadcastAndRecord,
  reserveTransactionInputs,
} from '../transactionSafety';

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return {promise, resolve};
}

test('wallet mutations cannot select the same input while an earlier broadcast is pending', async t => {
  const coordinator = new WalletMutationCoordinator();
  const firstBroadcast = deferred();
  const availableInputs = ['shared-change', 'safe-confirmed'];
  const selectedInputs = [];

  const submit = gate => coordinator.run(async () => {
    const selected = availableInputs[0];
    selectedInputs.push(selected);
    if (gate) await gate.promise;
    availableInputs.shift();
    return selected;
  });

  const first = submit(firstBroadcast);
  const second = submit();
  await Promise.resolve();
  t.deepEqual(selectedInputs, ['shared-change'], 'the second mutation waits for reservation');

  firstBroadcast.resolve();
  t.equal(await first, 'shared-change');
  t.equal(await second, 'safe-confirmed', 'the second mutation selects a different input');
  t.end();
});

test('a pending bid is recorded before a queued bulk finalize selects funding', async t => {
  const coordinator = new WalletMutationCoordinator();
  const bidAcceptance = deferred();
  const coins = ['bid-funding', 'finalize-funding'];
  const spent = new Set();
  const selections = {};
  const walletDB = {
    addTX: async tx => spent.add(tx.input),
  };

  const submit = (action, gate) => coordinator.run(async () => {
    const input = coins.find(coin => !spent.has(coin));
    selections[action] = input;
    const tx = {input, txid: () => `${action}-tx`};
    const mtx = {toTX: () => tx};
    return broadcastAndRecord({
      mtx,
      walletDB,
      broadcast: async () => {
        if (gate) await gate.promise;
      },
    });
  });

  const bid = submit('bid', bidAcceptance);
  const finalize = submit('bulk-finalize');
  await Promise.resolve();
  t.equal(selections['bulk-finalize'], undefined, 'bulk finalize waits for the pending bid');

  bidAcceptance.resolve();
  await bid;
  await finalize;
  t.equal(selections.bid, 'bid-funding');
  t.equal(selections['bulk-finalize'], 'finalize-funding', 'bulk finalize cannot reuse the bid input');
  t.end();
});

test('transaction inputs stay reserved until the operation releases them', t => {
  const locked = new Set();
  const wallet = {
    lockCoin: prevout => locked.add(prevout),
    unlockCoin: prevout => locked.delete(prevout),
  };
  const inputs = [{prevout: 'one'}, {prevout: 'two'}];
  const release = reserveTransactionInputs(wallet, {inputs});

  t.deepEqual(Array.from(locked), ['one', 'two'], 'all selected inputs are immediately reserved');
  release();
  t.equal(locked.size, 0, 'temporary locks are released after wallet state is updated');
  t.end();
});

test('a rejected transaction is not recorded and remains safe to retry', async t => {
  const recorded = [];
  const tx = {txid: () => 'rejected-tx'};
  const mtx = {toTX: () => tx};

  try {
    await broadcastAndRecord({
      mtx,
      walletDB: {addTX: async item => recorded.push(item)},
      broadcast: async () => {
        const error = new Error('bad-txns-inputs-spent');
        error.code = 'ETXREJECTED';
        throw error;
      },
    });
    t.fail('rejected broadcast must not report success');
  } catch (error) {
    t.match(error.message, /rejected-tx/, 'the error identifies the transaction');
    t.match(error.message, /conflict with another pending transaction/, 'the error explains the conflict');
  }

  t.equal(recorded.length, 0, 'rejected transaction is not inserted into wallet state');
  t.end();
});

test('an accepted transaction is recorded before submission completes', async t => {
  const events = [];
  const tx = {txid: () => 'accepted-tx'};
  const mtx = {toTX: () => tx};

  const result = await broadcastAndRecord({
    mtx,
    walletDB: {addTX: async () => events.push('recorded')},
    broadcast: async () => events.push('accepted'),
  });

  t.equal(result, mtx);
  t.deepEqual(events, ['accepted', 'recorded']);
  t.end();
});

test('an accepted transaction keeps its txid when local history recording fails', async t => {
  const txid = 'a'.repeat(64);
  const tx = {txid: () => txid};

  try {
    await broadcastAndRecord({
      mtx: {toTX: () => tx},
      walletDB: {addTX: async () => { throw new Error('disk write failed'); }},
      broadcast: async () => {},
    });
    t.fail('history failure should be reported');
  } catch (error) {
    t.equal(error.code, 'ETXRECORD');
    t.equal(error.txid, txid);
    t.match(error.message, /accepted by the network/);
  }
  t.end();
});
