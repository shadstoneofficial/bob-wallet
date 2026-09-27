import test from 'tape';

import {
  hasPendingBids,
  hasPendingMetadataWarning,
  normalizeAuctionDomain,
} from '../auctionDomain';

test('auction domain normalization makes missing and malformed arrays render-safe', t => {
  const normalized = normalizeAuctionDomain({
    name: 'xn--ev9h',
    hash: 'fixture-hash',
    bids: {unexpected: true},
    pendingOperation: 'BID',
    pendingOperationMeta: {bids: {unexpected: true}},
  });

  t.deepEqual(normalized.bids, []);
  t.deepEqual(normalized.reveals, []);
  t.deepEqual(normalized.pendingOperationMeta.bids, []);
  t.deepEqual(normalized.pendingOperationMeta.operations, []);
  t.equal(hasPendingBids(normalized), false);
  t.equal(hasPendingMetadataWarning(normalized, null), true);
  t.end();
});

test('normal domains without pending operations normalize without a warning', t => {
  const normalized = normalizeAuctionDomain({bids: [], reveals: []});
  t.deepEqual(normalized.pendingOperationMeta, {bids: [], operations: []});
  t.equal(normalized.pendingMetadataMalformed, false);
  t.end();
});

test('pending warning is scoped by name hash when possible', t => {
  const domain = normalizeAuctionDomain({
    hash: 'target', bids: [], reveals: [],
    pendingOperationMeta: {bids: [], operations: []},
  });
  t.equal(hasPendingMetadataWarning(domain, {general: false, hashes: ['other']}), false);
  t.equal(hasPendingMetadataWarning(domain, {general: false, hashes: ['target']}), true);
  t.end();
});
