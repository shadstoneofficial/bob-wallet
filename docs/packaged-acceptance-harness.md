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
| Auction real-error Retry | Source fixture ready: fixed pre-signing failure and retained Retry evidence; packaged UI **NOT TESTED** |
| 20-name basket delayed construction | Source fixture ready: fixed 20-name inert plan and cancellation evidence; packaged UI **NOT TESTED** |
| Ambiguous basket outcome and duplicate lock | Source fixture ready: one inert unknown-outcome boundary and retry lock; packaged UI **NOT TESTED** |
| ShakeX review and DNS preservation | **NOT TESTED**: no controlled packaged listing fixture |
| Sequential restore | Generated-history plan and source orchestration ready; reviewed PR #18 replay target and packaged backend **NOT TESTED** |
| Overlapping restore | Generated five-request plan and source orchestration ready; reviewed PR #18 replay target and packaged backend **NOT TESTED** |

Source fixture evidence is not packaged acceptance. The backend startup/scan cause and restore implementation belong to the separate restore/rescan investigation; this harness does not ignore the `Pool is not connected!` assertion or claim to fix it.

The harness branch is now integrated with merged `master` at `5c224d0`, including the logged-out language dropdown from PR #16. ShakeX display work from PR #15 and restore/rescan work from PR #18 remain separate until their owners complete review. A later acceptance build must use a reviewed merge base containing every intended product change. Arthur reported that add-on browsing passed in installed v2.3.13; that result does not cover these proposed controlled fixture scenarios, and this harness is not a product acceptance pass.

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
2. The restore plans generate deterministic history summaries without seeds or private material and exercise a fake replay capability in source tests. They do not yet invoke PR #18's reviewed replay target or prove recovered balances/journal cleanup.
3. Auction and basket source fixtures are intentionally inert and make zero signing/live-broadcast calls, so those paths cannot yet be claimed as packaged UI tests.
4. ShakeX has no fixed listing/resource fixture, so review and DNS-record preservation remain source-test evidence only.
5. Custom RPC, filesystem durability across power loss and an OS-level crash are outside both harnesses.

## Minimal controlled fixture path

Keep every extension behind the same signed manifest allowlist. Do not add general RPC, file-read IPC or arbitrary method invocation.

1. **Restore lifecycle:** source plans now exist for fixed `restore-spv` and `restore-full` scenarios, deterministic generated history without recovery material, sequential targets, five overlap requests, and an injected first failure/retry. Next, connect only a reviewed PR #18 replay capability, emit its journal/status checkpoints, and require recovered balances, zero pending journal entries, quit/reuse, and clean teardown in the packaged app.
2. **Auction Retry:** the fixed `auction-retry` source fixture now retains one pre-signing error and reports zero signing/broadcast calls. Next, route that narrow failure adapter through the real packaged UI and assert the visible error plus one safe Retry.
3. **Twenty-name delayed basket:** the fixed 20-name inert source fixture now preserves all names, records one simulated construction, and proves cancellation stops continuation. Next, connect its deterministic gate to the packaged UI without allowing a raw transaction to reach a node client.
4. **Ambiguous basket outcome:** the fixed inert boundary now records one unknown-outcome call and a retry lock with zero signing/live broadcast. Next, persist that lock through packaged navigation/restart and verify the boundary count remains one.
5. **ShakeX preservation:** provide one fixed local resource containing ordinary DNS records and one ShakeX sale record through an allowlisted in-memory adapter. Assert review output changes only the intended sale record and preserves every unrelated DNS record; submission remains disabled.

Each scenario now has a source-level plan or remains explicitly unsupported, and still needs a disposable packaged run on the reviewed combined commit. Packaged rows stay **NOT TESTED** until those exact interfaces exist and pass. No paid packaging or signing should begin merely because PR #17 and PR #18 merge cleanly.
