# Packaged acceptance harness

This harness exists because v2.3.13 could print a backend assertion during a fresh isolated SPV startup while its packaged smoke process still returned success. It is test-only and disabled during ordinary Bob launches.

## Smoke behavior

The packaged smoke run now:

- records hsd, WalletDB, node-client, assertion and shutdown errors as structured events without suppressing their original console output;
- performs a bounded local-node and database shutdown before writing success;
- requires `shutdownCompleted: true` and zero backend error events;
- terminates a hung child with bounded `SIGTERM` then `SIGKILL`; and
- fails when an error occurs after an otherwise successful report.

The regression fixture in `scripts/tests/fixtures/smoke-shutdown-assertion.cjs` reproduces the old false-green shape.

## Interactive disposable profile

Only use this with a later reviewed packaged build containing the harness:

```sh
node scripts/launch-packaged-acceptance-macos.js \
  "/Applications/Bob LearnHNS.app" \
  --profile-root "/tmp/bob-v2.3.x-arthur-acceptance" \
  --initialize \
  --scenario multiwallet \
  --accept-disposable-profile
```

To reopen the same isolated profile:

```sh
node scripts/launch-packaged-acceptance-macos.js \
  "/Applications/Bob LearnHNS.app" \
  --profile-root "/tmp/bob-v2.3.x-arthur-acceptance" \
  --reuse \
  --accept-disposable-profile
```

The launcher requires an absolute profile root, refuses the normal `~/Library/Application Support/Bob LearnHNS` profile, sets `userData` before services initialize, uses local regtest P2P with DNS peers disabled, generates new API keys and two disposable encrypted wallets, and enables no signing or live transaction fixture. It adds no RPC or file IPC. The local activation token and disposable wallet passphrase remain in the mode-0600 manifest and are never production credentials.

Initialization accepts only these built-in scenario IDs: `multiwallet`, `restore-spv`, `restore-full`, `auction-retry`, `basket-20-delayed`, and `basket-ambiguous`. The scenario fixes its node mode; callers cannot choose a different network, seed, history, name list, transaction payload, or filesystem path. Reuse cannot change scenarios.

The main process opens the renderer before waiting for the disposable WalletDB fixture. This ordering is required because the renderer starts the local node and wallet plugin; waiting for WalletDB first would deadlock a clean launch. A regression test withholds wallet readiness until the window exists.

The renderer's only unconditional protected startup write is its normal persistence of the selected network. The DB policy permits that path only when the value is exactly `regtest`; an IPC-level regression drives clean startup and profile reuse through the real renderer thunk, fake node/wallet services, and the guarded DB client, then proves a `main` write is rejected before `Node.start`.

Each launch receives its own status and backend-event files, so a current result cannot be confused with an earlier run. Sentry is disabled in packaged test modes, and interactive acceptance shutdown uses the same bounded node/database teardown and structured backend-error gate as the automated smoke test.

## Honest acceptance matrix

| Case | Facility status |
| --- | --- |
| Packaged startup, shutdown and backend errors | Ready |
| Same disposable profile restart | Ready |
| Generated multiwallet switching | Ready |
| English/Simplified Chinese selection and persistence | Ready for manual packaged review |
| Auction real-error Retry | Source product path ready: real `AuctionBasket.onSubmit` -> `sendBidMany` -> `submitBidManyLifecycle`, fixed pre-signing failure, visible error and Retry; packaged UI **NOT TESTED** |
| 20-name basket delayed construction | Source product path ready: real 20-name UI/action/coordinator path, back-navigation cancellation and basket preservation; packaged UI **NOT TESTED** |
| Ambiguous basket outcome and duplicate lock | Source product path ready: real inert boundary, Redux duplicate lock, draft/navigation reuse and visible error; packaged UI **NOT TESTED** |
| ShakeX review and DNS preservation | Real `ListingForm` review/edit/removal and browsing/search use fixed local data; NS, DS and ordinary TXT preservation passes in source DOM tests; packaged UI **NOT TESTED** |
| Sequential restore | App fixture initialization invokes PR #18's real `installLocalRescan` with generated hsd regtest coinbase histories; five balances recovered in full-node and SPV source fixtures; packaged backend **NOT TESTED** |
| Overlapping restore | Five full-node scans complete; five concurrent SPV requests are correctly rejected during replay. Native journal, injected failure/recovery and partial WalletDB reopen pass; packaged backend **NOT TESTED** |

