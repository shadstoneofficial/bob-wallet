import test from 'tape';

import {fromReveals} from '../stats';

test('redeemable stats include only eligible unspent own reveals', async t => {
  const owner = {equals: () => false};
  const reveals = [
    {own: true, prevout: {hash: 'unspent', index: 0, equals: owner.equals}},
    {own: true, prevout: {hash: 'pending-spent', index: 0, equals: owner.equals}},
    {own: false, prevout: {hash: 'other-wallet', index: 0, equals: owner.equals}},
  ];
  const wallet = {
    wdb: {height: 100},
    network: {},
    getReveals: async () => reveals,
    getNameState: async () => ({
      owner,
      height: 50,
      isExpired: () => false,
      state: () => 6,
    }),
    getUnspentCoin: async hash => hash === 'unspent'
      ? {height: 50, value: 42}
      : null,
  };

  t.deepEqual(await fromReveals(wallet), {
    redeemable: {HNS: 42, num: 1},
  });
  t.end();
});
