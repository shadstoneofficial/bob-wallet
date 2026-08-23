const test = require('tape');
const {balanceSnapshot} = require('../balanceSnapshot');

test('HNS Investments bridge reads serialized hsd locked balances', t => {
  const rawBalance = {
    confirmed: 13228324610000,
    unconfirmed: 13228324610000,
    clocked: 1315105550000,
    ulocked: 1315105550000,
    toJSON(minimal) {
      t.equal(minimal, true, 'requests the minimal public balance shape');
      return {
        confirmed: this.confirmed,
        unconfirmed: this.unconfirmed,
        lockedConfirmed: this.clocked,
        lockedUnconfirmed: this.ulocked,
      };
    },
  };

  t.deepEqual(balanceSnapshot(rawBalance), {
    confirmed: 13228324610000,
    unconfirmed: 13228324610000,
    lockedConfirmed: 1315105550000,
    lockedUnconfirmed: 1315105550000,
    spendable: 11913219060000,
  });
  t.end();
});

test('HNS Investments bridge never reports a negative spendable balance', t => {
  t.equal(balanceSnapshot({unconfirmed: 5, lockedUnconfirmed: 10}).spendable, 0);
  t.end();
});
