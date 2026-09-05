import test from 'tape';
import {
  WalletMutationCoordinator,
  broadcastAndRecord,
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
