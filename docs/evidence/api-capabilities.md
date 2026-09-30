# TASK-003 capability evidence

Reviewed 2026-09-30 against Admin API 2026-07. This records documentation and pending experiments; it does not claim successful Shopify order mutations.

## Confirmed platform restriction

[Shopify orderCreateManualPayment](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/orderCreateManualPayment) requires `write_orders` and the user's `mark_orders_as_paid` permission. Its `amount` field requires a Shopify Plus installation. The requested version currently redirects to the latest documentation, which identifies itself as 2026-07.

| Store plan | Partial manual payment using amount | Actual store experiment |
|---|---|---|
| Basic | Unsupported by documented restriction | Pending |
| Grow | Unsupported by documented restriction | Pending |
| Advanced | Unsupported by documented restriction | Pending |
| Plus | Documented capability, subject to scope and permission | Pending |

Do not mark a whole order paid to simulate a partial receipt. The current synthetic owner demo records external receipts in the app ledger; Shopify payment write-back has not been demonstrated. Any merchant rollout must disclose differences between Shopify order balances and app ledger balances.

## Physical POS proof

[Shopify's POS setup instructions](https://shopify.dev/docs/apps/build/pos/getting-started) require the POS app on an Android or iOS device. The embedded browser acceptance does not establish device support.

| Required experiment | Evidence still needed |
|---|---|
| POS Lite and Pro on iOS and Android | Plan, device, OS and POS version; extension availability and operation |
| Customer and company account sale | Actual account association, operation response and installed scopes |
| Draft completion | Order identity, outstanding amount and location |
| Taxes and stock | Before/after quantities and tax lines using synthetic products |
| Receipt and duplicate cart | Receipt output and evidence that retries create one order |
| Partial receipt | Lower-plan rejection and Plus success, without real funds |

TASK-003 remains in progress. Next: inspect installed scopes and development-store capabilities, then run isolated synthetic order experiments. Integrated POS mode remains unselected until the complete flow is proven.

## Actual installation check — 2026-09-30, 14:34 SAST

Validated capabilities.graphql against Admin API 2026-07 and executed using the installed app offline session without exposing tokens. Shopify returned Basic, shopifyPlus=false, partnerDevelopment=true and an empty granted accessScopes list. All six configured test permissions are missing. The owner released displaydeck-trade-suite-2 and supplied screenshots showing the new name in Shopify header/sidebar; release alone did not grant scopes to this installation. Next: owner approves installation permission update; rerun scripts/check-shopify-capabilities.mjs before synthetic order mutations.
