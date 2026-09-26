import test from 'tape';
import {
  basketToCSV,
  parseBasketDraft,
  parseCompleteBasket,
  serializeBasketDraft,
  splitBasket,
} from '../auctionBasketData';
import auctionBasketReducer, {importBasketRows} from '../../ducks/auctionBasket';

const fixture = `name,true_bid,blind
881,3637,6364
148,3637,6364
749,3637,6364
593,3637,6364
lobster,10002,24998
atomic,5555,10445
myth,5555,10445
pirates,5555,10445
fiber,1555,14445
socrates,5555,10445
unchained,5555,10445
shotgun,3555,12445
blush,1555,14445
dough,5555,10445
cabin,1555,14445
catherine,7555,8445
walls,1555,14445
devs,1555,14445
erc20,5555,10445
xn--6g9h,12000,4000`;

test('complete basket parser accepts the exact 20-name CSV fixture', t => {
  const rows = parseCompleteBasket(fixture);
  t.equal(rows.length, 20);
  t.ok(rows.every(row => row.errors.length === 0));
  t.equal(rows[0].lockupAmount, '10001');
  t.equal(rows[4].lockupAmount, '35000');
  t.equal(rows[19].name, 'xn--6g9h');
  t.end();
});

test('complete basket parser accepts TSV, whitespace, Markdown, headers, and suffixes', t => {
  const inputs = [
    'name\ttrue_bid\tblind\nalpha.hns/\t1.25\t2.75',
    'alpha/ 1.25 2.75',
    '| name | true_bid | blind |\n| --- | ---: | ---: |\n| alpha.hns | 1.25 | 2.75 |',
  ];
  for (const input of inputs) {
    const rows = parseCompleteBasket(input);
    t.equal(rows.length, 1);
    t.deepEqual(rows[0].errors, []);
    t.equal(rows[0].name, 'alpha');
    t.equal(rows[0].lockupAmount, '4');
  }
  t.end();
});

test('complete basket parser normalizes Unicode and rejects unsafe rows', t => {
  const rows = parseCompleteBasket([
    'name,true_bid,blind',
    '❤,1,2',
    'dup,1,2',
    'dup,3,4',
    'negative,-1,2',
    'precision,1.0000001,2',
    'malformed,one,2',
  ].join('\n'));
  t.equal(rows[0].name, 'xn--qei');
  t.ok(rows[1].errors.some(error => /Duplicate/.test(error)));
  t.ok(rows[2].errors.some(error => /Duplicate/.test(error)));
  t.ok(rows[3].errors.some(error => /negative/.test(error)));
  t.ok(rows[4].errors.some(error => /six decimal/.test(error)));
  t.ok(rows[5].errors.some(error => /malformed/.test(error)));
  t.end();
});

test('basket CSV, draft recovery, and splitting preserve exact values', t => {
  const order = ['alpha', 'beta', 'gamma'];
  const items = {
    alpha: {name: 'alpha', bidAmount: '1.000001', blindAmount: '2', note: 'first'},
    beta: {name: 'beta', bidAmount: '3', blindAmount: '4.500001', note: ''},
    gamma: {name: 'gamma', bidAmount: '5', blindAmount: '6', note: 'last'},
  };
  t.equal(basketToCSV(order, items), 'name,true_bid,blind\nalpha,1.000001,2\nbeta,3,4.500001\ngamma,5,6\n');
  const batches = splitBasket(order, items, 5);
  t.equal(batches.length, 1);
  t.deepEqual(batches[0].map(row => [row.name, row.bidAmount, row.blindAmount]), [
    ['alpha', '1.000001', '2'], ['beta', '3', '4.500001'], ['gamma', '5', '6'],
  ]);
  const raw = serializeBasketDraft({
    walletId: 'wallet',
    network: 'regtest',
    order,
    items,
    formState: {
      step: 'review',
      broadcastUncertain: true,
      submissionTxid: 'known-signed-txid',
      submissionError: 'Broadcast timed out.',
      submissionFailedStage: 'broadcasting',
    },
  });
  const restored = parseBasketDraft(raw, {walletId: 'wallet', network: 'regtest'});
  t.deepEqual(restored.rows.map(row => row.note), ['first', '', 'last']);
  t.equal(restored.formState.broadcastUncertain, true, 'persists the duplicate-safety lock');
  t.equal(restored.formState.submissionTxid, 'known-signed-txid', 'persists the known transaction ID');
  t.equal(parseBasketDraft(raw, {walletId: 'other', network: 'regtest'}), null);
  t.end();
});

test('complete basket import replaces or merges atomically without overwriting existing values', t => {
  const initial = auctionBasketReducer(undefined, {type: '@@init'});
  const imported = auctionBasketReducer(initial, importBasketRows([
    {name: 'alpha', bidAmount: '1', blindAmount: '2'},
    {name: 'beta', bidAmount: '3', blindAmount: '4'},
  ], 'replace'));
  const merged = auctionBasketReducer(imported, importBasketRows([
    {name: 'alpha', bidAmount: '999', blindAmount: '999'},
    {name: 'gamma', bidAmount: '5', blindAmount: '6'},
  ], 'add'));
  t.deepEqual(merged.order, ['alpha', 'beta', 'gamma']);
  t.equal(merged.items.alpha.bidAmount, '1', 'merge does not overwrite an existing bid');
  const replaced = auctionBasketReducer(merged, importBasketRows([
    {name: 'delta', bidAmount: '7', blindAmount: '8'},
  ], 'replace'));
  t.deepEqual(replaced.order, ['delta']);
  t.equal(replaced.items.delta.blindAmount, '8');
  t.end();
});

test('split basket creates requested groups without changing amounts', t => {
  const order = Array.from({length: 12}, (_, index) => `name${index}`);
  const items = Object.fromEntries(order.map((name, index) => [name, {
    name,
    bidAmount: `${index}.000001`,
    blindAmount: `${index + 1}.5`,
  }]));
  const batches = splitBasket(order, items, 5);
  t.deepEqual(batches.map(batch => batch.length), [5, 5, 2]);
  t.equal(batches[2][1].bidAmount, '11.000001');
  t.equal(batches[2][1].blindAmount, '12.5');
  t.end();
});
