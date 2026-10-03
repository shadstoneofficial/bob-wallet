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

The launcher requires an absolute profile root, refuses the normal `~/Library/Application Support/Bob LearnHNS` profile, sets `userData` before services initialize, uses local regtest P2P/SPV with DNS peers disabled, generates new API keys and two disposable encrypted wallets, and enables no transaction fixture. It adds no RPC or file IPC. The local activation token and disposable wallet passphrase remain in the mode-0600 manifest and are never production credentials.

The main process opens the renderer before waiting for the disposable WalletDB fixture. This ordering is required because the renderer starts the local node and wallet plugin; waiting for WalletDB first would deadlock a clean launch. A regression test withholds wallet readiness until the window exists.

Each launch receives its own status and backend-event files, so a current result cannot be confused with an earlier run. Sentry is disabled in packaged test modes, and interactive acceptance shutdown uses the same bounded node/database teardown and structured backend-error gate as the automated smoke test.

## Honest acceptance matrix

| Case | Facility status |
| --- | --- |
| Packaged startup, shutdown and backend errors | Ready |
| Same disposable profile restart | Ready |
| Generated multiwallet switching | Ready |
| English/Simplified Chinese selection and persistence | Ready for manual packaged review |
| Auction real-error Retry | **NOT TESTED**: no exact packaged auction-error fixture |
| 20-name basket delayed construction | **NOT TESTED**: transaction fixture disabled |
| Ambiguous basket outcome and duplicate lock | **NOT TESTED**: transaction fixture disabled |
| ShakeX review and DNS preservation | **NOT TESTED**: no controlled packaged listing fixture |
| Sequential restore | **NOT TESTED**: backend interface pending sync investigation |
| Overlapping restore | **NOT TESTED**: backend interface pending sync investigation |

Source tests for the unsupported rows remain useful regression evidence but are not packaged acceptance. The backend startup/scan cause and restore implementation belong to the separate restore/rescan investigation; this harness does not ignore the `Pool is not connected!` assertion or claim to fix it.

The logged-out language dropdown (PR #16) and ShakeX display work (PR #15) are separate product changes and are not included in this harness branch. A later acceptance build must use a reviewed merge base containing the intended product changes. Arthur's add-on acceptance remains pending; this harness is not a product acceptance pass.

## Integration with the restore/rescan lifecycle work

PR #18 and this harness are mechanically compatible. Their only shared file is `package.json`; the combined result retains both `test:sync` and `test:packaged-harness`. PR #18 installs its embedded WalletDB lifecycle adapter before the wallet plugin opens. The harness sets the isolated `userData` path and writes the local regtest connection configuration before node and wallet services start, so the adapter operates only on the disposable profile during packaged acceptance.

The harness records recognized hsd, WalletDB, node-client, assertion, startup and shutdown failures from process startup through bounded teardown. Its explicit shutdown calls `NodeService.stop()`, which closes the hsd node and therefore exercises PR #18's WalletDB close adapter. A structured backend error or incomplete teardown makes the smoke/acceptance process exit nonzero. This is detection, not proof that PR #18 fixes `Pool is not connected!`; the combined packaged run must still demonstrate zero structured backend errors.

Interactive acceptance cannot select the ordinary profile accidentally:

- activation requires the opt-in environment flag, a 32-byte token matching a mode-0600 manifest, and the dedicated launcher acknowledgement;
- `userData`, status and event files must resolve below the manifest's isolated profile root;
- both launcher and runtime reject `~/Library/Application Support/Bob LearnHNS` and descendants;
- filesystem-real containment and a recursive symlink check prevent aliases back into normal application data;
- the app applies the isolated `userData` path before loading any backend service; and
- the configured network is pinned to local regtest/P2P, and hsd config-file, command-line and environment loading are disabled in acceptance mode;
- the launcher strips inherited `HSD_*` variables, while backend checks independently force the disposable prefix, SPV, no-DNS and regtest settings for direct launches;
- critical raw DB IPC writes and deletes are blocked, so the renderer cannot replace the node directory, network, connection type, SPV mode, helper endpoint or API keys before restarting the node;
- Custom RPC and network-setting changes are rejected, and renderer IPC cannot invoke seed import, signing, transaction construction or broadcast methods;
- node-level raw transaction, claim and airdrop broadcasts are blocked below the renderer boundary; and
- the launcher removes inherited smoke-mode variables while the runtime rejects simultaneous smoke and acceptance modes.

Current integration blockers are acceptance coverage, not merge conflicts:

1. The packaged profile is hard-coded to SPV. PR #18 also needs a full-node packaged quit/restart run.
2. The current fixture creates two fresh wallets; it does not create recoverable histories or issue overlapping restore/rescan requests.
3. Transaction fixtures are intentionally disabled, so auction Retry and delayed/ambiguous basket paths cannot yet be claimed as packaged tests.
4. ShakeX has no fixed listing/resource fixture, so review and DNS-record preservation remain source-test evidence only.
5. Custom RPC, filesystem durability across power loss and an OS-level crash are outside both harnesses.

## Minimal controlled fixture path

Keep every extension behind the same signed manifest allowlist. Do not add general RPC, file-read IPC or arbitrary method invocation.

1. **Restore lifecycle:** add fixed `restore-spv` and `restore-full` scenario IDs plus an allowlisted `nodeMode`. Inside the disposable regtest profile, generate source wallets and local history, save only their disposable recovery material in the mode-0600 fixture manifest, then drive two/five overlap, sequential restore, injected first-scan failure, quit and reuse through one test-only main-process scenario runner. It should emit structured checkpoints and counters to the existing status file. It must never accept a caller-supplied path, key or network. Reuse PR #18's journal/status observations and require recovered balances, zero pending journal entries after success, and clean bounded teardown.
2. **Auction Retry:** add one fixed `auction-retry` scenario that supplies a known regtest name and injects one pre-signing backend failure through a narrow service adapter. Assert the UI retains the real error and enables one safe Retry. Keep signing and broadcast functions replaced by fail-closed counters.
3. **Twenty-name delayed basket:** add one fixed 20-name regtest dataset and a deterministic construction gate. Assert all names survive while construction is delayed, cancellation prevents continuation, and exactly one simulated construction occurs. No raw transaction may reach a node client.
4. **Ambiguous basket outcome:** use a fixed simulated broadcast boundary that records one attempted call and returns an unknown outcome. Assert Retry stays locked after navigation/restart and the call count remains one. This fixture must operate on inert bytes and must not construct, sign or relay an HNS transaction.
5. **ShakeX preservation:** provide one fixed local resource containing ordinary DNS records and one ShakeX sale record through an allowlisted in-memory adapter. Assert review output changes only the intended sale record and preserves every unrelated DNS record; submission remains disabled.

Each scenario needs a source-level regression first, then a disposable packaged run on the reviewed combined commit. Unsupported rows stay **NOT TESTED** until those exact interfaces exist and pass. No paid packaging or signing should begin merely because PR #17 and PR #18 merge cleanly.
