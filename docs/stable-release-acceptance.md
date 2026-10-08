# Next stable release acceptance

Status: source integration in progress, 2026-10-08. This is a release gate, not a passed acceptance report.

## Scope

- Preserve reviewed v2.3.14 beta behavior from `4325df904ad415bd41b9d72edbd68c6d9daa2242`.
- Auction Basket: preserve approved names and values, require explicit exact-fee approval, and prevent silent subset retries or late broadcasts after cancellation.
- Register All: retain per-name results and transaction IDs, recover partial completion, and lock ambiguous outcomes against duplicate retry.
- Owned-name detail: balanced Shakedex and ShakeX entry points separate from DNS records, using existing workflows and translated labels.
- Exclude resolver/helper work and unrelated new features.

## Source gates

1. Review the complete combined diff, including shared wallet signing, relocking and node broadcast boundaries.
2. Run the full product assertions, service lifecycle tests, packaged-harness source tests, sync fixtures, locale checks and production compilation on the exact candidate.
3. Confirm the transaction transport guard checks the captured wallet/backend context after asynchronous storage preflight, immediately before sending.
4. Verify failed or cancelled work preserves names and amounts, uncertain results survive navigation/restart, and cleanup errors cannot erase a known transaction result.
5. Confirm EN, zh-CN, ru-RU and th-TH labels/placeholders match and selling-option controls fit narrow/wide light/dark views.
6. Record the fresh production dependency audit and retain the existing protocol-specific bsock mitigation and limitations. Do not describe it as a zero-advisory release.

## Packaged gates

The builder must use the final reviewed master commit, not an older beta SHA or an uncommitted worktree. Existing tags and release assets must remain untouched. New source tests do not constitute packaged acceptance.

- Produce fresh Apple Silicon, Intel, Windows x64 and Linux x86_64 artifacts with exact source/version/run provenance and checksums.
- Verify both Mac applications and DMGs: architecture, Developer ID signature, notarization, stapling, Gatekeeper and integrity. Distinguish Rosetta from native Intel runtime evidence.
- Bind tests to the exact executable and fresh disposable profile paths. Never locate the test app by display name or open installed production profiles.
- Repeat embedded SPV startup, interrupted recovery from 5/20 through 20/20, repeated synchronized reopen and wallet switching. Fail on structured backend errors, including Pool is not connected.
- Exercise overlapping restore/import admission with isolated fixtures, not just a fresh onboarding screen.
- Basket: delayed construction, post-rescan unlock, explicit exact-fee approval, expiry of one reviewed name, scope mismatch, cancellation/navigation/unmount, wallet changes during preflight, exact-once completion, and ambiguous outcome persistence. A subset must not broadcast without fresh review.
- Register All: one success followed by preparation failure; retained remaining names; safe resume without repeating the first transaction; ambiguous send and reload retry lock; stopped/navigation operation cannot send another registration.
- Exercise per-name receipts and actual component/IPC paths. Distinguish inert transport fixtures, generated regtest signing, and real transport tests in the report.
- Verify both selling routes without publishing listings, changing DNS records, or sending funds; verify languages and persistence.
- Report Windows/Linux installation coverage and signing status accurately. Preserve Shakedex proof/listing backup warnings.

## Final decision

Arthur receives the exact accepted arm64 artifact, SHA-256, commit and isolated acceptance instructions before broad promotion. Stable publication follows passed gates and resolution of blocking findings, not simply a version bump. No real wallet credentials, existing profiles or live transactions are authorized for this work.
