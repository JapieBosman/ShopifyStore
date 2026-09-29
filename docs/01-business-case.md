# Business case and gap analysis
Research date: 2026-09-26. Recommendation is an inference from published capabilities and source inspection, not evidence of paid demand.

## Verdict
**Conditional go for specialised trade receivables; no-go for an undifferentiated Shopify POS replacement.** Genesis's advantage is knowing how credit sales, partial payments, reversals, statements and cash office operations behave together. It is not merely offering net terms or a credit-limit field.

No credible market census here establishes “hundreds of equivalent trade POS apps.” Shopify's broad accounts-receivable category includes hundreds of products, many reporting or accounting connectors, so that count does not measure direct competition. [App Store category](https://apps.shopify.com/categories/store-management-finances-accounting/all?feature_handles%5B%5D=cf.accounting.financial_operations.accounts_receivable)

## Corrections to the brief
| Brief assumption | Evidence and implication |
|---|---|
| B2B is locked behind Plus at $2,500/month | Outdated. Most B2B capabilities now span all plans; lower plans have catalog restrictions and some advanced features remain gated. Do not sell “avoid Plus” as the central benefit. [Shopify plan matrix](https://help.shopify.com/en/manual/b2b/getting-started/plan-features) |
| Shopify has no payment terms | Incorrect: native B2B has payment terms. Terms alone do not demonstrate a full trade AR subledger. [Native terms](https://help.shopify.com/en/manual/b2b/payment-terms) |
| Nobody supports account sales at the counter | Incorrect as a competitive claim: Molsoft B2B Orders for POS advertises this already. |
| All alternatives are expensive factoring or gift cards | Unsupported. Subscription wholesale, credit-control and accounting products exist. |
| Web till is an uncomplicated App Store expansion | Critical restriction: Shopify says it is not accepting apps connecting to POS systems outside Shopify. Do not treat private/custom distribution as an automatic exemption. Seek written classification for the proposed product before implementation. [App Store requirements, 1.1.8](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements) |
| 270,000 stores / $100bn / 32% growth proves this market | Figures in the supplied brief were not substantiated in this review. Even accurate aggregate POS numbers do not establish trade-credit merchant demand. Exclude them from investment forecasts. |

Native B2B still has POS compatibility constraints in Shopify's published guidance; a third-party extension can add a distinct workflow without turning ordinary native POS checkout into full native B2B. Test actual plan/device combinations. [B2B launch considerations](https://help.shopify.com/en/manual/intro-to-shopify/plus-launch-checklist)

## Competitive assessment
Published claims, not hands-on product tests. “Unverified” means research did not establish capability; it never means the vendor lacks it.

| Product / category | Established overlap | What Genesis must prove |
|---|---|---|
| [Molsoft B2B Orders for POS](https://apps.shopify.com/b2b-pos-1) | $89/month; company pricing and net-term counter orders; requires POS Pro; pairs with OnAccount | This is direct competition. Demonstrate better controlled accounting workflow, not basic on-account ordering. |
| [OnAccount + companion integration](https://molsoft.crisp.help/en/article/integrations-dyprp1/) | Company credit limits and exposure at POS; separate billing. Vendor describes no credit check if OnAccount is unreachable | A potential distinction is fail-closed credit authorisation with reservations across tills. Benchmark current behaviour; do not rely solely on this documented limitation. Full eight-bucket/statement/receipt-allocation depth remains unverified. |
| [SparkLayer](https://apps.shopify.com/sparklayer) | Established B2B ordering and sales workflows; published Pro tier $299/month; accounting integration | Strong adjacent competitor and possible partner. Do not rebuild its wholesale portal. |
| [Wholesale Gorilla](https://apps.shopify.com/wholesale-gorilla) | Wholesale prices, terms and quantity rules | Price grids alone are insufficient differentiation. Detailed cashier control and cash office overlap unverified. |
| [Acumatica Shopify B2B connector](https://www.acumatica.com/media/2025/03/Shopify_B2B_Connector-DS-RET-20250320.pdf) | ERP customer hierarchy, terms and Shopify/POS order integration | Competes for merchants willing to adopt an ERP. Genesis offer should be a smaller, faster adoption for an existing Shopify merchant. |
| Xero / QuickBooks connectors and merchant spreadsheets | Familiar accounting workflow and low incremental adoption cost | An extra subledger must save measurable time without duplicating or corrupting accounting. Benchmark the merchant's actual stack. |

## A second platform risk: partial receipts
Native B2B availability does not imply every payment API is available on every plan. Shopify documents Plus-only use of the amount field on manual-payment creation. This could weaken the lower-plan business case; test supported partial-receipt write-back before selling seamless reconciliation. [Manual payment API](https://shopify.dev/docs/api/admin-graphql/latest/mutations/ordercreatemanualpayment)

## Beachhead and unmet-job hypotheses
Target an existing Shopify retailer with a physical trade counter, 50–1,000 credit accounts, recurring partial payments, and an owner/bookkeeper spending several hours per month on statements and chasing differences. Start with one country/currency and one trade vertical selected by interviews; South African Genesis relationships are a recruitment advantage, not proof of Shopify adoption.

Prioritise: concurrent credit exposure; block/override audit; open-item allocation with unapplied receipts; reproducible statements; tender-specific reversals; cashup variance investigation. Trade context adds PO/job references, authorised buyers, tax-exemption evidence, job-site deliveries, returns against original invoices, and deposits.

Defer: lending/factoring, tax filing, general ledger, purchasing, warehouse management, loyalty ecosystem, offline account authorisation and full ERP migration.

## Two-week commercial gate
Interview 12 qualified merchants (at least 6 already on Shopify with POS and trade credit), 3 implementation partners, and 2 bookkeepers. No messages have been sent; the owner must recruit them or explicitly authorise outreach.
For each merchant capture current apps, Shopify plan/POS Pro, credit customers, monthly invoices, staff hours, dispute frequency, support burden, accounting package and switching constraints.
Demo these scenarios against Molsoft/OnAccount and the merchant's current setup: two tills buying against one limit; overpayment; one receipt allocated across three invoices; return after payment; statement cutoff with late posting; cash refund versus card refund.

Pass only when:
- At least 5 report the same costly workflow gap and provide an anonymised example.
- At least 3 agree in writing to a paid pilot at the candidate single-suite price of $249/month (intent, not revenue), with an identified decision maker. Test willingness at $199, $249 and $299 in interviews; these are research anchors, not separate feature tiers.
- Two pilots can complete an end-to-end month-close evaluation.
- No essential workflow is already solved satisfactorily by a cheaper supported combination.
- Technical/platform gates in the implementation plan pass.

Stop or reposition if merchants mainly want ordinary wholesale pricing, a Windows POS replacement, or inexpensive generic invoicing. If credit-control differentiation is weak but cash-office demand is strong, evaluate a Shopify POS cash-office add-on separately.

## One suite, one subscription: testable assumptions
The merchant installs one Shopify app and approves one recurring subscription. Every feature released in the suite becomes available under that subscription. Internal modules and temporary rollout flags organise engineering and safe deployment; they are not separate products or paid tiers. The single price must cover a meaningful complete workflow at launch, then support cash office, pricing and workshop as they become available. Do not advertise unreleased modules as working.

Test a candidate **$249 per shop / 30 days** with a 14-day trial. Interview probes at $199 and $299 assess price sensitivity, not alternate packages. Keep early pilot terms explicit and consider a founder rate only if the economics support it. The price is a hypothesis, not validated willingness to pay. No GMV percentage, per-module charge or financing fee. Publish a fair-use policy for exceptional compute/email volumes; ordinary multi-location use should not trigger hidden feature gates. Preserve read/export and repayment handling if billing becomes inactive.

At 100 shops gross MRR at the candidate price is $24,900; at 300 it is $74,700. Neither is a sales forecast. Illustrative per-shop monthly costs: $12 infrastructure/email, 0.5 support hours at $30/hour ($15), and $7 billing/distribution reserve = $34; contribution $215 before engineering, tax, acquisition and overhead. A hypothetical $15,000 monthly fixed cost requires 70 such customers. Recalculate Shopify programme fees, location-related costs, support and acquisition before a price decision. At a hypothetical $500 acquisition cost, simple contribution payback is about 2.3 months; this acquisition cost has not been measured.

The all-in-one competitor set includes broader retail operating suites such as [Cin7 Core](https://apps.shopify.com/dear-inventory) and [Brightpearl](https://apps.shopify.com/brightpearl). Scope breadth alone is not a moat. Validate the integrated counter-to-cash-office workflow, speed of setup and quality of reconciliation against those products.
