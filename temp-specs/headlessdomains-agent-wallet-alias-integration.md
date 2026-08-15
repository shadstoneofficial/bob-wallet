# HeadlessDomains `.agent` wallet alias integration

## Case

This case tracks secure Bob LearnHNS wallet resolution for HeadlessDomains names such as `@janice.agent` and `@mike.agent`.

The work is broader than one domain. It covers the integration between:

- Bob LearnHNS alias resolution;
- HSD/BNS recursive DNS and DNSSEC validation;
- the Handshake `.agent` namespace;
- SkyInclude-hosted delegated SLD zones; and
- HeadlessDomains wallet-profile publishing.

## Implementation status

Implemented and locally verified on 2026-08-15 across these repositories:

- `bob-wallet` — delegated-zone DNSSEC validation for TXT and TLSA, bounded HIP-2 requests, domain-like alias suggestions, and security/UX tests;
- `headlessdomains-com` — checksum-valid mainnet HNS address validation, clean public TXT selection, and removal of legacy internal TXT records during sync; and
- `host-limo-profile-edge` — a strict `/.well-known/wallets/HNS` HIP-2 response backed by the validated HeadlessDomains profile address.

The changes are not yet committed, pushed, deployed, or released. The live `web_presence` TXT record will remain until the HeadlessDomains sync fix is deployed and the domain is synchronized again. The new managed HIP-2 response will likewise become live after deploying the profile-edge change.

Live checks against the running Bob resolver at `127.0.0.1:10892` passed:

```text
@janice.agent        => hs1qx3z2yxmwq3tu8fj758j5phqnl3wx04u6u009x8
@mike.agent          => hs1qvklga0ec7809kmkas0rmmuw2ak6a97jh9zyac6
@hnsbroker           => hs1qkm58x2cfm40tu7gh5kc2dfkm4cq2tzekzr5ge5
@hnsbroker.hns.bio   => hs1qkm58x2cfm40tu7gh5kc2dfkm4cq2tzekzr5ge5
```

The Janice and Mike results exercised the delegated-zone TXT compatibility path. `hnsbroker.hns.bio` exercised HIP-2/DANE; its independent TXT query remained unusable, demonstrating that the successful result was not supplied by TXT fallback.

Verification results:

- Bob: 228/228 tests pass and the production build completes.
- HeadlessDomains: 23 relevant tests pass.
- HostLimo profile edge: 11/11 tests pass, including an HTTP-level HIP-2 endpoint test.
- Locale consistency checker completes; it continues to report the repository's pre-existing untranslated/missing locale backlog.

## Initial diagnosis

Checked on 2026-08-15 through Bob LearnHNS's active recursive resolver at `127.0.0.1:10892`.

HeadlessDomains now reports this HNS address for `janice.agent`:

```text
hs1qx3z2yxmwq3tu8fj758j5phqnl3wx04u6u009x8
```

The live authenticated-zone data includes:

```text
janice.agent. TXT "hns:hs1qx3z2yxmwq3tu8fj758j5phqnl3wx04u6u009x8"
```

The HeadlessDomains profile API also returns the same value in `profile.hns`:

```text
https://headlessdomains.com/api/v1/lookup/janice.agent
```

The missing-wallet-record problem is therefore fixed.

Before this implementation, Bob did not resolve `@janice.agent`. Its TXT resolver returned:

```text
ETXTINSECURE: TXT response is not authenticated
```

The DNS answer contains an RRSIG, and the child DNSKEY matches the DS published by the `.agent` parent. Direct cryptographic checks showed that:

- the DS digest and key tag match the `janice.agent` DNSKEY;
- the DNSKEY self-signature is valid and in its validity period; and
- the TXT RRset signature is valid and in its validity period.

Despite that valid material, Bob's HSD/BNS recursive response does not set the DNSSEC authenticated-data (`AD`) flag for `janice.agent`. Bob intentionally rejects TXT wallet records when `AD` is false.

The same behavior was observed for other SkyInclude-hosted `.agent` SLD zones. `mike.agent` already publishes a valid `hns:` address, but its TXT response is also returned without `AD` and is rejected by Bob. This establishes a namespace/infrastructure compatibility issue rather than a Janice-only configuration problem.

The TLSA record at `_443._tcp.janice.agent` is also signed but returned without `AD`. Bob therefore rejects the TLSA lookup as `EINSECURE`, so HIP-2 cannot bypass the TXT problem.

## Input behavior

The Bob Send field currently enters alias mode only when the value begins with `@`.

Correct alias syntax:

```text
@janice.agent
```

Entering only `janice.agent` makes Bob treat it as a literal HNS address. This is confusing and should produce a domain-aware suggestion or alias action.

## HeadlessDomains publishing observations

HeadlessDomains already:

- exposes an HNS Address field in domain management;
- stores it as `hns` in the domain profile; and
- synchronizes it to an apex `hns:<address>` TXT record.

After the latest profile sync, the live DNS response also contained a large serialized `web_presence:{...}` TXT record. `web_presence` is internal structured configuration and should not be published by the generic dynamic profile-field synchronization. It adds DNS bloat and exposes internal deployment metadata.

