import test from 'tape';

import {waitForWalletSync} from '../walletActions';

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
