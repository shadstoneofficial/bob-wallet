# Balance dashboard clarification

This read-only display uses the same backend fields as HNS Investments:

| Label | Field / meaning |
| --- | --- |
| Spendable now | `unconfirmed - lockedUnconfirmed`, before transaction fees |
| Currently locked | `lockedUnconfirmed`; all locked covenant value, not just active auctions |
| Confirmed total | `confirmed`, including confirmed locked coins |
| Current total (including pending) | `unconfirmed`, the complete current accounting snapshot with pending effects, not just incoming pending payments |

The two totals are alternative snapshots, not additive balances. No residual is
classified as burned or refundable. Registered-name purchase value cannot be
refunded, but this aggregate does not identify which locked coins represent it.
Coin maturity, pending state and signing permissions can still constrain a payment.
During incomplete synchronization, missing fields or wallet selection, the display
shows updating/unavailable instead of a false zero or the prior wallet's balance.

## Source race fixes

- Wallet statistics previously survived selection changes, with no session check;
  Overview only refreshed them on height changes. Selection now clears statistics,
  suppresses requests during transition and rejects late A-B-A completions.
- `getAccountInfo` previously selected a wallet before awaiting its account/balance,
  then labelled the result with mutable `this.name`. It now captures and checks
  wallet selection and backend generations. These changes reproduce a source race;
  they do not prove that any user's screenshot represents lost coins.
- Balance refresh IPC now carries wallet/network/context identity. The renderer
  accepts it only after a wallet-specific account snapshot and rejects older
  selection contexts, including queued A-B-A updates.

No transaction construction, signing, rescan or accounting formula was changed.
No user holdings are included in fixtures. No new bridge API or classification
engine is introduced. The in-app explanation is standalone: the planned website
guide at `/docs/wallet-balances/` is not linked before deployment is verified.

Verification is source-only with mocked balances and injected service dependencies.
This is not signed-package acceptance, live-wallet diagnosis or native-speaker
review. The EN/ZH/RU/TH copy is AI-translated and requires independent review.
