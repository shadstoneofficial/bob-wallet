import test from 'tape';
import {formatRegisterSuccess} from '../transactionNotifications';

test('register success keeps the transaction link target for one name', (t) => {
  const txid = 'a'.repeat(64);

  t.equal(
    formatRegisterSuccess({names: ['example'], txids: [txid], txid}),
    `Registration submitted for example. Tx: ${txid}. It will appear as registered after confirmation.`
  );
  t.end();
});

test('bulk register success summarizes names and transactions', (t) => {
  const txids = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];

  t.equal(
    formatRegisterSuccess({
      names: ['alpha', 'bravo', 'charlie'],
      txids,
      txid: txids.join(', '),
    }),
    'Registration submitted in 3 transactions for 3 names. They will appear as registered after confirmation.'
  );
  t.end();
});
