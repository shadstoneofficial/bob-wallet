# Simplified Chinese translation

`locales/zh-CN.json` translates all 1,193 keys in `locales/en.json` on a branch based on master
`7781df159fbb7bd4426e5e0ac877b7fdd195d4ca`. The Simplified Chinese selector
remains disabled. This is a reviewed translation draft, not a release approval.

## Translation rules

Translate values only. Keep keys, `%s` placeholders in their argument order,
URLs, technical identifiers, and formatting markers intact. Use natural
Simplified Chinese punctuation. Do not add wallet secrets or real transaction
data to examples, screenshots, tests, or the PR.

This follow-up extracts 101 additional English source strings, including submission
phases and import validation errors, and translates them into Chinese.

The only values intentionally identical to English are `SPV`, `API`, `Shakedex`,
`—`, and `lockedLearnMoreURL`. The four obsolete `obMigration*` strings have
been removed; the two new keys `obImportRestoreScope` and
`pendingAuctionMetadataWarning` are included. The still-current database
migration messages `splashMigrate3001/2` remain because they are present in
English.

## Terminology and safety review

| Concept | Chinese wording | Distinction to preserve |
| --- | --- | --- |
| Recovery seed phrase | 恢复助记词 / 助记词 | A wallet secret; never an account password. Showing it locally is 显示, not auction 揭示. |
| Private key / master key | 私钥 / 主密钥 | Distinct from public/account keys; keep xpriv, xprv, xpub, xPub identifiers. |
| Password | 密码 | Needed for encrypted backups; not a replacement for a recovery phrase. |
| Transaction construction | 构建交易 | Does not imply signing, broadcasting, confirmation, or success. |
| Signing | 签名 | A local signature is not a network submission. |
| Broadcast | 广播 | Sending a transaction to the network is not chain confirmation. |
| Bid / true bid | 出价 / 真实出价 | Distinct from the publicly visible lockup. |
| Blind | 掩护金额 | Extra amount concealing the bid; not a fee or an additional bid. |
| Lockup | 锁定总额 | Bid plus blind; transfer lockup periods are 转移锁定期. |
| Reveal | 揭示 | Reveal auction bids before the deadline; not displaying a seed. |
| Redeem | 赎回 | Recover losing-bid funds; not registration or a sale. |
| Register | 注册 | Register a won name after auction settlement. |
| Transfer | 转移 / 发起转移 | Starts the transfer, which still requires finalization. |
| Finalize | 完成转移 | Completes a transfer after its lockup, or 完成挂单锁定 / 完成取消 in those contexts. |
| Renew / revoke | 续期 / 撤销域名 | Different from transfer cancellation; revocation is irreversible. |

A separate second pass by the same agent checked the security-sensitive source
and translation against their component contexts on 2026-10-02. It corrected
the paid-transfer recipient wording to **接收方**, clarified transaction
construction, and checked all the categories above. This is **not independent
native-speaker sign-off**. That review remains required before enabling the
selector. Detailed evidence and review limits are in
[the review record](locale-review/zh-CN-review.md).

## Validation

```sh
npm run check-locale -- zh-CN
node --test scripts/check-locale.test.js
npm test
git diff --check
```

The locale CLI rejects missing/extra keys, empty/non-string values, changed
placeholder counts, changed URLs, changed known technical identifiers, and
changed formatting markers (including `%s%`, newlines, HTML tags, backticks,
and bold markers). It does not certify translation quality or placeholder
semantics. Review the meaning and argument order separately.

## Safe visual review

Use the actual React screen components with synthetic state, without starting
Electron or any wallet/node service:

```sh
npm run preview-locale
python3 -m http.server 8139 --bind 127.0.0.1 --directory test-dist/locale-preview
```

Open `http://127.0.0.1:8139`. The bottom navigation selects static fixtures.
Review at 800×700 and 1280×900, including the populated Auction Basket review.
The preview renders static markup without mounting components, hydrating React,
or attaching action handlers. The content is inert; Redux dispatch, wallet IPC,
file operations, fetch, XHR, and WebSocket calls throw. CSP blocks connections
and external resources. No real credentials, addresses, transaction data,
transaction construction, signing, or broadcast are needed. The `regtest`
label is fixture state only; this does not start a regtest node.

The preview is a local review tool, not an application build or a substitute
for checking every dialog/state. Generated files stay under ignored
`test-dist/locale-preview`. Stop the local server after review.

## Enablement checklist

- [x] Every current English key translated or explicitly retained.
- [x] Locale parity, placeholders, URLs, and technical markers validated.
- [x] Full application suite passes (649 assertions).
- [x] Separate second safety wording pass completed by the translation agent.
- [x] Major screen fixtures inspected at narrow and wide sizes.
- [ ] Independent native Simplified Chinese security review completed.
- [x] Documented Marketplace clipping and targeted hardcoded labels resolved in fixture review.
- [ ] Native reviewer approves wording and visual evidence; remaining screen states audited.
- [ ] Rerun validation against the eventual release head before enabling `简体中文`.

Do not enable the selector simply because automated checks pass. Keep PR #9 a
draft while review gates remain open. Do not test with real transactions.

## Native review handoff

Use [the concise volunteer checklist](locale-review/zh-CN-native-review.md).
Do not count the agent safety passes as native approval. The selector remains disabled.

Preview parameters: `shell=1` includes the 230px sidebar/content padding for
regular screens (Settings correctly omits them); `locale=en` compares the English
source; `phase=failed` shows an uncertain-broadcast warning on `screen=review`.
For inert content use `offset=400` to inspect lower content and `edge=right` to
inspect the rightmost Marketplace columns. These only position fixture views.
