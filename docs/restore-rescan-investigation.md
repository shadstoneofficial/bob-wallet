# Overlapping restore investigation (2026-10-03)

Base: `0c66695f3cec4c47af4d519b8f052df5701d2736` (v2.3.13), hsd v6.1.1.

A real embedded-backend deadlock is reproduced and addressed here. This does **not** establish why Oscar's installation remained at 48.08%. His version, OS, node mode, exact restore order, heights and logs are still unknown. A percentage alone cannot distinguish chain download, WalletDB replay and stale renderer state.

## Confirmed findings

hsd delivers `Chain` block-connect callbacks while holding `chain.locker`. Its embedded `NodeClient` awaits WalletDB block handling, which acquires `wdb.txLock`. Conversely, stock `WalletDB.rescan()` acquires `txLock`, rolls back, then requests `chain.locker` through `NodeClient.rescan()` and `Chain.scan()` (full node) or `Chain.reset()` (SPV).

A restore/rescan racing a new block therefore creates a cycle:

- block connect: owns chain mutex, awaits WalletDB mutex;
- rescan: owns WalletDB mutex, awaits chain mutex.

The fixtures park a real block-connect callback immediately before WalletDB delivery, start a rescan, observe its real chain-lock request, then release block delivery. Both real mutexes remain busy with one waiter each on the baseline. This is backend deadlock, not merely a frozen percentage. Five restores with no incoming block at that boundary finish normally: overlap increases opportunities for the race but does not invariably cause it.

A separate reporting defect is confirmed by inspection and regression: Bob previously replaced `heightBeforeRescan` with the current partial wallet height on every new request. An original target of 100 could become 48 when another restore starts. The new embedded-backend state keeps the target, distinguishes waiting/scanning/failure, and gives each recovery generation an identity so the basket waiter can detect a fast scan that starts and completes between polls.

Arthur's packaged v2.3.13 report also reproduces a fresh-SPV startup assertion: `WalletDB.syncNode()` performs its first SPV `Chain.reset()` during `hsd.open()`, before `NodeService` calls `hsd.connect()`. The reset reaches `Pool.forceSync()` while `Pool.connected` is false and emits `Pool is not connected!`. The adapter now defers this initial local sync and `NodeService` resumes it after `hsd.connect()`. A real in-memory hsd SPVNode fixture reproduces the assertion without the adapter and completes cleanly with the new ordering. This explains Arthur's startup failure; it is separate from the overlap lock cycle and does not establish Oscar's reported cause.

## Scope and entry points

- `ImportSeedFlow.finishFlow`: calls `importSeed` with its chosen rescan height. The wallet service creates the wallet, then starts the rescan under one import admission; it does not wait for the rescan to finish before opening the wallet UI.
- `WalletService.rescan`: Settings rescan, restore onboarding, account recovery, `importName` and batched `importNames` ultimately reach the shared WalletDB.
- Seed restores, single/bulk name imports, and account recovery reserve the shared recovery admission before mutating imported state. A second restore/import gets a clear busy or restart-required error while a recovery is queued, scanning, or failed. New empty-wallet creation and ordinary chain synchronization do not use this guard.
- hsd wallet HTTP/RPC recovery/import paths also call `wdb.rescan`; patching only the onboarding component would miss them.
- P2P full-node and SPV modes use the embedded plugin. The adapter is installed before plugin open and covers shared `rescan`, `syncNode` and close lifecycle. It retains hsd's own WalletDB lock and scan implementation.
- Custom RPC creates a separate `WalletNode` using a remote node client. There is no local chain mutex to coordinate. Its behavior remains unchanged; this PR does not claim a Custom RPC fix or network-outage reproduction.
- Selected-wallet Redux generations protect history requests. Shared recovery state intentionally survives A → B → A switches and renderer unmount. This PR does not change wallet selection or signing.
- Bulk name import still observes progress without awaiting an indefinitely pending rescan reply. Basket cancellation, late-broadcast prevention, transaction reservations and ambiguous-outcome retry locking remain in their existing paths and tests.

## Implementation and preservation

`localRescan.js` consistently acquires the chain mutex before WalletDB operations. An `AsyncLocalStorage` ownership token permits the embedded client to call hsd's unlocked `chain.db.scan` / `chain._reset` only while that operation actually owns the chain mutex. Tokens become inactive on exit, including for descendant callbacks. This adapter deliberately depends on hsd v6.1.1 internals: review it when upgrading hsd.

The native lock queues remain the scheduler; no UI timeout unlock is added. No navigation event cancels or rewinds a scan. A final block event updates displayed height only. Recovery becomes complete only after the backend scan succeeds, the journal acknowledgement is written, and WalletDB releases its transaction lock. At that safe boundary the chain lock is released even if a wrapper-level RPC reply remains pending, allowing the next queued scan to run without bypassing WalletDB's lock.

