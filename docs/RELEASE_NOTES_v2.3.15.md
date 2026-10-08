# Bob LearnHNS v2.3.15 - release draft

This file describes the candidate. It is not confirmation that v2.3.15 has been built, accepted or published. Fill in the final master commit, workflow run and verified asset checksums only after the release gates pass.

## Changes since v2.3.14 beta

- Auction Basket keeps the reviewed names, true bids and lockups together. Preparation is unsigned; the exact fee and complete transaction scope need explicit approval before fresh unlocking and signing. An expired name cannot silently disappear from a retry.
- Basket cancellation, wallet switching and navigation are checked before transport. Uncertain outcomes retain a persistent retry lock even when a draft is cleared, replaced or emptied. Verified success retains the transaction ID and unlocks any remaining empty rows.
- Register All records per-name transaction results. A preparation failure preserves earlier successes and remaining names; resume does not repeat completed registrations. Uncertain sends remain locked until positive transaction evidence is found. Stop prevents subsequent sends, not a transaction already sent.
- Owned-name details now have a neutral Sell this name section with Shakedex and ShakeX entry points, separate from DNS records. Neither provider is preselected. ShakeX advertisements are distinguished from completed sales; existing listing, transaction and backup workflows are preserved.
- New controls and recovery labels are translated into Simplified Chinese, Russian and Thai. These are AI-assisted translations, not a claim of native-speaker review.

## Important limitations

- Back up the wallet profile before upgrading. A seed phrase does not restore local Shakedex Marketplace proof/listing files; keep those backups and the original profile separately.
- Do not blindly retry a transaction whose broadcast outcome is unknown. Missing wallet history alone does not prove that a transaction was rejected.
- Register All does not support multisig recovery in this candidate. Register names individually using the existing flow; batch support requires journal-aware multisig approval.
- No resolver or privileged DNS helper is included.
- The production dependency audit continues to report five affected package entries inherited from one bsock advisory. The existing protocol-specific legacy-WebSocket rejection mitigation remains; this is not a zero-advisory claim.
- The current Windows workflow produces an unsigned MSI. Do not describe all platforms as signed. Document Windows/Linux installation evidence and native Intel versus Rosetta coverage in the final verification report.

## Required final evidence

See [stable-release-acceptance.md](stable-release-acceptance.md). Source tests and inert fixtures do not establish real-wallet safety. Public stable promotion requires fresh exact-source artifacts, packaged acceptance and Arthur's exact-package checks. No personal wallet access or live transactions are authorized for these checks.
