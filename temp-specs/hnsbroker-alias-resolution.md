# Bob Wallet alias resolution fixes

## Background

HNSBroker reported two problems that currently make Bob Wallet aliases unreliable:

1. A leading `@` can reach the HIP-2 backend as part of the hostname. This produces an invalid TLSA lookup such as `_443._tcp.@hnsbroker.hns.bio` instead of `_443._tcp.hnsbroker.hns.bio`.
2. While an alias is being typed, Bob begins resolving partial values such as `hnsbr`, leading to unnecessary requests and temporary “No alias address found” errors.

HNSBroker also requested support for an HNS-address TXT record as a fallback when no HIP-2 address is available.

## Findings

### Leading `@`

`app/background/hip2/hip2.js` currently interpolates its `host` argument directly into the HTTPS URL and passes it directly to `hdns.resolveTLSA()`:

```js
const tlsa = await hdns.resolveTLSA(host, 'tcp', 443);
https.get(`https://${host}/.well-known/wallets/HNS`, ...);
```

If this function receives `@hnsbroker.hns.bio`, the reported invalid HTTPS hostname and TLSA question follow directly.

The current `AddressInput` UI normally strips the leading `@` before calling `hip2.fetchAddress()`. This means the regular send-field path should already pass `hnsbroker.hns.bio` in this source version. Nevertheless, the backend accepts an unnormalized hostname from any caller, so normalization is still required at the backend trust boundary. The installed binary or another caller may also differ from the normal source path.

HIP-2 defines `@` as an input-field marker used to distinguish an alias from a wallet address. It is not part of the domain.

### Lookups during typing

`AddressInput` uses a 125 ms debounce. A pause longer than 125 ms starts a lookup for whatever partial alias exists at that point. The stale-result checks prevent an old response from overwriting a newer input, but they do not cancel a DNS/HTTPS request after it starts.

Because domain names have arbitrary lengths, Bob cannot reliably infer that a typed alias is complete. To eliminate partial lookups, typed aliases should resolve on an explicit completion action such as Enter or field blur. Paste can resolve immediately because it normally supplies the complete alias at once.

## Proposed implementation

### 1. Normalize and validate aliases once

Add a shared hostname-normalization helper and call it at the beginning of the backend alias-resolution path, before collision detection, HTTPS, TLSA, or TXT resolution.

Normalization should:

- Trim surrounding whitespace.
- Remove one leading `@`.
- Remove a terminal DNS root dot.
- Normalize hostname case and internationalized names consistently.
- Reject empty or malformed values.
- Reject schemes, paths, query strings, credentials, and explicit ports.

The same normalized hostname must be used for:

- `https://<hostname>/.well-known/wallets/HNS`
- `hdns.resolveTLSA(hostname, 'tcp', 443)`
- TXT fallback resolution
- The domain returned to the UI

Examples:

| Input | Normalized hostname |
| --- | --- |
| `@hnsbroker.hns.bio` | `hnsbroker.hns.bio` |
| `@hnsbroker.hns.bio.` | `hnsbroker.hns.bio` |
| ` hnsbroker.hns.bio ` | `hnsbroker.hns.bio` |

### 2. Stop resolving partial typed aliases

Recommended behavior:

- Resolve a pasted alias immediately.
- Resolve a typed alias when the user presses Enter or leaves the field.
- Keep the send action disabled until resolution succeeds.
- Do not show “No alias address found” while the user is still typing.
- Preserve the existing stale-result protection.
- Cancel an active request when practical, or at minimum suppress expected errors from abandoned requests.

If preserving automatic resolution is preferred, increase the debounce to approximately 600–800 ms. This reduces partial requests but cannot eliminate them, so Enter/blur is the stronger fix.

### 3. Add authenticated TXT fallback

Resolution order:

1. Normalize the alias hostname.
2. Attempt HIP-2 HTTPS resolution with DANE verification.
3. If HIP-2 is genuinely absent, query TXT records at the normalized hostname.
4. Recognize both `hns:<address>` and `hns=<address>`.
5. Validate the extracted address against Bob’s active network.

Security and parsing requirements:

- Do not fallback after a TLSA certificate mismatch, bogus DNSSEC result, or invalid address returned by a functioning HIP-2 endpoint. Those failures must remain hard errors to avoid a downgrade attack.
- Distinguish “no HIP-2/TLSA record” from “TLSA exists but failed verification.” The current `verifyTLSA()` implementation converts every TLSA error into the same `EINSECURE` result and must be made more specific.
- Require authenticated DNS/DNSSEC for a TXT fallback.
- Join the chunks belonging to each TXT resource record before parsing it.
- Ignore unrelated TXT records.
- Trim whitespace around the prefix and address only where explicitly allowed.
- Treat prefixes consistently, preferably as lowercase and case-sensitive unless compatibility requirements say otherwise.
- If multiple distinct valid HNS addresses are found, reject the alias as ambiguous rather than selecting the first one.
- Return an invalid-address error when a recognized prefix contains an address for the wrong network or an otherwise malformed address.

