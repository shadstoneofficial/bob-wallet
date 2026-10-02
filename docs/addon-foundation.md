# Bob Add-On Foundation v1

This first foundation is build-time metadata for Bob's existing trusted Add
Ons catalog. It is not a plugin installer, sandbox, permission broker, package
format, signature verifier, update system, or security boundary.

## Contract

Every built-in manifest has:

- `schemaVersion: 1`;
- a stable lowercase/hyphenated ID and semantic version;
- display name, description, and publisher attribution;
- one entry kind;
- an explicit capability list, including an empty list when appropriate;
- exact HTTPS origins, including an empty list when none are used; and
- explicit supported Handshake networks.

Entry kinds are intentionally narrow:

| Kind | Meaning in v1 |
| --- | --- |
| `trusted-bundled-route` | Route implemented and reviewed as Bob application code |
| `external-content` | Fixed HTTPS destination opened through Bob's existing external confirmation flow |
| `native-service` | Bob-owned background/native functionality; never remote Add-On code |

The registry validates manifests at module load, rejects duplicate stable IDs,
and provides deterministic lookup. Catalog navigation derives from the
validated entry, so a display definition cannot silently replace its route or
external URL. Existing destinations remain `/exchange`,
`/send?asset=name&mode=send`, and `https://liquidity.spot/p2p`.

Liquidity's existing user-configured channel selection remains host-managed
Bob behavior. The manifest records the default `https://liquidity.spot`
origin; it does not convert that declaration into an allowlist or supersede
the existing channel validation and external confirmation flow.

## Capabilities are declarations, not enforcement

The allowlist catches unknown or misspelled declarations and marks
`resolver.requestSystemDnsControl` as native-service-only. It does not make
trusted renderer code less privileged and does not authorize an operation.
The subsystem that owns an action must still authenticate the caller, verify
current state, prompt when required, and independently enforce policy.

In particular, a resolver Add-On must never receive a privileged helper
handle, arbitrary command channel, network-interface configuration, restore
record, node API key, DNS queries, seed, or wallet secret. A future facade may
offer sanitized status and host-owned request/confirmation flows only. The
signed native helper and exact DNS restoration remain Bob core responsibilities.

## Registered ShakeX adapter

`app/addons/shakex/manifest.js` registers `shakex` version `1.0.0` as a trusted
bundled route at `/addons/shakex`, with the exact `https://shakex.fun` origin.
It declares listing discovery, fixed external links, selected-name resource
reading, reviewed record proposals and owned-name navigation. The public feed
is mainnet-only; isolated regtest listing tests use Bob's core Records flow.
The catalog derives identity/navigation from the registry and retains English
and Simplified Chinese presentation keys. It does not declare paid-transfer
import, wallet signing or resolver capabilities. Bob remains responsible for
all review, ownership, freshness and submission checks.

## Coordination examples are not installed

`app/addons/examples.js` contains validated design contracts for:

- Bob's Name Quest as fixed external content with only `external.openUrl` and
  no wallet/name capabilities; and
- Bob System DNS as a native service with no network origins and a
  host-mediated control request.

They are deliberately absent from `builtInAddonRegistry`. Importing the
examples installs no route, service, code, package, or catalog card.

## Future untrusted runtime boundary

Before Bob accepts third-party bundles, a separate reviewed design must add:

- signed package provenance and publisher identity;
- safe extraction, size/file-count limits, immutable install directories, and
  atomic update/rollback/uninstall;
- a sandboxed process with no Node integration, wallet clients, unrestricted
  IPC, filesystem, Electron remote APIs, or inherited renderer privileges;
- a versioned host bridge that validates every request independently of the
  manifest and shows Bob-owned review for sensitive actions;
- origin/network/storage limits, resource quotas, revocation, incident
  response, compatibility checks, and audit logs without wallet secrets; and
- adversarial package, lifecycle, confused-deputy, downgrade, and escape tests.

A valid manifest is only well-formed input. It is never evidence that code is
safe, installed, isolated, approved, or entitled to a declared capability.

## Validation

Run the focused checks with dependencies installed:

```sh
node app/addons/tests/foundation.spec.cjs
```

The checks cover malformed/unknown fields, unsafe entries and origins, unknown
or duplicated capabilities, native-only capability misuse, duplicate IDs,
missing lookups, prohibited catalog overrides, exact navigation compatibility,
the registered ShakeX adapter and localized catalog, and the non-installed
status of the two remaining coordination examples.
