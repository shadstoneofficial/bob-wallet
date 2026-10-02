# ShakeX localization integration

PR #9 was merged into master at `10a79f1d08ce9c71797b72f819d6c8a15f5f4de0`. PR #12 integrates that master and preserves both PRs' `unit.js` imports, including Auction Basket localization, locale formatting and post-unlock name-update review tests. The PR #9 branch was not edited.

## Implemented

- 83 new English and Simplified Chinese entries cover the ShakeX card, browse states, privacy/settlement notices, listing form, validation and shared Records review/refresh/import/submit controls.
- Components use Bob's `I18nContext`. The context now supplies the selected locale for verification timestamps. Other languages fall back to English for these new keys.
- `app/utils/reviewText.js` retrieves a translated template without arguments, then substitutes values once using a callback. Dollar replacement tokens and `%s` inside contacts or error details stay literal. New unit tests exercise this behavior.
- `shakexListingCountOne`/`shakexListingCountMany` and shared `recordsCountOne`/`recordsCountMany` translate complete count messages. Byte limits and dates use `%s` in accordance with the existing locale validator.
- Resource validation accepts an optional translator while defaulting to English in CLI fixtures. Locale selection never changes generated wire records or exact decimal amount strings.
- `FORSALE1`, currency codes, DNS types, canonical names, addresses, URLs and published contact content remain unchanged. The paid-transfer instructions use the existing translated Bob action names.
- Client transport failures map to localized browse errors rather than exposing internal English API diagnostics. Existing node/wallet/library error details and the older activation-proposal parser can still return English technical details within the shared Records UI.

## Validation

The combined unit suite passes **689 assertions**. `node scripts/check-locale.js zh-CN` verifies all 1,276 keys, placeholders, technical tokens, URLs and formatting markers; all 12 locale-validator regression cases pass. Production renderer and dedicated client/React/record checks pass.

The actual Records and ShakeX components are exercised in sandboxed Electron using mock wallet props and offline feed fixtures. Run both locales:

```sh
node scripts/shakex/build-desktop.cjs
node_modules/.bin/electron scripts/shakex/desktop.cjs
node_modules/.bin/electron scripts/shakex/desktop.cjs --zh-CN
```

The fixture uses Bob's global theme styles and blocks external font/network requests. It tests 600px layouts, loading/empty/error/populated states, full before/after review, explicit submit and post-unlock stale rejection. Chinese screenshot evidence is under `docs/shakex-evidence/*-zh-CN.png`. Native-speaker feedback is deferred to the next build by user direction; rendered-layout checks do not substitute for that feedback. Installed-app/device/cosigner validation remains separate.
