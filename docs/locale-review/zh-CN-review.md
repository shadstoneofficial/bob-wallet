# zh-CN review record — 2026-10-02

Base: `7781df159fbb7bd4426e5e0ac877b7fdd195d4ca` (master).
Scope: existing draft PR #9; no merge, tag, signed package, release, or deployment.

## Automated evidence

- 1,092 English keys and 1,092 Chinese keys; no duplicate, missing, or extra keys.
- Only five intentionally unchanged values: SPV, API, Shakedex, em dash, URL.
- `%s` counts and `%s%` literal-percent markers pass; placeholder arguments
  remain in source order, including the M-of-N signature policy.
- URLs and known technical identifiers pass the strengthened locale CLI.
- 12 CLI regression cases pass (valid translation plus missing/obsolete keys,
  missing/duplicated placeholders, literal percent, URL, identifier, markup,
  newline, empty value, and non-string value mutations).
- Full `npm test`: 617/617 assertions pass.
- Local fixture webpack compilation and `git diff --check` pass.

## Separate safety pass

This was a second pass by the same translation agent, not an independent human
or native-speaker approval. Review covered these English/Chinese key groups:

| Topic | Representative keys and verified meaning |
| --- | --- |
| Seed phrase | `backupWarning*`, `obBackupSeed*`, `obImport*`, `phraseMismatch*`, `seedCopy*`, `revealSeed*`, `removeWalletAck*`: preserve loss/phishing/clipboard warnings; seed restore does not restore local settings, watchlists, or market files; showing a seed is 显示. |
| Private keys and passwords | `backupListingWarning*`, `obImportOption2/3*`, `obImportSeedWarning*`, `settingAccountKey*`, `obCreatePassword*`: distinguish encrypted private-key backups, public account access, password requirements, and unchanged key prefixes. |
| Construct/sign/broadcast | `createNewTransaction`, `sign*`, `multisigTx*`, `txView*`, `broadcast`, `storageError*`: construction, signature sufficiency, completeness, broadcast, and confirmation remain distinct; uncertain submission stays uncertain. |
| Bid/blind | `bid*`, `blind*`, `basket*`, `openBasket*`: true bid plus blind equals lockup; OPEN is not BID; all batch bids share one transaction; subsequent reveal is mandatory. |
| Reveal/redeem/register | `reveal*`, `redeem*`, `register*`, `repairBid*`, `overviewAction*`: deadline/loss risk retained; losing bids are redeemed; winning names are registered; seed alone cannot recover hidden bid amounts. |
| Transfer/finalize | `transfer*`, `finalize*`, `bulkFinalize*`, `claimNamePayment*`, `shakedexStatus*`: submitting transfer is not completing transfer; recipient address warning says 接收方; cancellation and finalization stay separate. |
| Marketplace proofs | `generateListingProof*`, `submitListingProofHelp`, `privateSale*`, `learnHnsSeller*`, `proofBackupWarning`: local signing, channel publication, and on-chain transfers are distinct; anyone holding a private proof can buy; old proofs may remain usable. |
| Irreversibility and recovery | `revoke*`, `zap*`, `receiveModalWarning*`, `hip2*`: permanent loss, irreversible revocation, pending transactions remaining on the network, and “do not send” security failures are retained. |

No secrets were entered or generated. No real transactions were constructed,
signed, or broadcast. Existing automated tests use their mocks/fixtures;
visual review used only the inert local component renderer.

## Visual review

Reviewed actual component markup/styles in the in-app browser at **800×700**
and **1280×900** using the fixture tool in `scripts/locale-preview`:

- Onboarding welcome, restore warning/scope, backup warning, password setup.
- Overview including populated reveal/register/redeem action cards.
- Send form and receive safety warning.
- Auction Basket empty state and populated review with 10 HNS bid, 5 HNS blind,
  15 HNS lockup, 0.01 HNS fee reserve, and 84.99 HNS estimated remainder.
- Open Basket, Domain Manager empty state, Marketplace seller-list state.
- General Settings, seed-display password prompt, paid-transfer finalize dialog.

Reviewed Chinese warnings and buttons wrap legibly at these sizes. This is
partial screen-state coverage: it does not exercise a real app session,
hardware wallet, populated market sale, all transaction dialogs, dark theme,
or every error state. The fixture port does not mount React lifecycles or
connect to services. Portal contents are rendered inline with original styles.

### Open findings — selector stays disabled

1. Hardcoded English remains outside `locales/en.json`: Send HNS / Send Name,
   fee speed names, Paste complete basket / Back to basket, Settings appearance
   and USD options, Add Ons, EXPIRES, pagination `of`, and duration units.
   These are source i18n extraction follow-ups, not untranslated zh-CN values.
2. The narrow Marketplace seller filter row clips its trailing listing count.
   Some table loading text and search placeholders are also constrained by
   existing fixed-width columns/inputs. Review layout before release approval.
3. Independent native Simplified Chinese security review is still pending.
   Automated token checks and this agent's second pass do not replace it.

The historical airdrop/auction descriptions remain translations of the current
English source; this PR does not independently revise their factual content.

### Saved fixture screenshots

![Narrow populated auction review](zh-CN-basket-800x700.jpg)

![Wide populated auction review](zh-CN-basket-1280x900.jpg)
