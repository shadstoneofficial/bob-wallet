# Simplified Chinese volunteer review — PR #9

Status: **awaiting an independent native Simplified Chinese reviewer**.
The language selector is disabled. Please review wording only with synthetic
fixtures; never enter a real seed/private key or construct/send a real transaction.

- [Chinese translation](https://github.com/shadstoneofficial/bob-wallet/blob/codex/simplified-chinese/locales/zh-CN.json)
- [English source](https://github.com/shadstoneofficial/bob-wallet/blob/codex/simplified-chinese/locales/en.json)
- [Existing draft PR #9](https://github.com/shadstoneofficial/bob-wallet/pull/9)
- [Terminology and fixture instructions](../simplified-chinese-translation.md)
- [Review evidence/screenshots](zh-CN-review.md)

Please record the exact reviewed commit, your name/handle, date, proposed key/value
corrections, and an explicit approve / changes requested verdict. Branch links
move; pin them to the reviewed commit when recording acceptance.

## Checklist

- [ ] Natural Mainland Simplified Chinese; consistent wallet terms; no misleading promises.
- [ ] Seed phrase, private key, password: preserve backup/loss/phishing/clipboard warnings and restoration limits (`backupWarning*`, `obBackupSeed*`, `obImport*`, `revealSeed*`, `removeWalletAck*`).
- [ ] Construction ≠ signing ≠ broadcast ≠ chain confirmation (`createNewTransaction`, `sign*`, `multisigTx*`, `txView*`, `basket*Status`, `basket*Help`).
- [ ] Uncertain broadcast never says nothing was sent or retry is safe; retry stays disabled (`basketRetryUncertain`, `basketPreviousUncertain`, `basketRetrySafe`, `basketFailedStage`).
- [ ] True bid + blind = lockup; blind is not a fee. OPEN is not BID; batch bids share a transaction and still require reveal (`bid*`, `blind*`, `basket*`, `openBasket*`).
- [ ] Reveal deadlines/loss warnings, losing-bid redeem, and winning-name register remain distinct (`reveal*`, `redeem*`, `register*`, `repairBid*`).
- [ ] Transfer starts a process; finalize completes it after lockup. Recipient, cancellation, and paid-transfer warnings are precise (`transfer*`, `finalize*`, `bulkFinalize*`, `claimNamePayment*`).
- [ ] Local proof signing, channel publication, and on-chain transfer are distinct; proof expiry and private-proof access risks remain clear (`generateListingProof*`, `submitListingProof*`, `privateSale*`, `proofBackupWarning`).
- [ ] Every `%s` still has the correct meaning and order; URLs, identifiers, CSV schema and formatting remain exact.
- [ ] Warnings and action labels remain readable in the narrow/wide fixture screenshots. Flag awkward line breaks or clipped text with the key and screen.

AI passes and automated checks are supporting evidence, not native approval.
Do not enable the selector until all checks and the recorded review pass on the
release candidate revision. This checklist is ready to share with a volunteer;
no Telegram message has been sent by this task.
> Decision update, 2026-10-02: The maintainer approved merging PR #9 and enabling
> Simplified Chinese for the next planned build. Independent native-speaker
> feedback is deferred until that build is available. Earlier disabled-selector
> and pre-merge native-review requirements below are historical and superseded
> by this decision. Native approval has not been claimed; release-head testing
> and follow-up wording corrections remain outstanding. No public build is
> authorized by this change.
