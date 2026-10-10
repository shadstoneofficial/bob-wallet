# Bob LearnHNS v2.3.17 - release candidate

This is a draft for a new four-platform acceptance build. It is not a published release or a claim that packaged acceptance has passed. Record the final master commit, workflow run, artifact checksums, and Arthur's exact-package results before any publication decision.

## Changes since v2.3.16

- The disposable regtest restore fixture now gives generated wallets distinct confirmed balances, enabling an A-B-A dashboard transition check without touching an existing wallet profile.
- Overview balance disclosure reports a non-secret readiness reason for acceptance diagnostics. It accepts an authoritative synchronized chain state while still requiring a current wallet snapshot, no active wallet rescan, and coherent amount arithmetic. Rounded sync progress alone does not reveal balances.
- No wallet transaction, signing, broadcast, DNS, or listing behavior was changed.

## Acceptance and limits

- Arthur must compare the exact signed arm64 package against the new unequal disposable wallet snapshots, including primary-secondary-primary switching and confirmed/current/locked/spendable arithmetic. If values remain unavailable, record the readiness reason; the cause in the prior package is not established.
- Fresh native Intel, Windows installation/runtime, Linux installation/runtime, and English/Chinese/Russian restart-persistence evidence remain separate gates. Rosetta does not prove native Intel behavior; Thai restart persistence was previously tested.
- Back up wallet profiles and local Shakedex proof/listing files before any real upgrade. A seed phrase does not restore those local marketplace files. Never retry an ambiguous broadcast without exact evidence.
- The production dependency audit and existing protocol-specific bsock mitigation must be reported; do not claim zero advisories without evidence.

Publication remains on hold until the final artifacts and acceptance gates are verified. Preserve the v2.3.16 tag and any existing assets.
