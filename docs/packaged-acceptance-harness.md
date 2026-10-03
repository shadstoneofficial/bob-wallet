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
