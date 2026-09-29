# Shopify integration contract
Design date 2026-09-26; pin Admin GraphQL, webhook and POS extension APIs to 2026-07 for the initial proof. Revalidate when implementation begins. New Events subscriptions are a developer-preview alternative, not a required foundation. [Webhook configuration](https://shopify.dev/docs/apps/build/webhooks/subscribe)

## Authentication and access
Public app installation: validate OAuth state/HMAC or use the supported managed-install/token-exchange flow; bind the installation to the verified shop, encrypt access/refresh tokens through a secret manager, implement expiry/rotation, and revoke worker access on uninstall. App Bridge ID tokens authenticate browser-to-backend requests; verify signature, audience, destination and expiry before deriving tenant. POS uses its supported session authentication; never accept a caller-supplied tenant ID. [Shopify ID tokens](https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens)

Initial requested scopes, subject to feature proof and review: read_customers/write_customers (customer mapping/metafields), read_orders/write_orders (selected orders/metafields/payment recording), read_draft_orders/write_draft_orders (only if approved order flow), read_products, read_inventory, read_locations. Request read_companies/write_companies only when company functions are enabled and available to that installation. Historical access beyond the normal order window requires read_all_orders approval; the app must remain useful without it. Protected customer data access is a separate approval, not implied by OAuth scopes. The foundation task must validate every operation against actual schema permissions and remove unused scopes.

## Identity and mapping
One tenant = one Shopify shop in v1; locations are within that tenant. Company accounts do not merge shops.
- Customer GID identifies a person/buyer; local debtor account identifies who legally owes money.
- Company or CompanyLocation can identify the liability account. Default one debtor per company location where terms/billing differ; explicit future group credit is separate scope.
- Multiple authorised Customer identities can map to one debtor. A customer with several possible purchasing companies requires a selection; the v1 identity uniqueness model supports a single direct mapping per kind/GID and an explicit company-location selection, not inferred shared liability.
- Never infer account mapping from email or customer tags alone. Retain local UUIDs when Shopify names/emails change or a customer is redacted.
- Ordinary Customer accounts are supported without depending on Company APIs; adapt to the shop's actual B2B capabilities.

ProductVariant -> variant_cache; InventoryItem GID links inventory to variants; InventoryLevel -> variant/location projection. GIDs remain text throughout. Bootstrap using GraphQL bulk operations; reconcile incremental changes with an overlap window and source timestamps. Duplicate/multiple barcodes are supported by a separate mapping table; do not constrain barcode globally unique.

## Mutation contracts to prove
| Workflow | Candidate GraphQL operation | Required proof / fallback |
|---|---|---|
| Create account sale | draftOrderCreate followed by draftOrderComplete with supported unpaid/payment-terms semantics | Actual 2026-07 inputs, purchasing entity, taxes, currency, stock/fulfilment location, source attribution and unpaid state. Never assume every plan supports every input. |
| Reflect settled receipt | orderCreateManualPayment where supported; orderMarkAsPaid only for legitimate full remaining settlement | Validate partial payments, transaction lineage, no double record and scope. Never mark an unpaid credit sale paid to make POS checkout look finished. |
| Return/refund | refundCreate or merchant-native refund, imported by refund GID | Correct original tender and stock/restock effects; app credit note must not double-refund money |
| Admin visibility | metafieldsSet | App-owned definitions, owner support, permissions and schema verified |
| Subscription | appSubscriptionCreate | Merchant approval and active-state verification |

A list of mutation names is not proof of the complete flow. TASK-003 produces executable recorded fixtures before POS development commits to it. Full native POS checkout interception/payment-tender creation is **not established** by the API documentation reviewed. [POS target APIs](https://shopify.dev/docs/api/pos-ui-extensions/latest/target-apis)

Remote create mutations are not assumed globally idempotent. Persist a command/reservation before remote call, use a stable correlation attribute, retain returned draft GID before completion, and resolve timeout by reading remote state. If correlation search is incomplete or multiple matches exist, enter uncertain and require reconciliation; do not blindly retry creating an order.

### Material partial-payment restriction
Shopify's current documentation states that the amount field on orderCreateManualPayment requires Shopify Plus, even though native B2B itself now spans lower plans. This is a central feasibility risk for a debtor app accepting partial receipts. [Manual-payment mutation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/ordercreatemanualpayment)

The proof must demonstrate a supported lower-plan partial-settlement path or explicitly limit integrated payment write-back to supported plans. If none exists, offer a clearly disclosed external-receipt subledger mode only after merchant validation: retain partial receipts locally, display Shopify/app differences, prevent duplicate collection through operating controls, and never claim native paid-state synchronisation. A full-order mark-paid fallback is permitted only when the actual remaining order balance is settled. Do not call the amount field illegally or fabricate paid orders. Include this limitation in onboarding and pricing eligibility.

Draft completion supports pending orders through payment terms, but still needs device-flow and plan testing. [Draft completion](https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderComplete)

## Exact classic webhook topics
Use app configuration subscriptions and versioned raw-payload fixtures; verify scope availability during deployment. Mandatory compliance topics use compliance_topics, not ordinary topics.

| Topics | Handler / phase |
|---|---|
| orders/create, orders/updated, orders/paid, orders/cancelled | Refetch authoritative order; match reservation or enrolled account obligation; post once or open an exception; Phase 1 |
| refunds/create | Refetch refund and successful tender transactions; create one linked credit/reversal effect; Phase 1 |
| order_transactions/create | Reconcile financial transaction changes including partial payments; validate subscription support in pinned version; periodic transaction polling remains fallback |
| customers/create, customers/update, customers/delete | Refresh mappings; deletion removes/minimises personal profile under retention policy, never silently deletes owed balances |
| companies/create, companies/update, companies/delete | Optional B2B mapping if company access enabled |
| company_locations/create, company_locations/update, company_locations/delete | Optional billing/terms context |
| products/create, products/update, products/delete | Variant cache invalidation/refresh; Phase 2 catalogue functions |
| inventory_levels/update, inventory_levels/connect, inventory_levels/disconnect | Stock-cache refresh; Phase 2 |
| locations/create, locations/update, locations/delete | Location mapping changes |
| app/uninstalled, app/scopes_update | Disable access, stop outbound work, reconcile capability state |
| app_subscriptions/update | Refresh subscription/entitlements |
| customers/data_request, customers/redact, shop/redact | Mandatory compliance processing; design retention/export/delete handling |

Do not post both orders/paid and order_transactions/create as independent receipts. Use Shopify transaction GID as business identity, success status and the same reconciliation function for webhook, polling and manual replay. Similarly order updates never create another invoice for the same receivable; order edits require delta documents linked to the original.

## Delivery and reconciliation
Verify raw-body HMAC before parsing. Deduplicate deliveries by tenant + X-Shopify-Webhook-Id; retain Event-Id for correlation. Commit inbox then acknowledge, then process asynchronously. Shopify documents a five-second request timeout and retries; duplicate subscriptions can produce separate delivery IDs. [Delivery verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries)

Target durable ack <1 second; reject/return retryable error if durable write fails. Store delivery ID separately from permanent business idempotency (invoice/order, payment/transaction, refund/refund-line). Out-of-order notifications trigger current-state fetch; they cannot overwrite a newer cache with an older payload. A successful webhook ack is not proof financial processing completed.

Poll active credit orders every 15 minutes with a two-hour overlap; nightly full reconciliation of open app AR against accessible Shopify obligations. Persist cursors only after pages commit. Paginate child transactions/refunds; do not assume an order webhook includes complete financial history. Alert on missed permissions, incomplete historical access and order edits after statement close. Build backfill explicitly on installation; no legacy database needed.

Rate budget is per app/shop. Published restore rates are 100/200/1000/2000 points/sec for Standard/Advanced/Plus/enterprise; one query is capped at 1,000 cost points and input arrays at 250. Budget from returned throttleStatus rather than hardcoded throughput. [GraphQL limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits)
Use a per-shop scheduler, priority for sale operations, bounded query depth, cursor pagination, bulk imports and jittered retries on throttles/5xx. Handle HTTP 200 GraphQL errors and userErrors explicitly; don't retry validation errors as network failures.

## Metafield definitions (derived mirrors)
Use app-owned namespace $app:trade_accounts and merchant-readable definitions with no storefront/customer access. Confirm actual owner/type support before deploy. No secret, PIN, certificate or detailed payment history in metafields.

| Owner | Key | Shopify type | Meaning |
|---|---|---|---|
| Customer | account_id | single_line_text_field | Local UUID mapped to one directly linked account |
| Customer | account_number | single_line_text_field | Human-readable account |
| Customer | credit_limit | money | Limit and currency snapshot |
| Customer | credit_hold | boolean | Derived blocked/hold indicator |
| Customer | net_balance | money | Signed balance snapshot; if negative money unsupported for this definition, use number_decimal plus currency definition instead, proven in spike |
| Customer | balance_currency | single_line_text_field | ISO currency |
| Customer | balance_as_of | date_time | Projection freshness |
| Order | account_id | single_line_text_field | Liability account UUID |
| Order | document_id | single_line_text_field | App invoice UUID |
| Order | po_number | single_line_text_field | Customer PO |
| Order | job_reference | single_line_text_field | Job/site reference |
| Order | approval_id | single_line_text_field | Non-secret reservation reference |
| Order | settlement_state | single_line_text_field | open / partial / settled / exception |
Never make native credit decisions from these mirrors. For a multi-company buyer, show company-location context through the app block rather than copying an ambiguous company balance onto Customer.

Cart attributes use _trade_reservation_id and _trade_cart_digest for correlation plus visible Customer PO and Job Reference fields for receipt requirements. Hidden underscore properties are not a guarantee of printed visibility; test receipt rendering separately. [Cart API](https://shopify.dev/docs/api/pos-ui-extensions/latest/target-apis/contextual-apis/cart-api)
No metaobjects are required in v1; normalised accounting stays in PostgreSQL.

## Billing and lifecycle
Implement one fixed recurring suite subscription with appSubscriptionCreate, appRecurringPricingDetails, currencyCode USD, interval EVERY_30_DAYS, trialDays 14 and test:true on development stores. The candidate amount is $249, subject to the commercial gate. Redirect to returned confirmationUrl; on return fetch current subscription and activate only confirmed ACTIVE entitlement. Return URL alone is not approval. Use subscriptions webhook and daily reconciliation for cancellation/frozen states. A later price change requires explicit merchant approval and preservation of any documented founder rate. [Subscription mutation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/appsubscriptioncreate)
Evaluate Shopify-managed App Pricing during foundation; if chosen, document an ADR and replace the billing implementation consistently rather than run two charging systems.

Uninstall stops processing except required compliance tasks and authorised export/retention operations; erase/revoke installation secrets. Separate personal-data redaction from financial record retention according to the launch jurisdiction and Shopify requirements. No claim of global legal compliance is made by this design.
