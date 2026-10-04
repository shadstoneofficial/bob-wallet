# Bob LearnHNS dependency review — 2026-10-04

This review targets the production dependency graph at `c3acbfd7abebf5f301c5d0c5a820ab0dd8451a03`. The handoff snapshot reported 30 production vulnerability entries. After the targeted lockfile and renderer changes in this branch, `npm audit --omit=dev --json` reports five critical entries, all inherited from the same `bsock` advisory. The current npm advisory feed reports no remaining production high, moderate, or low entries.

## Changes

- The renderer API-key generator now uses `crypto.getRandomValues` through `secureRandomHex`, preserving the 20-byte key and 40-character hex output. The renderer no longer receives Node's `crypto` fallback. The polyfill plugin and Sass compiler are build-only dependencies.
- Compatible audited versions are pinned for `node-fetch`, Shakedex's `tar`, `path-to-regexp`, `lodash`, `immutable`, `moment`, `@babel/runtime`, `ajv`, `picomatch`, `tmp`, `get-func-name`, `cross-spawn`, and `semver`.
- Shakedex's `node-fetch` redirect behavior is covered by a local two-host test that verifies authorization and cookie headers are removed. Its backup helper is covered by creating and listing a synthetic archive; the app imports no Shakedex CLI or extraction path.

## Remaining advisory

The live production audit lists `bsock@0.1.9` via `bcurl@0.2.0`, `bweb@0.2.0`, and `hsd@6.1.1`; Shakedex also carries `bcurl@0.1.10`. GitHub Advisory Database entry [GHSA-jj93-39pf-7mcf](https://github.com/advisories/GHSA-jj93-39pf-7mcf) affects all `bsock` releases through `0.1.11` and currently lists no patched release. npm's remaining `bcurl`, `bweb`, `hsd`, and `shakedex` entries inherit that issue; they are not five independent fixes.

The weak MD5 calculation is in the vendored Hixie-76 legacy WebSocket handshake. The active RFC6455 handshake uses SHA-1 for its protocol-defined accept value. Bob's HSD and wallet HTTP services default to loopback, and the app's normal clients use those local services, but HSD configuration loading can override the bind host. Treat a deliberately externally bound RPC service as exposed to this residual risk. No replacement or local vendored patch is included because the upstream advisory has no fix and changing HSD's WebSocket stack would exceed a dependency-only compatibility repair.

## Validation

- `npm test`: 1,254 unit assertions and 55 packaged-harness tests passed.
- `npm run test:sync`: restore-overlap and real SPV restart fixtures passed, including 2- and 5-wallet recovery and unjournaled restart at height 10.
- `npm run build-renderer`: production renderer compiled; its bundle does not contain `crypto-browserify`, the browser `pbkdf2`/`cipher-base`/`sha.js` stack, or `createHash`/`randomFillSync` polyfills. The matching `elliptic` code is bcrypto's own `lib/js/elliptic.js`; the separately audited `elliptic@6.5.4` package is build-only through the excluded Node crypto polyfill.
- `npm run check-all-locales`: completed successfully.
- `git diff --check`: passed.