Before waiting for a backend mutex, each accepted request writes its required height to WalletDB metadata under `ff626f622d72657363616e2d7631` (outside hsd's ASCII key layout). The record contains only monotonically increasing request numbers and heights. Success acknowledges the request only after the scan and journal write succeed; failures in the scan, initial sync or journal read/parse/ack path publish failed state and retain pending records. On startup/reconnect, unacknowledged requests are recovered from the earliest required height. SPV acknowledges after the durable rewind completes; ordinary hsd synchronization resumes the remaining download from its persisted WalletDB state. Startup sync waits until the embedded pool is connected. Shutdown drains owned locks and preserves accepted waiting requests for restart. New requests after shutdown begins reject explicitly.

No seed, key, wallet identifier, path or credential is added to metadata. No existing wallet/schema records are deleted or rewritten by a migration, and there is no database version bump. Normal rescans retain hsd's existing rollback/replay behavior. Older Bob versions ignore the additional metadata, but **do not resume it**: downgrading while recovery is pending is not an acceptance-tested workflow. A crash after imported wallet creation but before the rescan journal write can still leave that wallet without a recorded recovery request. Power-loss/fsync behavior has not been tested.

Failure state remains visible until pending recovery succeeds during restart/reconnect. There is no automatic transaction retry. The UI uses two new English/Simplified Chinese strings; native-speaker review remains open.

## Reproduce and validate

```sh
npm test
npm run test:sync
node scripts/check-locale.js zh-CN
node scripts/check-locale.test.js
npm run build
```

`npm run test:sync` runs baseline and adapter variants in separate processes. All fixture keys are freshly generated; all chain/wallet data is in memory, with no existing profiles, sockets, transaction relay or external services. Fixtures mine disposable regtest coinbases solely to verify restored history. The SPV startup fixture opens a real hsd node and WalletDB while blocking TCP/UDP listeners and peer connections; it reproduces the baseline assertion, then models the post-`Pool.connect()` readiness boundary in memory and verifies that deferred sync succeeds. The lock-cycle baseline exits only after asserting both sides of the real lock cycle; it does not force-unlock a database. Watchdogs fail a hung fixture.

For PR #17 packaged scenarios, retain the same disposable-profile boundary: local regtest only, generated fixtures, no external/custom RPC, no supplied recovery phrase or key, and transaction construction/sign/broadcast disabled. The synthetic `Pool.connected` flip is limited to the source startup fixture; a packaged acceptance result must report the real local startup and bounded shutdown events. Source fixtures do not count as packaged acceptance.

Verified results:

| Check | Result |
| --- | --- |
| Stock full-node lock-cycle fixture | Chain 21, wallet 0; both mutexes waiting |
| Patched full-node same interleaving | Chain 21, wallet 21; both operations complete |
| Stock SPV lock-cycle fixture | Chain 21, wallet 0; both mutexes waiting |
| Patched SPV | Five restores during partial replay; WalletDB reconstructed at height 5; all histories recovered; incoming-block race completes; replay reaches 21 |
| Full-node two/five overlap, five sequential, failed first scan | Every restored wallet finds its history; maximum one active scan |
| Startup-order fixture | Baseline reports `Pool is not connected!`; adapter defers sync until pool readiness and finishes without errors; memory database, zero sockets |
| Journal unit fixtures | Queued coverage, earliest-height restart recovery, preliminary sync/journal/ack failures, shutdown and rejected late request |
| Completion/queue fixtures | Final height alone never marks ready; scan and ack failures after target remain failed; a second queued scan runs after durable completion while the first wrapper reply is unresolved |
| Import/action fixtures | Active/queued/failed recovery blocks another restore/import; empty wallet creation and normal chain sync remain available; generation detects fast start-to-complete cycles; switch/unmount remains safe |
| Existing + new unit suite | 816 assertions passed, including basket no-late-broadcast/retry-lock regressions |
| Locale | 1,278 English/Chinese keys valid; 12 validator regressions passed |
| Local build | Not rerun for this review follow-up; packaged acceptance remains open |

These are **source fixture, unit, locale and earlier local-build results**, not packaged application acceptance. WalletDB reconstruction reuses an in-memory database image; it is not an OS crash or filesystem durability test. No public binaries were built, signed, tagged, uploaded or published.

## Remaining acceptance and safe support

Before release: review the hsd private-method adapter and metadata compatibility; run disposable packaged full-node/SPV restore and quit/restart acceptance on supported OSes; obtain native-speaker review; investigate Custom RPC separately if that is Oscar's mode. Background selected-wallet balance refresh has older asynchronous behavior beyond these shared-progress tests; no claim is made that all renderer data races are resolved.

For Oscar, collect only Bob version, OS, node mode, restore order/start heights and non-sensitive observations of chain versus wallet heights over time. Do not request seeds, wallet files, API keys or unrestricted logs. Until packaged acceptance, restore one wallet at a time and wait for synchronization before the next. Preserve existing backups; do not delete databases, deep-clean or force recovery. A restart may break the old in-memory lock cycle but is not proof that all older queued recovery requests were retained by v2.3.13.

Clickable Sync details and bounded, redacted user-initiated exports belong in a separate diagnostics PR. Settings > General currently exports node `debug.log`; application logging is separate (`hsd_output/combined.log`). This PR introduces no log-reading IPC, automatic upload or export claims.
