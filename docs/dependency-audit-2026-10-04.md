# Bob LearnHNS dependency review — 2026-10-04

This review targets the production dependency graph at `c3acbfd7abebf5f301c5d0c5a820ab0dd8451a03`. The handoff snapshot reported 30 production vulnerability entries. After the targeted lockfile and renderer changes in this branch, `npm audit --omit=dev --json` reports five critical entries, all inherited from the same `bsock` advisory. The current npm advisory feed reports no remaining production high, moderate, or low entries.

## Changes

- The renderer API-key generator now uses `crypto.getRandomValues` through `secureRandomHex`, preserving the 20-byte key and 40-character hex output. The renderer no longer receives Node's `crypto` fallback. The polyfill plugin and Sass compiler are build-only dependencies.
- Compatible audited versions are pinned for `node-fetch`, Shakedex's `tar`, `path-to-regexp`, `lodash`, `immutable`, `moment`, `@babel/runtime`, `ajv`, `picomatch`, `tmp`, `get-func-name`, `cross-spawn`, and `semver`.
- Shakedex's `node-fetch` redirect behavior is covered by a local two-host test that verifies authorization and cookie headers are removed. Its backup helper is covered by creating and listing a synthetic archive; the app imports no Shakedex CLI or extraction path.

## Remaining advisory

The live production audit lists `bsock@0.1.9` via `bcurl@0.2.0`, `bweb@0.2.0`, and `hsd@6.1.1`; Shakedex also carries `bcurl@0.1.10`. GitHub Advisory Database entry [GHSA-jj93-39pf-7mcf](https://github.com/advisories/GHSA-jj93-39pf-7mcf) affects all `bsock` releases through `0.1.11` and currently lists no patched release. npm's remaining `bcurl`, `bweb`, `hsd`, and `shakedex` entries inherit that issue; they are not five independent fixes.

The weak MD5 calculation is in the vendored Hixie-76 legacy WebSocket handshake. The active RFC6455 handshake uses SHA-1 for its protocol-defined accept value; [RFC 6455 §10.8](https://www.rfc-editor.org/rfc/rfc6455#section-10.8) says the handshake does not rely on SHA-1 collision or second-preimage resistance. Bob's node and wallet HTTP servers are both created by HSD before they open, so the app installs a narrow guard on each raw HTTP server before `open()`. It accepts only version 13 and returns HTTP 426 for unversioned or unsupported WebSocket upgrades before `bweb` can dispatch them to `bsock`. This remains effective when HSD config overrides the default loopback bind host.

Bob's local `NodeClient` and `WalletClient`, plus the custom RPC client created by `NodeService.createCustomRPCClient`, use the vendored `bsock` client. That client always sends WebSocket version 13 and checks the server accept value; malformed replies fail the connection without a legacy retry. Authentication remains the existing API-key flow after the WebSocket handshake. The npm advisory entries remain because the affected package is still installed, but the supported Bob node/wallet server paths now reject the legacy handshake before its MD5 routine. The guard does not alter HSD P2P or replace the vendored library.

## Validation

- `npm test`: 1,254 unit assertions and 59 packaged-harness tests passed after a clean `npm ci` with native dependency rebuilds enabled.
- `npm run test:sync`: restore-overlap and real SPV restart fixtures passed, including 2- and 5-wallet recovery and unjournaled restart at height 10.
- `npm run build-renderer`: production renderer compiled; its bundle does not contain `crypto-browserify`, the browser `pbkdf2`/`cipher-base`/`sha.js` stack, or `createHash`/`randomFillSync` polyfills. The matching `elliptic` code is bcrypto's own `lib/js/elliptic.js`; the separately audited `elliptic@6.5.4` package is build-only through the excluded Node crypto polyfill.
- `scripts/tests/websocket-policy.test.cjs`: Hixie-76 is rejected before upgrade listeners on both HSD servers; RFC6455 version 13 succeeds; malformed accept responses fail without fallback.
- `npm audit --omit=dev --json`: five critical package entries remain (`bcurl`, `bsock`, `bweb`, `hsd`, and `shakedex`), all inherited from GHSA-jj93-39pf-7mcf; zero low, moderate, or high entries. The app-owned node/wallet admission guard prevents the legacy handshake path on Bob's HSD HTTP servers.
- `app/background/hip2/tests/alias.spec.js`: a signed ECDSA P-256 delegated DNSSEC RRset remains verified in the main process after the renderer crypto fallback is removed.
- `npm run check-all-locales`: completed successfully.
- `git diff --check`: passed.
