# Simplified Chinese Translation

Bob LearnHNS is preparing a Simplified Chinese (`zh-CN`) language option. The
translation is intentionally not enabled in the application until it has been
completed and reviewed.

## How to help

1. Open `locales/zh-CN.json`.
2. Translate each English value into natural Simplified Chinese. Do not change
   the JSON keys on the left.
3. Preserve `%s` placeholders exactly. They are replaced with amounts, names,
   block counts, and other values while Bob is running.
4. Keep `HNS`, `Handshake`, `Bob`, `LearnHNS`, `HIP-2`, URLs, and transaction
   identifiers unchanged unless Chinese typography requires surrounding text
   to change.
5. Pay special attention to security and transaction terms such as recovery
   seed phrase, private key, bid, blind, lockup, reveal, redeem, register,
   transfer, signing, broadcast, and network fee.
6. Do not insert a real recovery phrase, private key, password, address, or
   transaction ID into the locale file or a pull request.

Run the structural check after editing:

```bash
npm run check-locale -- zh-CN
```

The command reports how many values still match English and fails when keys or
`%s` placeholders are missing. Some product names and technical terms may
legitimately remain the same as English.

## Test without spending HNS

Bob can load a translation without enabling it for every user:

1. Start Bob using a test wallet or regtest environment.
2. Open **Settings**, then **General**.
3. Select **Custom JSON** from the language menu.
4. Load `locales/zh-CN.json`.
5. Review the major screens at both wide and narrow window sizes.

Do not place or broadcast a mainnet bid while reviewing translations. Visual
checks should use an empty wallet, fixtures, mocks, or regtest.

## Review checklist

- Wallet creation, unlock, recovery, backup, and password warnings are precise.
- Send, receive, fee, transaction, and confirmation wording is unambiguous.
- Auction terms consistently distinguish bid, blind, and total lockup.
- Reveal, redeem, register, renew, transfer, finalize, and revoke are distinct.
- Error messages describe the actual failure without implying success.
- Text fits buttons, menus, dialogs, tables, and the Auction Basket.
- Punctuation and terminology are consistent throughout the application.

When translation and review are complete, maintainers will enable
`简体中文` in `app/utils/i18n.js` and run the complete application test suite.

## Telegram invitation

Thank you for requesting Simplified Chinese support for Bob LearnHNS. We have
opened a draft translation pull request and would be grateful for help from
native Simplified Chinese speakers. The file contains the English source text
beside stable JSON keys, so contributors only need to translate the values and
preserve any `%s` placeholders. Wallet and auction terminology needs careful
human review, especially seed phrase, private key, bid, blind, lockup, reveal,
signing, and broadcast warnings. Please do not share wallet secrets or test by
sending real HNS. You can contribute through the pull request or send us a
reviewed `zh-CN.json` file.
