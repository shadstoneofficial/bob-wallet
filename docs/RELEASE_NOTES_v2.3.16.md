# Bob LearnHNS v2.3.16 - release candidate

This is a draft for the next stable candidate. It is not confirmation that v2.3.16 has been packaged, accepted, or published. Add the final master commit, workflow run, artifact checksums, and acceptance results only after every gate passes.

## Changes since v2.3.15

- The Overview dashboard separates spendable, locked, and pending wallet balances and makes their context clearer. This does not change wallet funds or transaction rules.
- Source acceptance fixtures now cover overlapping restore, stale wallet switching, delayed Auction Basket cancellation, Register All exact-candidate reconciliation and safe resume, and the separate Shakedex/ShakeX selling chooser. These fixtures improve release evidence; they are not a substitute for testing the signed executables.
- The v2.3.15 Auction Basket, Register All, and owned-name selling behavior remains in scope for packaged regression checks.

## Important limitations

- Back up the wallet profile before upgrading. A seed phrase does not restore local Shakedex Marketplace proof/listing files; preserve those backups separately.
- Never blindly retry a transaction with an unknown broadcast outcome. Missing wallet history alone does not prove rejection.
- Register All multisig recovery is not supported in this candidate; register names individually with the existing flow.
- No resolver or privileged DNS helper is included.
- Windows MSI signing and Linux installation coverage must be reported from the actual final artifacts. Do not describe all platforms as signed.
- The source fixtures use disposable regtest data and inert transport. The Basket history lookup remains fixed below the real coordinator; production transaction-history parsing is not established by the fixtures.
- The production dependency audit and the existing protocol-specific bsock mitigation must be recorded in the final report; do not claim zero advisories without evidence.

## Publication gate

See [stable-release-acceptance.md](stable-release-acceptance.md). Build once from the final reviewed master commit, verify all four platform artifacts, and obtain Arthur's acceptance on that exact package before stable publication. Preserve all v2.3.15 tags, warnings, and assets.
