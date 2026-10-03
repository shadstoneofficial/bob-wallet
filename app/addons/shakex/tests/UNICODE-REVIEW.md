# ShakeX Unicode display review — 2026-10-03

Based on remote master `0c66695f3cec4c47af4d519b8f052df5701d2736` in an isolated checkout. The merged ShakeX branch and dirty primary checkout are untouched.

Bob's existing `app/utils/nameHelpers.js` formatter calls `punycode.toUnicode` without display validation. The new ShakeX-only helper uses the existing npm `punycode` dependency (`punycode/` selects the package instead of Node's deprecated built-in module) and Handshake `verifyName`. Only canonical lowercase labels that pass Handshake validation, decode and round-trip exactly can display Unicode. Controls, bidi formatting, separators, private-use/unassigned characters, leading combining marks and invisible characters fall back to ASCII. Emoji variation selectors are supported; joiner-containing sequences deliberately retain ASCII in this conservative first policy.

Unicode is not guaranteed spoof-safe: homoglyphs and mixed scripts remain possible. The original canonical punycode is always shown below a decoded heading. The heading isolates Unicode in `bdi dir=auto` inside an LTR container; the slash and canonical audit label remain LTR. Emoji font fallbacks include Apple Color Emoji, Segoe UI Emoji and Noto Color Emoji. Local macOS Electron rendering is verified; Windows/Linux font appearance still depends on installed system fonts.

Display/search does not mutate the feed or replace `item.name`, React keys, routes, record data or transaction identifiers. Existing actions remain fixed navigation links; no per-name deal import is introduced. Unicode and case-insensitive ASCII/punycode queries match the displayed/canonical label respectively. Hazardous decoded strings are not used for Unicode search.

## Verification

- `node app/addons/shakex/tests/displayName.spec.cjs`: supplied `xn--k77hya` (🇬🇸), `xn--ep8h` (🐹), `xn--ev9h` (🧔), ASCII, malformed ACE, controls/bidi/invisibility, Unicode search, long/mixed-script labels and canonical identity preservation pass.
- `node app/addons/shakex/ui.spec.cjs`: actual React headings, secondary ASCII, Unicode/ASCII search, direction isolation and unchanged external action destinations pass.
- Existing client/resource checks pass; full `npm test` passes **745 assertions**. The focused standalone checks are additional to that count.
- `node scripts/check-locale.js zh-CN`: all 1,276 keys valid; `node scripts/check-locale.test.js`: 12 cases pass.
- Offline fixture compilation and Electron rendering pass:

```sh
node app/addons/shakex/tests/unicode-build.cjs
node_modules/.bin/electron app/addons/shakex/tests/unicode-desktop.cjs
```

The fixture compiles only the ShakeX screen to `/tmp/bob-shakex-unicode`, supplies synthetic listings, blocks HTTP(S), uses a disposable user-data directory and has no wallet bridge. It checks EN/zh-CN at 600/1200px, supplied emoji glyphs, canonical labels, Unicode/ASCII search, long-label wrapping and mixed-direction layout. Reviewed screenshots are in `evidence/` alongside these tests. This is not an installed-app or cross-OS font verification.

No production build, packaging, signing, tagging, publication or real wallet access was performed. The fixture compilation and test compilation are local verification only.
