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

The launcher requires an absolute profile root, refuses the normal `~/Library/Application Support/Bob LearnHNS` profile, sets `userData` before services initialize, and uses local regtest with DNS peers and outbound P2P sockets disabled. Only HTTP services bind to loopback. It generates new API keys and two disposable encrypted wallets (five for restore scenarios), and enables no signing or live transaction fixture. The only added IPC is read-only `Acceptance.describe`, not generic RPC or file access. The local activation token and disposable wallet passphrase remain in the mode-0600 manifest and are never production credentials.

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
| 20-name basket delayed construction | Source product path ready: real 20-name UI/action/coordinator path, cancellation/preservation, and exactly one completed inert boundary with a transaction ID before basket clearing; packaged UI **NOT TESTED** |
| Ambiguous basket outcome and duplicate lock | Source product path ready: real inert boundary, Redux duplicate lock, draft/navigation reuse and visible error; packaged UI **NOT TESTED** |
| ShakeX review and DNS preservation | Real `ListingForm` review/edit/removal and browsing/search use fixed local data; NS, DS and ordinary TXT preservation passes in source DOM tests; packaged UI **NOT TESTED** |
| Embedded restore quit/reuse | Actual `NodeService`/`WalletService` disk profiles survive two separate source processes in full-node and SPV modes; request ID, target 20, admission closure and five selectable wallets' balances/history verified; packaged backend **NOT TESTED** |
| Sequential restore | Retained in-memory fixture invokes PR #18's real `installLocalRescan` with generated hsd regtest coinbase histories; five balances recovered in full-node and SPV source fixtures; packaged backend **NOT TESTED** |
| Overlapping restore | Five full-node scans complete; five concurrent SPV requests are correctly rejected during replay. Native journal, injected failure/recovery and partial WalletDB reopen pass; packaged backend **NOT TESTED** |

Source product-path evidence is not packaged acceptance. The low-level wallet methods are fixed inert adapters, and no signing or live broadcast method is available. A mutation regression proves the delayed-basket scenario fails when the component cancellation guard is removed. The backend startup/scan cause and restore implementation belong to the separate restore/rescan investigation; this harness does not ignore the `Pool is not connected!` assertion or claim to fix it.

The source-only integration combines reviewed harness head `279d271eb30d47b8f22b1359b6b648e0f66b820a` and restore head `00dbbab268aeeb579da5ab03938ffc2b13df9bcc`, followed by runtime work and local merges of reviewed PR #15 head `a402006f6a79d29d4317f4bd4dacb255c9453714` and PR #19 head `bf7a9811f74d96e115df2c6236ff9a580352de97`. Only `shakexSearchLabel`, `walletRescanWaiting`, and `walletRescanFailed` locale tails were reconciled. Resolver PR #13 remains excluded. The GitHub PRs and `master` have not been merged or modified. A later acceptance build must use the exact reviewed final source commit. Arthur's installed v2.3.13 add-on browsing result does not cover these controlled fixture scenarios.

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
2. App restore initialization now uses the actual isolated embedded NodeService/WalletService disk profile. Two separate source processes prove clean quit/reuse, preserved request identity/target, closed admission during pending recovery and five selectable wallets' recovered balances/history. Retained in-memory tests remain separate. Neither facility proves packaged execution, power-loss durability or existing-profile migration.
3. Auction and basket source fixtures now drive the real component, Redux action and submission coordinator with fixed inert low-level adapters. They make zero signing/live-broadcast calls, but still cannot be claimed as packaged UI tests.
4. ShakeX has fixed listing/resource data and real source DOM review/removal/search coverage; installed packaged UI review remains untested.
5. Custom RPC, filesystem durability across power loss and an OS-level crash are outside both harnesses.

## Minimal controlled fixture path

Keep every extension behind the same token-validated, fixed-scenario manifest allowlist. The manifest is mode-0600 local state; it is not cryptographically signed. Do not add general RPC, file-read IPC or arbitrary method invocation.

