# Overlapping restore investigation (2026-10-03)

Base: `0c66695f3cec4c47af4d519b8f052df5701d2736` (v2.3.13), hsd v6.1.1.

A real embedded-backend deadlock is reproduced and addressed here. This does **not** establish why Oscar's installation remained at 48.08%. His version, OS, node mode, exact restore order, heights and logs are still unknown. A percentage alone cannot distinguish chain download, WalletDB replay and stale renderer state.

## Confirmed findings

hsd delivers `Chain` block-connect callbacks while holding `chain.locker`. Its embedded `NodeClient` awaits WalletDB block handling, which acquires `wdb.txLock`. Conversely, stock `WalletDB.rescan()` acquires `txLock`, rolls back, then requests `chain.locker` through `NodeClient.rescan()` and `Chain.scan()` (full node) or `Chain.reset()` (SPV).

A restore/rescan racing a new block therefore creates a cycle:

- block connect: owns chain mutex, awaits WalletDB mutex;
- rescan: owns WalletDB mutex, awaits chain mutex.

The fixtures park a real block-connect callback immediately before WalletDB delivery, start a rescan, observe its real chain-lock request, then release block delivery. Both real mutexes remain busy with one waiter each on the baseline. This is backend deadlock, not merely a frozen percentage. Five restores with no incoming block at that boundary finish normally: overlap increases opportunities for the race but does not invariably cause it.

A separate reporting defect is confirmed by inspection and regression: Bob previously replaced `heightBeforeRescan` with the current partial wallet height on every new request. An original target of 100 could become 48 when another restore starts. The new embedded-backend state keeps the target, distinguishes waiting/scanning/failure, and prevents basket preparation from treating an earlier scan's final height as completion of a queued scan.

## Scope and entry points

- `ImportSeedFlow.finishFlow`: awaits `importSeed`, then starts `rescan` without waiting for completion. `importSeed` creates a wallet; it does not itself scan.
- `WalletService.rescan`: Settings rescan, restore onboarding, account recovery, `importName` and batched `importNames` ultimately reach the shared WalletDB.
- hsd wallet HTTP/RPC recovery/import paths also call `wdb.rescan`; patching only the onboarding component would miss them.
- P2P full-node and SPV modes use the embedded plugin. The adapter is installed before plugin open and covers shared `rescan`, `syncNode` and close lifecycle. It retains hsd's own WalletDB lock and scan implementation.
- Custom RPC creates a separate `WalletNode` using a remote node client. There is no local chain mutex to coordinate. Its behavior remains unchanged; this PR does not claim a Custom RPC fix or network-outage reproduction.
- Selected-wallet Redux generations protect history requests. Shared recovery state intentionally survives A → B → A switches and renderer unmount. This PR does not change wallet selection or signing.
- Bulk name import still observes progress without awaiting an indefinitely pending rescan reply. Basket cancellation, late-broadcast prevention, transaction reservations and ambiguous-outcome retry locking remain in their existing paths and tests.

## Implementation and preservation

`localRescan.js` consistently acquires the chain mutex before WalletDB operations. An `AsyncLocalStorage` ownership token permits the embedded client to call hsd's unlocked `chain.db.scan` / `chain._reset` only while that operation actually owns the chain mutex. Tokens become inactive on exit, including for descendant callbacks. This adapter deliberately depends on hsd v6.1.1 internals: review it when upgrading hsd.

The native lock queues remain the scheduler; no separate long-lived rescan-promise queue or UI timeout unlock is added. No navigation event cancels or rewinds a scan. Seeing the final block can complete progress reporting before the corresponding promise settles, but **never forcibly releases a backend mutex**. A genuinely broken backend promise that still owns a mutex cannot safely be bypassed based only on a displayed height.

