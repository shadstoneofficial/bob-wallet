# Auction Basket confirmed-scope safety

## Incident and source diagnosis

The reported v2.3.14 case approved `harm` (2400 HNS true bid, 2600 blind)
and `backrub` (50 HNS true bid, 250 blind): 5300 HNS lockup in one transaction.
After a long import/rescan, signing failed; a retry reportedly submitted only
`harm` after `backrub` expired. The reported transaction was not independently
queried and no production profile or wallet secrets were accessed for this fix.

Source inspection at published commit `4325df904ad415bd41b9d72edbd68c6d9daa2242`
confirmed two contributing defects:

- Unlock happened before import/rescan. HSD's default 60-second unlock lease
  could expire during the reported multi-minute preparation.
- The renderer rebuilt its submission payload by skipping newly ineligible
  rows, without invalidating the original confirmation.

## Changed behavior

- Freeze all reviewed names and base-unit amounts. Never silently omit a row.
- Construct an unsigned quote after synchronization. Show exact fee, per-name
  true bid/blind/lockup, aggregate lockup and transaction count for fresh approval.
- Unlock only after final approval, immediately before signing. Recheck bidding
  eligibility after preparation, review, unlock, signing and before broadcast.
- Independently reconcile every BID covenant, commitment, wallet-owned output,
  auction start height, change output, fee and row count against the review.
- Retain basket contents on failure and show per-name results plus actual stage.
- Bound preparation, cancellation, reconciliation and post-send display refresh.
  Leaving before broadcast cancels preparation, not the underlying wallet rescan.
- Pin wallet/node generations; prevent duplicate calls and late wallet-switch
  results. The node's internal synchronous `assertCurrent` callback must run
  after asynchronous storage preflight, immediately before transport send.
- Persist uncertainty before invoking broadcast. Retain the exact candidate ID;
  only that ID can establish successful reconciliation. Missing IDs, conflicting
  IDs, transport ambiguity and failed history reads remain retry-locked.
- Await relocking the captured wallet before releasing its mutation coordinator;
  cleanup failure must not hide an accepted or uncertain transaction outcome.

## Source verification on 2026-10-08

- `npm test`: 1338 Tape product assertions, 7 injected-service lifecycle tests,
  and 59 acceptance-harness tests passed.
- `npm run test:sync`: disposable fixtures passed, including the expected-failure
  baseline control and serialized overlap/recovery variants.
- `npm run build-renderer`: passed.
- `babel app/background -d dist/background`: passed.
- `git diff --check`: passed.

The service tests execute actual class method bodies with mocked I/O; covenant
tests use real HSD covenant objects. Harness tests are source/fixture tests, not
new signed-package acceptance. English, Chinese, Russian and Thai exact-review
copy was added; translations are AI-authored, not native-speaker approved.

## Release and integration gates

This patch is not in the existing public v2.3.14 artifacts. Integrate with the
Register All changes carefully: both touch transaction cleanup/context checks.
The NodeService `assertCurrent` boundary guard is shared with that patch and must
be included in the combined candidate. Independently review the combined diff,
rerun all tests, then test a newly built package against isolated delayed-rescan,
expiry, cancellation, wallet-switch and uncertain-broadcast fixtures.

No live bids, signing credentials, normal wallet profiles or real balances were
used. Recovery does not clear wallet data or basket rows. A verified successful
submission removes only the submitted rows after receiving its exact transaction
ID. The uncertainty lock deliberately requires reconciliation rather than blind
retry; it is not a claim of globally impossible duplicates across separate app
instances, erased storage, or manual transactions outside Auction Basket.