1. **Restore lifecycle:** fixed `restore-spv` and `restore-full` app initialization privately generates exactly 20 coinbase-only blocks for five generated selectable wallets in the embedded disposable profile. Full-node fixed scan failure and SPV partial replay stop at height 5 and retain request ID/target 20 in the real disk journal. A second source process reuses the same profile and requires matching balances/history, cleared journal and reopened admission. Normal rescan-state actions expose the full-node failure and subsequent recovery. Next, verify packaged-node quit/reuse and clean teardown on the reviewed build.
2. **Auction Retry:** the fixed `auction-retry` source fixture drives the real component, action and coordinator, retains the visible pre-signing error, invokes Retry once and reaches no broadcast boundary. Next, run the same allowlisted adapter through the packaged UI.
3. **Twenty-name delayed basket:** the fixed 20-name source fixture drives real product cancellation, preserves every row, invokes low-level cancellation and proves late preparation cannot continue. A separate fresh-process source DOM test lets delayed construction finish, verifies exactly one construction/one inert boundary and a transaction ID, and only then clears the basket. A mutation that removes the component guard makes the cancellation fixture fail. Next, run both through the packaged UI without enabling raw signing or broadcast.
4. **Ambiguous basket outcome:** the fixed inert boundary drives the real coordinator once, then verifies the Redux duplicate lock and persisted draft safety state across component/navigation reuse. Next, verify the same one-call lock across packaged quit/reuse.
5. **ShakeX preservation:** one fixed resource contains NS, DS, ordinary TXT and a sale TXT record. Actual form review/edit/removal preserves unrelated records. Actual browsing/search uses the fixed local IPC catalog and never fetches ShakeX; submission and external links are disabled. Next, verify the same interfaces in the packaged build.

Each scenario now has a source-level plan or remains explicitly unsupported, and still needs a disposable packaged run on the reviewed combined commit. Packaged rows stay **NOT TESTED** until those exact interfaces exist and pass. No paid packaging or signing should begin merely because PR #17 and PR #18 merge cleanly.

## Persistent runtime integration

Validated acceptance startup installs only a read-only `Acceptance.describe` IPC method. Private fixture initialization cannot be invoked through renderer IPC. Existing basket Wallet endpoints receive fixed inert implementations; every other raw signing/import/broadcast deny remains in place. Seed and master-key export and arbitrary block generation are denied too. Exact fixed names and amounts (`1000000`/`2000000`, number or canonical base-unit string) are required. A prepared attempt must match before either inert outcome can run.

The ambiguity state is persisted before the error is returned under a protected disposable DB key. Renderer writes/deletes to that key are rejected. A real bdb test uses two separate source Node processes to prove profile reuse retains the one-boundary lock. Effective cancellation is idempotent when both the component and coordinator cancel the same attempt; request and effective-cancellation counters are reported separately.

Fixtures are on the explicit `/acceptance-fixtures` route, not an unconditional replacement for App. Login, the actual language picker, disposable-wallet selection, Settings, history, Addons and auction routes remain reachable. Backend errors take priority over every route. Acceptance login skips seed-export verification only for these generated fixtures; ordinary wallet verification remains unchanged, and raw `revealSeed` stays denied. Acceptance startup skips update/HIP2 network initialization while preserving normal local node startup and activity handling.

### Evidence boundaries

- Source DOM tests drive real `AuctionBasket`, Redux actions, coordinator, IPC client/server and the inert backend. They cover failure/Retry, Back/unmount cancellation, 20 preserved rows, navigation/remount locks, actual ShakeX form changes/removal and browsing/search.
- Routing regressions mount actual connected App, AccountLogin, AppHeader and LanguagePicker; destination pages and wallet actions are mocked. They prove route/error visibility, not complete Settings or wallet backend acceptance.
- Embedded restore source tests use actual NodeService/WalletService, actual disk Chain/WalletDB, five selectable generated wallets and loopback HTTP. Only Electron window dispatch and unused hardware integration are mocked. Two independent processes prove clean quit/reuse, not OS crashes, filesystem fsync or power-loss durability. External TCP/UDP is prohibited in those tests.
- Retained restore unit fixtures separately drive real replay/locks over in-memory data and WalletDB close/reopen; do not label these as embedded restart tests.
- The ambiguity journal also has a separate two-process disk-backed bdb test.
- No installer, signed app, packaged UI, real wallet, existing Bob profile, live transaction, PR merge, tag or release is covered or authorized by these source tests.