Source product-path evidence is not packaged acceptance. The low-level wallet methods are fixed inert adapters, and no signing or live broadcast method is available. A mutation regression proves the delayed-basket scenario fails when the component cancellation guard is removed. The backend startup/scan cause and restore implementation belong to the separate restore/rescan investigation; this harness does not ignore the `Pool is not connected!` assertion or claim to fix it.

The source-only integration combines reviewed harness head `279d271eb30d47b8f22b1359b6b648e0f66b820a` with reviewed restore head `00dbbab268aeeb579da5ab03938ffc2b13df9bcc` in local merge `147b79dd055590b753df4931d64b28d273909d6a`, followed by the runtime work described below. The GitHub PRs and `master` have not been merged or modified. ShakeX display PR #15 remains outside this integration. A later acceptance build must use the exact reviewed final source commit. Arthur's installed v2.3.13 add-on browsing result does not cover these controlled fixture scenarios.

## Integration with the restore/rescan lifecycle work

PR #18 and this harness previously passed a mechanical merge-tree check, but that is not a complete integration verdict. Both branches now modify `app/background/node/service.js`, `app/background/wallet/service.js`, and `package.json`; a reviewed combined branch must preserve PR #18's WalletDB lifecycle adapter, this harness's backend isolation policy, and both test scripts. PR #18 installs its embedded WalletDB lifecycle adapter before the wallet plugin opens. The harness sets the isolated `userData` path and writes the local regtest connection configuration before node and wallet services start, so the adapter must operate only on the disposable profile during packaged acceptance.

The harness records recognized hsd, WalletDB, node-client, assertion, startup and shutdown failures from process startup through bounded teardown. Its explicit shutdown calls `NodeService.stop()`, which closes the hsd node and therefore exercises PR #18's WalletDB close adapter. A structured backend error or incomplete teardown makes the smoke/acceptance process exit nonzero. This is detection, not proof that PR #18 fixes `Pool is not connected!`; the combined packaged run must still demonstrate zero structured backend errors.

Interactive acceptance cannot select the ordinary profile accidentally:

- activation requires the opt-in environment flag, a 32-byte token matching a mode-0600 manifest, and the dedicated launcher acknowledgement;
- `userData`, status and event files must resolve below the manifest's isolated profile root;
- both launcher and runtime reject `~/Library/Application Support/Bob LearnHNS` and descendants;
- filesystem-real containment and a recursive symlink check prevent aliases back into normal application data;
- the app applies the isolated `userData` path before loading any backend service; and
- the configured network is pinned to local regtest/P2P, and hsd config-file, command-line and environment loading are disabled in acceptance mode;
- the launcher strips inherited `HSD_*` variables, while backend checks independently force the disposable prefix, SPV, no-DNS and regtest settings for direct launches;
- critical raw DB IPC writes and deletes are blocked except for exact idempotent acceptance values (`regtest`, P2P, SPV and no-DNS), so normal renderer startup can persist `regtest` but cannot replace the node directory, network, connection type, helper endpoint or API keys before restarting the node;
- Custom RPC and network-setting changes are rejected, and renderer IPC cannot invoke seed import, signing, transaction construction or broadcast methods;
- node-level raw transaction, claim and airdrop broadcasts are blocked below the renderer boundary; and
- the launcher removes inherited smoke-mode variables while the runtime rejects simultaneous smoke and acceptance modes.

Current integration blockers are acceptance coverage, not merge conflicts:

1. `restore-spv` and `restore-full` now pin their respective local node modes, but neither has completed a packaged quit/restart run.
2. Restore initialization now invokes the reviewed adapter against separate in-memory Chain/WalletDB/NodeClient objects and real generated regtest coinbases. This proves source recovery and journal behavior, not the embedded packaged node, process crash durability, or an existing profile.
3. Auction and basket source fixtures now drive the real component, Redux action and submission coordinator with fixed inert low-level adapters. They make zero signing/live-broadcast calls, but still cannot be claimed as packaged UI tests.
4. ShakeX has fixed listing/resource data and real source DOM review/removal/search coverage; installed packaged UI review remains untested.
5. Custom RPC, filesystem durability across power loss and an OS-level crash are outside both harnesses.

