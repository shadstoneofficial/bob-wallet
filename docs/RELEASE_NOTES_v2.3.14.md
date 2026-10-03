# Bob LearnHNS v2.3.14 Public Beta

Release candidate prepared on 2026-10-03 from the reviewed combined source.
Publication is held until isolated packaged acceptance and maintainer review.

- Restore/rescan lifecycle and overlap protection, with clearer recovery states.
- ShakeX Unicode/emoji name display and search with canonical ASCII identities preserved.
- Logged-out language selection, Russian and Thai locales, and expanded Chinese/catalog localization.
- Fixed disposable acceptance scenarios for embedded recovery and inert auction basket flows.

Translations are AI-assisted. Native-speaker feedback is still pending.
This beta does not claim to resolve every synchronization stall or certify existing-wallet safety.
System DNS resolver changes and untrusted plugin installation are not included.

**Shakedex seller backup warning:** seed recovery does not restore local
Marketplace proof/listing files. Retain the original profile and separate
Marketplace backups. Existing v2.3.12/v2.3.13 warnings and assets remain unchanged.

Every installer must contain `dist/build-provenance.json` identifying the exact
clean source commit and workflow run. Final checksums, signing results, workflow
links and completed/outstanding packaged acceptance will be recorded in the draft.
No real wallets, funds, transactions, seeds or normal Bob profiles may be used for acceptance.
