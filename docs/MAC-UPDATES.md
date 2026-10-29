# Manual Mac updates

This feature requires one manual installation of the first updater-enabled Bob
release. It cannot add an updater to already installed v2.3.19 or earlier apps.

## User flow

Settings → General → App updates, or the app menu's Check for updates command,
checks the latest stable release of `shadstoneofficial/bob-wallet`. Checks contact
GitHub without wallet identifiers, keys or credentials. There is no startup
check, background download, automatic install on ordinary quit, or downgrade.

Supported Macs installed in Applications can download an architecture-specific
ZIP. Downloading only caches the payload; it does not invoke native staging.
Restart and install first acquires a backend admission fence and refuses active
RPCs, wallet mutations, imports/rescans, registration work and in-memory uncertain
basket attempts. It then closes Shakedex, the node/wallet and application database.
Only successful shutdown permits macOS native verification/staging and restart.
Windows/Linux and releases without update metadata offer official manual downloads.

Errors are visible. Check failures can retry. Download failures require reopening
Bob before another attempt, avoiding overlapping native updater instances. A
partially failed shutdown keeps wallet RPCs blocked; Finish closing Bob retries
orderly shutdown, without retrying a transaction or starting another download.
Pending receipts, profiles, keys and Shakedex backups are never cleared by updater code.

Once the user explicitly requests installation and native staging begins, Squirrel
does not expose a reliable cancellation API. If native staging times out, it may
still finish preparing that authorized update. Bob does not issue a late restart,
but a subsequent quit can apply a natively staged update. The wallet has already
closed before this boundary; do not describe a staging timeout as proof that the
old app will remain installed. Reopen Bob and check its displayed version.

GitHub release/version/asset URLs, file name, architecture, size and SHA-512 metadata
are checked before download. SHA-512 verifies transport integrity, not authorship.
macOS's native Squirrel verifier must accept the signed application before install.
Signed upgrade tests below are still required; source mocks cannot prove publisher
continuity, Gatekeeper acceptance, native staging or post-install profile recovery.

## Builder contract (no automatic publication)

The existing notarization script now creates each update ZIP from the same stapled
app used for the DMG, after signing/notarization. It does not invoke a second app
build or notarization. Expected additional assets:

- `Bob.LearnHNS-VERSION-arm64.zip` and `latest-arm64-mac.yml`
- `Bob.LearnHNS-VERSION-x64.zip` and `latest-x64-mac.yml`

Both manifests describe one exact ZIP with byte size and SHA-512. The workflow
collects these with checksums. ZIP contents must include the expected `.app`,
embedded commit/version, signature and stapled ticket. Do not publish manifests
for an unverified payload. Prepare all assets on a draft release, validate the
complete asset set, then publish the stable release. Never overwrite a published
version's update payload. Beta releases are not offered by this stable-only flow.

## Required independent review and packaged acceptance

No installer build, signing, merge or release is authorized by this source change.
Before enabling delivery to users, test an actual signed old → new update on
isolated disposable Mac profiles on native arm64 and Intel (also test x64 under
Rosetta). The test harness intentionally disables the live updater. A separately
reviewed isolated upgrade fixture is needed; do not repurpose a production profile.

Verify these cases with exact old/new SHAs and checksums:

1. No requests on startup; manual check, release notes, download progress, Later,
   normal quit after download without installation, then explicit install.
2. Valid signed/stapled upgrade preserves balances, wallet selection, receipts,
   ambiguous retry locks and Shakedex proof backups; new version reopens cleanly.
3. Foreign publisher, wrong architecture/version, changed ZIP hash, missing
   metadata, partial/offline download, low disk space and read-only/DMG launch fail
   without changing the installed app or wallet data.
4. Install is rejected during signing, broadcast, queued mutations, restore,
   rescan and registration work. New RPCs cannot enter after shutdown admission.
5. Shutdown failures never start native staging. Native staging failures/timeouts
   retain blocked wallet operations and clearly report the uncertain staging
   outcome. Late events cannot trigger an app-initiated restart; exercise the
   native subsequent-quit behavior described above.
6. EN/Chinese/Russian/Thai, narrow/wide light/dark; Windows/Linux manual fallback.

Native verification and installer replacement are NOT TESTED by Node tests or
static UI fixtures. A source-test pass is not public-release approval.
