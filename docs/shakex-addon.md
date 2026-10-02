# ShakeX built in Add On

ShakeX is Marioo's independent Handshake sale directory. This patch adds read-only discovery in Bob and a sale-record composer in the owned-name Records screen. It does not implement a plugin installer, remote code execution, Shakedex proof conversion or automatic OTC deal import.

## Base and isolation

Prepared on `codex/shakex-addon` from `origin/master` commit `7781df159fbb7bd4426e5e0ac877b7fdd195d4ca` (Bob 2.3.13). Original implementation was uncommitted on local master `116e0e80af1dfdf51e0c555ea9f017af306314ca` (2.3.9), mixed with unrelated wallet/auction changes. Only ShakeX files and its Records integration were copied into this worktree. The original checkout was left intact.

The earlier 393-assertion report concerned that older mixed checkout. It is not evidence for current master. On this base the suite passes 633 assertions, including three new post-unlock rejection scenarios. Current wallet mutation coordinator, storage preflight, pending-auction handling and request-lifecycle protections remain inherited from master.

## User flow

Open Add Ons → ShakeX → Load listings. Data loads only on request from the public API; no wallet context is sent. Contacts render as text, not executable URLs or HTML. Fixed links open the official site, docs and deal guide.

For publication, choose Manage my listings → Domain Manager → owned name → Records. Enter an optional HNS price and a required text contact; Review listing changes stages the full before/after resource. Review removal removes only single-string FORSALE1 records. Existing sale fields are replaced, including other currency/contact fields; the preview makes this visible. NS, DS, hns.bio and unrelated TXT records are preserved. Ambiguous multi-string sale records require manual editing rather than silent removal.

Submit is a separate Bob action. The complete resource is checked before submission and again after the unlock prompt. Wallet/request-generation changes abort before wallet submission. Pending transfers/updates and dirty drafts block staging. Normal node validation remains necessary: no preflight can guarantee the chain remains unchanged afterward.

## Add-On Foundation contract proposal

This is an integration contract for the planned foundation, not an implemented or registered runtime manifest. Capability names are proposed for coordination.

| Field | Proposed value |
| --- | --- |
| Stable ID | `shakex` |
| Display name | ShakeX |
| Publisher attribution | Marioo / ShakeX; bundled adapter maintained by Bob maintainers |
| Kind | Bundled, reviewed native UI |
| Entry route | `/addons/shakex` |
| Host-owned navigation | `/domain_manager`, then the selected owned name's Records screen |
| Discovery network | Mainnet only; form also supports isolated regtest fixtures |
| Allowed API origin | `https://shakex.fun` |
| API method/path | GET `/api/listings`; omit credentials/referrer; reject redirects |
| External destinations | Exact fixed URLs `https://shakex.fun`, `/docs`, `/deal` |
| Default wallet permissions | None for browsing |
| Optional capabilities | `names.readSelectedResource`, `names.proposeRecordUpdate`, `navigation.openOwnedName` |
| Future separately reviewed capability | `names.reviewPaidTransfer`; not implemented here |
| Never expose | Seed/private keys, wallet password, unrestricted RPC/IPC/filesystem or arbitrary transaction signing |

The host must own name/wallet selection, ownership and pending-state checks, canonical resource loading, complete before/after preview, size validation, explicit confirmation/unlock, post-unlock revalidation and final transaction submission. An addon may propose a change, never bypass those controls. Browsing must still work if optional capabilities are denied. Today's bundled code calls existing Bob components; moving it into an untrusted runtime requires a new isolated bridge, not reuse of renderer privileges.

## Reproducible validation

From the repository root with dependencies installed:

```sh
npm test
npm run build-renderer
node app/addons/shakex/client.spec.cjs
node app/addons/shakex/ui.spec.cjs
NODE_BACKEND=js node app/addons/shakex/records.spec.cjs
node scripts/shakex/regtest-unsigned.cjs
node scripts/shakex/build-desktop.cjs
node_modules/.bin/electron scripts/shakex/desktop.cjs
```

The desktop harness loads the actual Records component in a separate sandboxed Electron window with fake props, no wallet connection and a temporary user-data directory. It checks preview, preservation, explicit submission and rejection of a resource changed during the simulated unlock interval. Screenshots are written under `/tmp/bob-shakex-desktop/`. The fixture exposed a dark-theme preview contrast problem; this patch fixes it for the ShakeX review.

The unsigned regtest harness uses hsd's regtest network, `Wallet.makeUpdate` and covenant verification with synthetic name/coin context. It constructs list/edit/delist UPDATEs, checks preservation and rejects missing ownership/stale data. It does not create private keys, sign, broadcast or mine transactions. It is not a full chain lifecycle test.

## Draft PR blockers

- End-to-end mined regtest publication/edit/delist and confirmation/index-refresh validation remain outstanding under the no-signing constraint.
- Full installed-app smoke testing, wallet unlock/cancel and hardware/multisig/watch-only behavior remain unverified. No packaging or release performed.
- Narrow-layout and broader browsing-state desktop screenshots, localization and product review remain before release readiness.
- Marioo has not been contacted; no API partnership or formal endorsement is implied.

No mainnet operations, signing, merge or public release are part of this change.
