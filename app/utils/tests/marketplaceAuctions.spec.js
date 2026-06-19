import test from 'tape';
import {
  dedupeMarketplaceAuctionsByName,
  isPendingMarketplaceAuction,
} from '../marketplaceAuctions';

test('marketplace auction dedupe prefers active listings over stale pending rows', (t) => {
  const rows = dedupeMarketplaceAuctionsByName([
    {
      id: 'pending-15',
      name: 'zamna',
      pending: true,
      buyable: false,
      expectedPrice: 33000000,
    },
    {
      id: 128,
      name: 'zamna',
      bids: [{ price: 50000000 }],
      lockingTxHash: 'bafe',
    },
  ]);

  t.equal(rows.length, 1);
  t.equal(rows[0].id, 128);
  t.equal(isPendingMarketplaceAuction(rows[0]), false);
  t.end();
});

test('marketplace auction dedupe does not let pending rows replace active listings', (t) => {
  const rows = dedupeMarketplaceAuctionsByName([
    {
      id: 128,
      name: 'zamna/',
      bids: [{ price: 50000000 }],
    },
    {
      id: 'pending-15',
      name: 'ZAMNA',
      pending: true,
      buyable: false,
    },
  ]);

  t.equal(rows.length, 1);
  t.equal(rows[0].id, 128);
  t.end();
});

test('marketplace auction dedupe keeps unrelated pending rows', (t) => {
  const rows = dedupeMarketplaceAuctionsByName([
    { id: 'pending-zamna', name: 'zamna', pending: true },
    { id: 'pending-zodia', name: 'zodia', pending: true },
  ]);

  t.equal(rows.length, 2);
  t.equal(isPendingMarketplaceAuction(rows[0]), true);
  t.equal(isPendingMarketplaceAuction(rows[1]), true);
  t.end();
});
