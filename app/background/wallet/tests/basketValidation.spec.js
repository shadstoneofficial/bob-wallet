import test from 'tape';
import {MTX, Output} from 'hsd/lib/primitives';
import {hashName, blind, types} from 'hsd/lib/covenants/rules';
import {basketScope, assertBasketScope, assertBasketEligibility} from '../../../utils/basketScope';
import {reconcileBasketOutputs} from '../basketValidation';

const rows = [
  {name: 'harm', bid: 2400000000, lockup: 5000000000},
  {name: 'backrub', bid: 50000000, lockup: 300000000},
];

function fixture(entries = rows) {
  const mtx = new MTX();
  const blinds = new Map();
  entries.forEach((entry, index) => {
    const nonce = Buffer.alloc(32, index + 1);
    const commitment = blind(entry.bid, nonce);
    const output = new Output();
    output.value = entry.lockup;
    output.covenant.type = types.BID;
    output.covenant.pushHash(hashName(Buffer.from(entry.name, 'ascii')));
    output.covenant.pushU32(100);
    output.covenant.push(Buffer.from(entry.name, 'ascii'));
    output.covenant.pushHash(commitment);
    mtx.outputs.push(output);
    blinds.set(commitment.toString('hex'), {value: entry.bid, nonce});
  });
  mtx.hasCoins = () => true;
  mtx.getFee = () => 21600;
  const wallet = {getBlind: async hash => blinds.get(hash.toString('hex')),
    getNameState: async () => ({height: 100}), getPath: async () => ({account: 0})};
  return {mtx, wallet};
}

test('basket reconciles every real BID covenant, true bid and exact base-unit total', async t => {
  const {mtx, wallet} = fixture();
  const scope = await reconcileBasketOutputs(mtx, wallet, rows);
  t.deepEqual(scope, basketScope(rows, 21600));
  t.equal(scope.totalBid, 2450000000);
  t.equal(scope.totalBlind, 2850000000);
  t.equal(scope.totalLockup, 5300000000);
  t.equal(scope.fee, 21600);
  t.equal(scope.transactionCount, 1);
  t.end();
});

test('basket rejects a subset, duplicate, extra BID, wrong lockup, hidden bid and unknown fee', async t => {
  const cases = [
    ['omitted backrub', f => f.mtx.outputs.pop()],
    ['duplicate', f => f.mtx.outputs.push(f.mtx.outputs[0])],
    ['wrong lockup', f => {f.mtx.outputs[0].value--;}],
    ['unverified hidden bid', f => {f.wallet.getBlind = async () => ({value: 1, nonce: Buffer.alloc(32)});} ],
    ['missing input values', f => {f.mtx.hasCoins = () => false;}],
    ['negative fee', f => {f.mtx.getFee = () => -1;}],
    ['foreign BID destination', f => {f.wallet.getPath = async () => null;}],
    ['stale auction start', f => {f.wallet.getNameState = async () => ({height: 101});}],
    ['additional covenant', f => {f.mtx.outputs[0].covenant.type = types.UPDATE;}],
    ['foreign payment', f => {
      f.mtx.outputs.push(new Output());
      f.wallet.getPath = async () => null;
    }],
  ];
  for (const [label, change] of cases) {
    const f = fixture();
    change(f);
    try {
      await reconcileBasketOutputs(f.mtx, f.wallet, rows);
      t.fail(label);
    } catch (error) {
      t.equal(error.code, 'BASKET_SCOPE_CHANGED', label);
    }
  }
  const extra = fixture([...rows, {name: 'extra', bid: 1, lockup: 2}]);
  try {await reconcileBasketOutputs(extra.mtx, extra.wallet, rows); t.fail('extra bid');}
  catch (error) {t.equal(error.code, 'BASKET_SCOPE_CHANGED', 'extra BID rejected');}
  t.end();
});

test('every authorized amount, name, fee and transaction count must remain exact', t => {
  const expected = basketScope(rows, 21600);
  for (const change of [
    scope => {scope.rows.pop();},
    scope => {scope.rows[0].name = 'different';},
    scope => {scope.rows[0].bid++;},
    scope => {scope.rows[0].blind++;},
    scope => {scope.rows[0].lockup++;},
    scope => {scope.totalLockup++;},
    scope => {scope.fee++;},
    scope => {scope.transactionCount = 2;},
  ]) {
    const changed = JSON.parse(JSON.stringify(expected));
    change(changed);
    t.throws(() => assertBasketScope(changed, expected), /changed/, 'requires new review');
  }
  t.throws(() => assertBasketEligibility('backrub', {info: {state: 'REVEAL'}}), /backrub\/ is REVEAL/);
  t.throws(() => assertBasketEligibility('backrub', {info: {state: 'BIDDING', stats: {blocksUntilReveal: 1}}}), /next block/);
  t.end();
});