Before the profile-edge implementation, the HTTPS path:

```text
https://janice.agent/.well-known/wallets/HNS
```

returned the normal HeadlessDomains profile HTML rather than a plain HNS address. The new edge route returns only a validated HNS address, or 404 when none is safely configured.

## Security boundary

Bob must not fix this by accepting every `AD=false` response or by treating the presence of an RRSIG as sufficient proof.

Any Bob-side compatibility path must build a complete validation chain. A safe approach would be anchored to an already authenticated parent DS response and must verify:

1. the child DNSKEY matches the authenticated DS digest, algorithm, and key tag;
2. the DNSKEY RRset signature is valid and current;
3. the requested TXT or TLSA RRset signature is valid and current;
4. owner name, signer name, class, and covered type are correct; and
5. invalid, expired, mismatched, ambiguous, or incomplete chains remain hard failures.

Fixing the authoritative delegation or recursive-validator behavior is preferable if the root cause can be corrected in SkyInclude, HSD, or BNS. Bob-side validation should be the compatibility solution only when the infrastructure behavior cannot be fixed promptly.

The implemented Bob compatibility path follows this boundary. It accepts a child RRset only when the parent DS response itself has `AD=true`, the DS matches the child DNSKEY, the DNSKEY RRset self-signature validates, and the requested current RRset signature validates. A bare `AD=false` response or bare RRSIG is still rejected.

## Proposed next goal

> Make HeadlessDomains `.agent` wallet names resolve securely and clearly in Bob LearnHNS by fixing delegated-zone DNSSEC authentication, improving domain-like alias input, hardening HeadlessDomains HNS-record publishing, and verifying both TXT and HIP-2 paths without weakening DANE or DNSSEC.

This is one goal with coordinated work in Bob and HeadlessDomains. It should be implemented in ordered phases so the security decision is made before changing acceptance behavior.

## Execution plan

### 1. Reproduce and preserve fixtures

- Capture `janice.agent`, `mike.agent`, `.agent`, and a known working root-name response.
- Add the valid DS, DNSKEY, RRSIG, TXT, and TLSA data as deterministic test fixtures.
- Retain `@hnsbroker` as a regression case for the existing root TXT behavior.

### 2. Identify the DNSSEC compatibility boundary

- Trace HSD/BNS validation through the `.agent` parent and delegated SLD.
- Compare the JavaScript resolver with native Unbound behavior where available.
- Inspect how SkyInclude serves the `.agent` parent and child zones from the same nameserver infrastructure.
- Determine why individually valid child signatures and DS material produce `AD=false`.
- Prefer an authoritative DNS or resolver correction when one is standards-compliant and deployable.

### 3. Add safe Bob compatibility if required

- Do not relax the existing `AD` requirement globally.
- If the resolver cannot set `AD`, implement explicit child-zone validation anchored to an `AD=true` parent DS response.
- Apply the same validation rules to TXT wallet records and TLSA records.
- Preserve all existing hard failures for tampering, expiration, mismatches, ambiguity, and invalid wallet addresses.

### 4. Improve Bob alias input and errors

- Detect a domain-like non-address such as `janice.agent`.
- Show a clear action such as “Resolve as `@janice.agent`” instead of treating it as an unexplained invalid wallet address.
- Keep explicit resolution and never convert a value into a sendable destination without showing the resolved HNS address.
- Distinguish missing HNS data from DNSSEC validation and HIP-2 endpoint failures.

### 5. Harden HeadlessDomains publishing

- Validate that the HNS field contains a valid mainnet HNS address before saving or publishing it.
- Show whether the corresponding live `hns:` TXT record has propagated.
- Exclude `web_presence` and other internal structured fields from generic TXT synchronization.
- Add tests proving that profile updates publish exactly one valid HNS wallet record and do not leak internal objects.
- Consider serving `/.well-known/wallets/HNS` as a plain address from the managed profile edge when an HNS address is configured.

### 6. Verification

- `@janice.agent` resolves to `hs1qx3z2yxmwq3tu8fj758j5phqnl3wx04u6u009x8`.
- `@mike.agent` resolves to its independently published HNS address.
- `@hnsbroker` and HIP-2 aliases continue to work.
- A tampered TXT signature, mismatched DS, expired signature, insecure response, invalid address, or multiple distinct HNS addresses is rejected.
- Entering `janice.agent` without `@` produces a useful alias suggestion.
- Unit tests, production builds, and live integration tests pass before release.

## Done when

- Bob resolves valid HeadlessDomains `.agent` aliases without disabling DNSSEC or TLSA verification.
- Bob gives a clear, actionable explanation for domain-like input and every relevant failure class.
- HeadlessDomains validates and publishes clean HNS wallet records without internal DNS metadata leakage.
- Both TXT and optional HIP-2 behavior are documented for registrants.
- Live tests pass for Janice, Mike, HNSBroker, and negative security cases.

## Release note guidance

This work should be released only after the DNSSEC trust path is understood and the public artifacts have been tested against live `.agent` names. It is substantial enough for a new Bob LearnHNS feature release rather than an error-message-only patch.
