# Bob LearnHNS 2.3.3 wallet-alias follow-up

## Status

Agreed with HNSBroker/Wil on 2026-08-14. Release 2.3.3 was approved on 2026-08-14; this document is its implementation and build-note source.

## Goal

Make wallet-alias resolution clear and predictable while keeping HIP-2/DANE and authenticated HNS TXT records as independent secure resolution methods.

## Confirmed issues in 2.3.2

### Resolved address and documentation link overlap

The resolved wallet address is rendered in an `Alert` directly above the “How @ aliases work and what errors mean” link. The address alert has a negative bottom margin, so the two lines nearly overlap, particularly at the smaller dimensions used by the Linux AppImage.

### Secure TXT fallback is blocked by some HIP-2 failures

Bob correctly authenticates a TXT response using Handshake/DNSSEC and does not perform TLSA validation inside `getTXTAddress()`. However, the HIP-2-first policy only calls TXT fallback for selected errors. A TLSA mismatch or another HIP-2 integrity failure prevents Bob from checking a separately authenticated TXT record.

An HNS TXT wallet record does not use HTTPS hosting. A valid, authenticated `hns:<address>` or `hns=<address>` record is therefore independently secure and does not require a TLSA record.

### Typed aliases have no visible completion action

Bob 2.3.2 avoids premature partial-name queries by resolving typed aliases only on Enter or field blur. Pasted aliases resolve immediately. The behavior is safe, but the UI does not tell the user to press Enter and provides no visible resolve control.

## Agreed behavior

### Layout

- Render the detected wallet address on a dedicated row.
- Remove the negative alert margin that causes overlap.
- Leave visible spacing between a result or error and the documentation link.
- Allow long wallet addresses and messages to wrap normally.

### Resolution and security

1. Normalize the exact hostname supplied by the user.
2. Attempt HIP-2 and require matching TLSA/DANE authentication for an HTTPS result.
3. If HIP-2 fails for any reason, independently query TXT at that same hostname.
4. Accept TXT only when the local validating resolver marks the response authenticated, exactly one valid mainnet/testnet-appropriate address is published, and the record uses `hns:` or `hns=`.
5. A valid TXT result may succeed even when HIP-2 has a missing, invalid, or mismatched TLSA record because TXT security does not depend on HTTPS or TLSA.
6. If TXT does not produce a valid secure result, preserve the most useful underlying error. In particular, a TLSA mismatch must remain visible when no usable TXT record exists.

Bob must query the exact normalized alias:

- `@hnsbroker` queries TXT at `hnsbroker.`
- `@hnsbroker.hns.bio` queries TXT at `hnsbroker.hns.bio.`

Bob must not silently move between those names.

### Interaction

- Show a visible **Resolve alias** button for a non-empty unresolved `@` alias.
- Show a short pending instruction: “Press Enter or select Resolve alias.”
- Keep Enter, blur, and explicit button activation as completion actions.
- Keep immediate resolution after paste.
- Show the existing loading indicator while resolution is running.
- Do not add a timer-based automatic lookup. A debounce cannot determine whether a syntactically valid name such as `hnsbroker` is complete or is a partial value of `hnsbroker.hns.bio`.
- Keep stale-response protection so an abandoned request cannot overwrite newer input.

## Acceptance tests

- A resolved address and the help link have separate vertical space.
- A typed alias remains pending until Enter, blur, or the Resolve alias button is used.
- The pending instruction and explicit resolve action are visible and keyboard accessible.
- Paste still resolves immediately.
- HIP-2 success remains the first-choice result and does not query TXT.
- A TLSA mismatch followed by a valid authenticated TXT record resolves successfully.
- A missing or invalid TLSA followed by a valid authenticated TXT record resolves successfully.
- An unauthenticated, invalid, wrong-network, ambiguous, or missing TXT result is never accepted.
- When TXT is absent, the user still receives the useful HIP-2 security or connection error.
- Direct HNS address entry is unchanged.

## Planned 2.3.3 build notes

- Fixed spacing between detected alias addresses, errors, and the wallet-alias help link.
- Added a visible Resolve alias action and pending instruction while retaining Enter, blur, and paste behavior.
- Authenticated `hns:` and `hns=` TXT wallet records now work independently of HIP-2 TLSA status.
- TXT fallback still requires authenticated Handshake/DNSSEC data and strict address/network validation.
- Added regression tests covering TLSA-failure fallback, error preservation, and the explicit resolution UI.

## Implementation verification

Implemented locally on 2026-08-14:

- Removed the negative address/error margin and added dedicated result/help spacing.
- Added the localized Resolve alias button and pending instruction.
- Preserved Enter, blur, immediate-paste, loading, and stale-response behavior.
- Allowed every HIP-2 failure to try the separately DNSSEC-authenticated TXT channel.
- Preserved the HIP-2 TLSA or connection error when TXT is absent and HIP-2 was not simply missing.
- Added tests proving HIP-2 remains first choice, invalid HIP-2 and TLSA mismatch can use authenticated TXT, missing TXT preserves a TLSA mismatch, and the explicit UI action behaves correctly.
- Complete automated suite: **203/203 passing**.
- Production renderer/SCSS build: **passing**.
- Locale key coverage for maintained locales: **passing for the two new strings**.

## Release checklist

- Set `package.json` and the lockfile to 2.3.3 before tagging `v2.3.3`.
- Before publishing 2.3.3, update `bobwallet.org/docs/wallet-aliases` so it explains that authenticated TXT is independent of TLSA and documents the Resolve alias control.
- Update the website download page, release links, and checksums only after final release artifacts exist.
- Run the complete unit suite and production renderer build before tagging.
- Build all supported macOS, Windows, and Linux artifacts; sign, notarize, staple, and Gatekeeper-check both macOS DMGs.

## 2.3.4 incident: real TXT wire values and displayed resolver ports

Live testing of 2.3.3 with `@hnsbroker` proved that the local resolver returned
the authenticated on-chain `hns:` TXT record, but Bob rejected it. The real
`bns` decoder exposes each TXT character-string as a JavaScript string. The
2.3.3 implementation used `Buffer.concat(record.data.txt)`, which threw
`ERR_INVALID_ARG_TYPE` on the first unrelated TXT record before reaching the
wallet record. Its mock test incorrectly supplied Buffer chunks and therefore
did not reproduce the runtime representation.

The same investigation showed LearnHNS listening on `10891/10892` while
Settings displayed `9891/9892`. Node startup passed network and DNS state to
Redux but omitted the actual port values, leaving the upstream defaults visible.

The 2.3.4 correction joins the decoded TXT string chunks, exercises an
encoded-and-decoded `bns` response containing unrelated and multi-chunk TXT
records, and publishes the node's actual root and recursive ports to Settings.