## Minimal controlled fixture path

Keep every extension behind the same token-validated, fixed-scenario manifest allowlist. The manifest is mode-0600 local state; it is not cryptographically signed. Do not add general RPC, file-read IPC or arbitrary method invocation.

1. **Restore lifecycle:** fixed `restore-spv` and `restore-full` initialization runs real generated-history replay through PR #18's adapter, emits journal/status checkpoints and recovered balances, and requires zero pending journal entries. Full-node injected scan failure and SPV injected reset failure preserve their journals and recover after WalletDB close/reopen. SPV also reopens at partial height 5 with target 20 unchanged. Next, verify embedded packaged-node quit/reuse and clean teardown on the reviewed build.
2. **Auction Retry:** the fixed `auction-retry` source fixture drives the real component, action and coordinator, retains the visible pre-signing error, invokes Retry once and reaches no broadcast boundary. Next, run the same allowlisted adapter through the packaged UI.
3. **Twenty-name delayed basket:** the fixed 20-name source fixture drives real product cancellation, preserves every row, invokes low-level cancellation and proves late preparation cannot continue. A mutation that removes the component guard makes the fixture fail. Next, run it through the packaged UI without enabling raw signing or broadcast.
4. **Ambiguous basket outcome:** the fixed inert boundary drives the real coordinator once, then verifies the Redux duplicate lock and persisted draft safety state across component/navigation reuse. Next, verify the same one-call lock across packaged quit/reuse.
5. **ShakeX preservation:** one fixed resource contains NS, DS, ordinary TXT and a sale TXT record. Actual form review/edit/removal preserves unrelated records. Actual browsing/search uses the fixed local IPC catalog and never fetches ShakeX; submission and external links are disabled. Next, verify the same interfaces in the packaged build.

Each scenario now has a source-level plan or remains explicitly unsupported, and still needs a disposable packaged run on the reviewed combined commit. Packaged rows stay **NOT TESTED** until those exact interfaces exist and pass. No paid packaging or signing should begin merely because PR #17 and PR #18 merge cleanly.

## Persistent runtime integration

Validated acceptance startup installs only a read-only `Acceptance.describe` IPC method. Private fixture initialization cannot be invoked through renderer IPC. Three existing Wallet endpoints receive fixed inert implementations; every other raw signing/import/broadcast deny remains in place. Exact fixed names and amounts (`1000000`/`2000000`, number or canonical base-unit string) are required. A prepared attempt must match before the inert ambiguous boundary can run.

The ambiguity state is persisted before the error is returned under a protected disposable DB key. Renderer writes/deletes to that key are rejected. A real bdb test uses two separate source Node processes to prove profile reuse retains the one-boundary lock. Effective cancellation is idempotent when both the component and coordinator cancel the same attempt; request and effective-cancellation counters are reported separately.

Fixtures are on the explicit `/acceptance-fixtures` route, not an unconditional replacement for App. Login, the actual language picker, disposable-wallet selection, Settings, history, Addons and auction routes remain reachable. Backend errors take priority over every route. Acceptance login skips seed-export verification only for these generated fixtures; ordinary wallet verification remains unchanged, and raw `revealSeed` stays denied. Acceptance startup skips update/HIP2 network initialization while preserving normal local node startup and activity handling.

### Evidence boundaries

- Source DOM tests drive real `AuctionBasket`, Redux actions, coordinator, IPC client/server and the inert backend. They cover failure/Retry, Back/unmount cancellation, 20 preserved rows, navigation/remount locks, actual ShakeX form changes/removal and browsing/search.
- Routing regressions mount actual connected App, AccountLogin, AppHeader and LanguagePicker; destination pages and wallet actions are mocked. They prove route/error visibility, not complete Settings or wallet backend acceptance.
- Restore initialization drives real reviewed hsd replay, locks, metadata writes, balances and WalletDB reopen. Its Chain and WalletDB data are in memory; filesystem fsync and OS/process-crash durability are not claimed.
- The ambiguity journal's separate two-process bdb test is disk-backed, but does not establish restore WalletDB disk durability.
- No installer, signed app, packaged UI, real wallet, existing Bob profile, live transaction, PR merge, tag or release is covered or authorized by these source tests.