## Error behavior

The implementation should preserve or introduce distinct error states for:

- Invalid alias/hostname
- Alias resolution still pending
- HIP-2 address not found
- TLSA absent
- TLSA/DANE verification failed
- TXT record not found
- TXT record ambiguous
- Invalid HNS address

User-facing wording can combine some states, but the internal codes must retain enough detail to enforce the fallback policy safely.

## Acceptance criteria

- Entering or pasting `@hnsbroker.hns.bio` never sends `@` to HTTPS, DNS, TLSA, or TXT resolution.
- Entering or pasting `@hnsbroker.hns.bio.` uses `hnsbroker.hns.bio` consistently.
- Bob queries `_443._tcp.hnsbroker.hns.bio`, never `_443._tcp.@hnsbroker.hns.bio`.
- Slowly typing an alias does not produce lookups for partial values when the Enter/blur behavior is selected.
- A valid HIP-2 response with a matching TLSA record remains the first-choice result.
- A missing HIP-2 address can resolve through an authenticated TXT record containing either `hns:<valid-address>` or `hns=<valid-address>`.
- A TLSA mismatch does not fall back to TXT.
- Unauthenticated, malformed, wrong-network, or ambiguous TXT results are rejected.
- Direct HNS address entry continues to work unchanged.
- Unit tests cover hostname normalization, input triggering, HIP-2 success and failure classification, TXT parsing, DNS authentication, ambiguity, and network validation.

## Verification notes

Implementation and automated verification were completed on 2026-08-12:

- Bob normalizes the hostname at the backend boundary and uses it consistently for HTTPS, TLSA, and TXT.
- Typed aliases wait for Enter or blur; pasted aliases resolve immediately.
- TXT fallback accepts `hns:` and `hns=` only from an authenticated DNS response.
- Authenticated TLSA absence permits TXT fallback, while a TLSA mismatch remains a hard failure.
- The project test suite passes all 160 tests.
- Production Babel transpilation succeeds for the modified background and renderer modules.

Live verification used Bob’s running validating resolver on `127.0.0.1:10892`:

- `_443._tcp.hnsbroker.hns.bio` returned an authenticated TLSA record.
- Running the updated resolver with `@hnsbroker.hns.bio.` reached that normalized TLSA name and did not produce `EBADQUESTION`.
- The HIP-2 endpoint returned HTTP 200 with an HNS address.
- The live DANE check correctly returned `EINSECURE` because the published TLSA SPKI SHA-256 value (`F803…DCA9`) did not match the certificate currently served by the site (`B44B…52C1`).
- The live hostname did not publish a TXT record, so its TXT fallback could not be exercised externally. The authenticated fallback path, multi-chunk parsing, ambiguity handling, wrong-network rejection, and downgrade protection are covered by integration-style automated tests.

## Draft reply to HNSBroker

Hi HNSBroker,

Thank you for the detailed report. We reviewed the Bob Wallet code and understand both problems.

You were correct that Bob’s HIP-2 backend used the supplied host directly for both the HTTPS request and the TLSA lookup. If the leading `@` reached that function, Bob asked for `_443._tcp.@hnsbroker.hns.bio` instead of `_443._tcp.hnsbroker.hns.bio`, causing the DNS error you reported.

We have now fixed this at the backend boundary. The leading `@` and optional trailing root dot are removed before HTTPS, TLSA, or TXT resolution, and malformed hostname input is rejected.

We also fixed the partial-alias behavior. Typed aliases now resolve when the user presses Enter or leaves the field, while pasted aliases resolve immediately. Bob no longer starts DNS requests for incomplete values such as `hnsbr` during normal typing.

We added the requested TXT fallback. Bob tries HIP-2 first and, when HIP-2 is genuinely unavailable, accepts an authenticated TXT record using `hns:<address>` or `hns=<address>`. It validates the address and does not fall back after a failed or mismatched TLSA record.

During live testing, Bob now queried the correct `_443._tcp.hnsbroker.hns.bio` name and your HIP-2 endpoint returned an HNS address successfully. We did find one current configuration issue: the TLSA SPKI hash being published (`F803…DCA9`) does not match the certificate presently served by `hnsbroker.hns.bio` (`B44B…52C1`). The updated Bob therefore correctly reports invalid DANE rather than the former bad-question error. The TLSA record will need to be refreshed to match the current certificate. We also did not find an HNS TXT record at the hostname during this test.

Your logs and explanation were very helpful. The fix is covered by automated tests and a live lookup through Bob’s validating resolver.

Thanks again.
