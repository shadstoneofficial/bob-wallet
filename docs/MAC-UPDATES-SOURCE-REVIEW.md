# Updater source review — 2026-10-29

Base: `644131b34f24329ce87736a37899f76f4aea2e81` (v2.3.19).
Scope: manual Mac update delivery; no package/signing/publication performed.

## Review conclusions

- The old check contacted upstream `kyokan/bob-wallet`. It now uses our official
  stable-release endpoint, and the automatic startup invocation is removed.
- Native staging is deliberately deferred until explicit install and successful
  shutdown. `electron-updater`'s `update-downloaded` event alone does not prove
  native Squirrel verification; the adapter separately waits for Electron's
  native `update-downloaded` before calling `quitAndInstall`.
- A synchronous RPC admission fence closes the race between an idle check and
  asynchronous shutdown. Both queued and active wallet mutations count as busy.
  Sync throws, callbacks and Promise settlement release admission exactly once.
- Download cancellation closes the local proxy, including late download events.
  A cleanup exception cannot leave the controller in its downloading state or
  mask the original network/metadata failure; a dedicated regression covers this.
  Timeouts do not attach any late automatic-install continuation. Failed shutdown
  never reopens financial RPC admission. A recovery close retries shutdown only.
  Once explicitly requested native staging begins, Squirrel may complete it even
  after our timeout; a subsequent quit can apply that authorized staged update.
  The wallet is already closed. This native cancellation limitation is disclosed
  in the UI/runbook and requires real packaged acceptance.
- The updater does not read, delete, migrate or rewrite wallet profiles/receipts.
  Existing node shutdown code owns database closure. Private acceptance mode and
  development cannot invoke the live update flow.
- The UI renders text and an official release link, not release-supplied HTML.
  Unmount guards discard late responses; backend state survives navigation.

This is a same-agent source review, not independent security or packaged acceptance.
Reviewers should focus on shutdown/quit ordering, concurrent admission, native
publisher/version verification and the real two-version upgrade matrix in
`MAC-UPDATES.md`.

## Validation evidence

- Full source suite after compiling the disposable test database dependency:
  1,590 product assertions, 28 service/updater tests and 80 acceptance-harness
  source tests passed. No live wallet was launched. Initial fresh-checkout failure
  was missing `leveldown.node` because dependency install scripts were disabled;
  rebuilding only `bdb` for source tests resolved all seven affected tests.
- Production renderer and main/updater Babel compilation passed. Static locale
  preview compilation passed. Chinese/Russian/Thai key, placeholder, URL and
  technical-token parity checks passed.
- All 12 final updater tests pass, covering IPC fencing, native handoff with mocked Electron,
  manifest integrity, error/timeout paths, and component unmount behavior.
- Narrow/wide light/dark **visual review NOT TESTED**: browser control is disabled
  in this session. Inert previews are supplied via `npm run preview-locale`,
  `?screen=updates&locale=th-TH&theme=dark` (also en-US/zh-CN/ru-RU).
- Native signature rejection, signed upgrade, Gatekeeper, app replacement and
  profile reopening **NOT TESTED**. No installers or signing workflows ran.

## Dependency audit

Pinned `electron-updater@6.8.11` and `builder-util-runtime@9.7.0`. The updater's
YAML parser is overridden to `js-yaml@4.3.2`; npm initially reused an older parser
with advisories, which was corrected before handoff. Lockfile changes include
npm deduplication and promotion of shared dependencies to production. The only
changed version at an existing lockfile path is builder-util-runtime 9.1.1 → 9.7.0;
the older builder keeps its own compatible nested dependency.

`npm audit --omit=dev` reports the same five critical inherited package entries
(`bcurl`, `bsock`, `bweb`, `hsd`, `shakedex`), zero high/moderate/low entries.
This is not a zero-advisory release; retain the existing protocol-specific
mitigation and limitations in `dependency-audit-2026-10-04.md`.