Before waiting for a backend mutex, each accepted request writes its required height to WalletDB metadata under `ff626f622d72657363616e2d7631` (outside hsd's ASCII key layout). The record contains only monotonically increasing request numbers and heights. Success acknowledges that request; failure retains it. On startup/reconnect, unacknowledged requests are recovered from the earliest required height. SPV acknowledges after the durable rewind completes; ordinary hsd synchronization resumes the remaining download from its persisted WalletDB state. Shutdown drains owned locks and preserves accepted waiting requests for restart. New requests after shutdown begins reject explicitly.

No seed, key, wallet identifier, path or credential is added to metadata. No existing wallet/schema records are deleted or rewritten by a migration, and there is no database version bump. Normal rescans retain hsd's existing rollback/replay behavior. Older Bob versions ignore the additional metadata, but **do not resume it**: downgrading while recovery is pending is not an acceptance-tested workflow. A crash between wallet creation and the separate rescan IPC request remains outside this journal's accepted-request guarantee. Power-loss/fsync behavior has not been tested.

Failure state remains visible until pending recovery succeeds during restart/reconnect. There is no automatic transaction retry. The UI uses two new English/Simplified Chinese strings; native-speaker review remains open.

## Reproduce and validate

```sh
npm test
npm run test:sync
node scripts/check-locale.js zh-CN
node scripts/check-locale.test.js
npm run build
```

`npm run test:sync` runs both baseline and adapter variants in separate processes. All fixture keys are freshly generated; all chain/wallet data is in memory, with no existing profiles, sockets, transaction relay or external services. Fixtures mine disposable regtest coinbases solely to verify restored history. The baseline deadlock process exits only after asserting both sides of the real lock cycle; it does not force-unlock a database. Watchdogs fail a hung fixture.

Verified results:

| Check | Result |
| --- | --- |
| Stock full-node lock-cycle fixture | Chain 21, wallet 0; both mutexes waiting |
| Patched full-node same interleaving | Chain 21, wallet 21; both operations complete |
| Stock SPV lock-cycle fixture | Chain 21, wallet 0; both mutexes waiting |
| Patched SPV | Five restores during partial replay; WalletDB reconstructed at height 5; all histories recovered; incoming-block race completes; replay reaches 21 |
| Full-node two/five overlap, five sequential, failed first scan | Every restored wallet finds its history; maximum one active scan |
| Journal unit fixtures | Queued coverage, earliest-height restart recovery, failed scan/write, shutdown and rejected late request |
| UI/action fixtures | Stable target, waiting/failure, A → B → A, unmount/reopen, final-block reporting with unresolved reply, queued scan cannot release transaction preparation |
| Existing + new unit suite | 795 assertions passed, including basket no-late-broadcast/retry-lock regressions |
| Locale | 1,278 English/Chinese keys valid; 12 validator regressions passed |
| Local build | Renderer and main-process compile pass; 176 compiled files / 61 reachable main-process modules validated |

These are **fixture and local-build results**, not packaged application acceptance. WalletDB reconstruction reuses an in-memory database image; it is not an OS crash or filesystem durability test. No public binaries were built, signed, tagged, uploaded or published.

## Remaining acceptance and safe support

Before release: review the hsd private-method adapter and metadata compatibility; run disposable packaged full-node/SPV restore and quit/restart acceptance on supported OSes; obtain native-speaker review; investigate Custom RPC separately if that is Oscar's mode. Background selected-wallet balance refresh has older asynchronous behavior beyond these shared-progress tests; no claim is made that all renderer data races are resolved.

For Oscar, collect only Bob version, OS, node mode, restore order/start heights and non-sensitive observations of chain versus wallet heights over time. Do not request seeds, wallet files, API keys or unrestricted logs. Until packaged acceptance, restore one wallet at a time and wait for synchronization before the next. Preserve existing backups; do not delete databases, deep-clean or force recovery. A restart may break the old in-memory lock cycle but is not proof that all older queued recovery requests were retained by v2.3.13.

Clickable Sync details and bounded, redacted user-initiated exports belong in a separate diagnostics PR. Settings > General currently exports node `debug.log`; application logging is separate (`hsd_output/combined.log`). This PR introduces no log-reading IPC, automatic upload or export claims.
