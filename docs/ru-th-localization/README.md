# Russian, Thai, and More Addons localization

Baseline: master `5c224d01e592b7263da7f72c0270836e9344fd57`.
Branch: `codex/russian-thai-localization` in the reused clean login-language checkout.
The merged PR #9 and #16 branch refs were not changed.

## Scope and translation provenance

- Selectable **Русский** (`ru-RU`) and **ไทย** (`th-TH`) in both shared Settings and logged-out selectors. `ru`, `ru-RU`, `th`, `th-TH`, and case variants normalize to canonical preferences. Persistence, hydration, failed saves, races and English/custom fallback retain the shared preference path.
- 1,302 keys in each of English, Simplified Chinese, Russian and Thai: 1,278 master keys plus 24 catalog keys. Catalog reuses existing labels and drops its unused static Liquidity description instead of creating a redundant key.
- Translated directly from English. Google Translate supplied draft assistance for part of the public English locale; the translation agent corrected terminology and reviewed security wording. This is AI-assisted review, **not independent native-human acceptance**. Native feedback remains welcome after the user-authorized selectable rollout.
- Five intentionally unchanged complete values: `overviewHealthSpv` (SPV), `notApplicable` (—), `lockedLearnMoreURL` (URL), `settingShakedexChannelApi` (API), and `shakedex` (Shakedex). Proper names, technical identifiers, hostnames, sample handles, amounts and protocol tokens within sentences remain literal. No English placeholder/filler values are intentionally left.
- Dates use the existing `toLocaleString` presentation path, including Thai locale calendar conventions. Transaction amounts and CSV parsing stay unchanged. Russian duration abbreviations and neutral count labels avoid adding a new plural engine; Thai uses normal classifiers. Tests exercise 0, 1, 2, 5, 11, 21 and 22. Historical airdrop/auction descriptions retain the English source's historical content; this is not a factual update of those descriptions.
- Interpolation now substitutes each `%s` once using a callback. An argument containing `%s` or `$&` remains literal, including custom locale text. The document language tracks the selected locale for text rendering.

## More Addons boundaries

Only catalog presentation, its existing channel controls, and the external-opening notice changed. Display-name metadata does not overwrite registry names. Manifest IDs, routes, origins, capabilities, channel storage and transaction behavior are unchanged. Resolver Directory is a catalog card only; resolver screens, game features and swap actions are outside scope. DocsHelp accepts an optional translated button label for this catalog; other callers retain their existing label.

Narrow-window review found catalog channel overflow and Settings footer overflow. Catalog controls and card headings now wrap; Settings labels and controls wrap instead of extending beyond the viewport. Tables retain their existing internal horizontal scroll where needed.

## Validation

Run from this checkout, with its existing dependency symlink; no install or package commands:

```sh
node scripts/check-locale.js zh-CN
node scripts/check-locale.js ru-RU
node scripts/check-locale.js th-TH
node --test scripts/check-locale.test.js
npm test
node app/addons/tests/foundation.spec.cjs
node app/addons/shakex/client.spec.cjs
node app/addons/shakex/records.spec.cjs
node app/addons/shakex/ui.spec.cjs
```

The validator now also guards ShakeX, catalog protocol/brand tokens and known bare hostnames. No validation rule was weakened. Test results and the exact delivered Git head are recorded in the PR/handoff; source fixture compilation is not a production build.

## Offline visual evidence

```sh
npm run preview-locale
python3 -m http.server 8142 --bind 127.0.0.1 --directory test-dist/locale-preview
```

Open `http://127.0.0.1:8142/?screen=login&locale=th-TH&theme=dark`.
Use `screen=settings|send|confirm|review|addons`, `locale=ru-RU|th-TH`, `theme=light|dark`, and `shell=1` for the synthetic sidebar. For basket failure use `phase=failed`; `uncertain=0` selects proven pre-broadcast failure. `offset` exposes lower sections without activating wallet controls.

[Saved screenshots](screenshots/) use `<locale>-<width>-<theme>-<screen>.jpg`.
Reviewed at **800×700** and **1280×900**, in both themes and locales: login selector, General Settings, send form, transaction confirmation, basket failed/uncertain and safe-retry warnings, catalog and external-opening notice. Thai combining marks and Cyrillic labels were checked in rendered fixtures. Longer tables scroll inside their existing containers.

Fixtures render actual components with synthetic values and no lifecycles, hydration, signing, transaction construction, or broadcasting. Wallet IPC, file access and network calls fail closed; CSP blocks external connections and fonts. Selection/persistence tests use mocked settings. The review navigation and sidebar are fixture-only. These screenshots are source/component evidence on the available browser, **not Windows/Linux/macOS packaged acceptance**, native-speaker approval, or coverage of every dialog/backend error.

## Pending PR coordination

At inventory time PR #15 `a402006f6a79d29d4317f4bd4dacb255c9453714` and PR #18 `7fa5ccc63e1e5376552ea2250086313a25bb2453` remained open. [Prepared locale tails](pending-locale-tails.json) contain their exact English/Chinese strings and reviewed Russian/Thai translations for `shakexSearchLabel`, `walletRescanWaiting`, and `walletRescanFailed`. They are intentionally outside runtime locales until those source changes land, so this branch does not announce unsupported Unicode search or import wallet implementation. Reconcile these three entries after integration, preserve both branches' test imports, and rerun parity and the complete suite on the integrated head.

No merge, tags, installers, signing or release publication. Commits use `[skip ci]` to avoid automatically starting the repository's build jobs under the user's no-paid-build instruction; local test evidence does not claim remote CI passed.

### PR #13 development-only DNS status copy

PR #13 remains open at `50cc6135bbd57df15c9a256f573a27411d409877`. Five additional exact English keys from that head are prepared in `pending-locale-tails.json`: `systemDnsDevelopmentStatus`, `systemDnsDevelopmentDescription`, `systemDnsResolverReady`, `systemDnsResolverUnavailable`, and `systemDnsRunTest`. Russian/Thai preserve the development-only, read-only and cannot-change-system-DNS limits. “Unavailable” describes current eligibility, not a diagnosed DNS failure. The PR #13 owner’s Chinese values were subsequently verified and copied from `4e35a77ab5e9424fd92d117b9b0501049e994a0a`, with their separate source head recorded. These remain handoff data only, with no resolver implementation or runtime locale change.

The incoming set now covers eight entries across #13/#15/#18. The five DNS values pass the existing parity/placeholder/URL/token/markup CLI when added to temporary full English/Russian/Thai locale fixtures (1,307 keys each). Application code remains the tested `800f580` tree; this documentation-only coordination update does not require repeating the application suite.
