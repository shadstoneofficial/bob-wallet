# ShakeX localization handoff for PR 9

Reviewed PR #9 (`codex/simplified-chinese`) at `695a8d761e9deddaf667782a0382b26f61f1b1d4`. Its branch was not modified. PR #12 still contains English strings; this inventory is a proposed key contract, not completed translation.

## Overlap and merge handling

PR #9 edits `locales/en.json`, adds `locales/zh-CN.json`, adds `app/utils/localeText.js`, updates `app/utils/i18n.js`, adds locale validation scripts, and registers tests in `unit.js`. PR #12 currently changes none of those locale files or helpers. Both append to `unit.js`: retain both sets of test imports. PR #9 also changes Domain Manager and Exchange; ShakeX links to Domain Manager without changing its source. Add Ons, Records and `app/addons/shakex/` are not among PR #9's current edited files.

After agreeing the host API, translate using the existing `I18nContext` and PR #9's conventions. Keep currency amounts as exact decimal strings. Use pluralization for listing/record counts and named placeholders for byte counts, dates and limits; do not concatenate translated fragments. Do not translate `FORSALE1`, TXT field names, wallet addresses, published contact content, URLs or canonical names. Replace the raw `toLocaleString()` verification timestamp with the agreed locale-aware formatter. Before readiness, run both PRs' locale/unit checks and repeat the 600px fixtures with Simplified Chinese.

## Proposed new keys

| Keys | Source and English intent |
| --- | --- |
| `shakexTitle`, `shakexAddonDescription`, `shakexBackToAddons` | Add Ons card and browsing title/navigation |
| `shakexIntro`, `shakexPrivacyMainnet` | Community attribution; mainnet-only feed and opt-in request disclosure |
| `shakexManageListings`, `shakexManageListingsHelp` | Domain Manager handoff |
| `shakexLoad`, `shakexLoading`, `shakexRefresh` | Load button states |
| `shakexOpenSite`, `shakexListingInstructions`, `shakexDealGuide` | Fixed external links |
| `shakexSettlementNotice` | Asking price versus signed offer; paid-finalize flow and network fees |
| `shakexLoadError`, `shakexLoadTimeout`, `shakexShowingPrevious` | Loading failures and cached rows |
| `shakexSearchLabel`, `shakexSearchPlaceholder` | Canonical-name search |
| `shakexListingCount`, `shakexContactNotice` | Count and unverified seller contact disclaimer |
| `shakexNoMatches`, `shakexEmpty`, `shakexContactForPrice` | Empty/filter/offer-only states |
| `shakexLastVerified`, `shakexVerifiedUnknown`, `shakexRecheckBeforeDeal` | Verification timestamp and freshness |
| `shakexSaleLegend`, `shakexSaleHelp` | Listing form heading and replacement behavior |
| `shakexCurrentRecords`, `shakexPriceLabel`, `shakexPricePlaceholder`, `shakexContactLabel`, `shakexContactPlaceholder` | Current sale fields and input labels/examples |
| `shakexReviewChanges`, `shakexReviewRemoval`, `shakexReviewHelp` | Explicit staging actions and signing distinction |
| `shakexReviewTitle`, `shakexReviewAriaLabel`, `shakexResourceBytes` | Before/after review title, accessibility name and byte budget |
| `shakexPendingOrDirty`, `shakexUnavailable`, `shakexTransferringOrRevoked`, `shakexContextChanged` | Host eligibility and asynchronous-context errors |
| `shakexResourceUnreadable`, `shakexResourceMalformed`, `shakexResourceUnsupported`, `shakexMixedRecord` | Resource/record parse errors |
| `shakexInvalidPrice`, `shakexInvalidContact`, `shakexContactTooLong` | Form validation |
| `shakexResourceEncodeLimit`, `shakexResourceSizeLimit`, `shakexNoSaleRecords`, `shakexAlreadyPublished` | Encoded-size/no-op validation |
| `shakexApiInvalid`, `shakexApiRateLimited`, `shakexApiUnavailable`, `shakexApiOversized` | Client-layer errors; map typed errors to localized UI rather than parsing English strings |

Existing shared Records strings (Submit, Discard Changes, canonical before, complete result, import/refresh states and proposal staleness) also need localization ownership. Avoid duplicating those as ShakeX-only keys. Developer fixture headings and test errors are not end-user strings.
