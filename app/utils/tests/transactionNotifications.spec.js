import test from 'tape';
import {
  formatAtomicBatchFailure,
  formatRegisterSuccess,
} from '../transactionNotifications';

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

test('atomic finalize rejection says that no names succeeded', (t) => {
  const txid = 'a'.repeat(64);
  const message = formatAtomicBatchFailure(
    new Error(`Transaction ${txid} was rejected by the network.`),
    ['chatbots', 'chatbot', 'plumepas', '4pl', 'newyorkbarstore', 'customhats', '3pl'],
    'finalize',
  );

  t.match(message, new RegExp(txid), 'keeps the rejected transaction ID');
  t.match(message, /None of the 7 names in this atomic finalize batch succeeded/);
  t.match(message, /remain available for a safe retry/);
  t.end();
});
