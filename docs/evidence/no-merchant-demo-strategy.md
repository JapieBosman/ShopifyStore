# Build-first validation strategy

As of 2026-09-28 there are no recruited merchants or pilot users. This is an idea under development, not a demand-validated business. The $249 monthly price is a research hypothesis.

## Demonstrate without merchant data

1. Use a fictional South African trade merchant with fictional customers, products, locations, staff and orders. Keep the seed deterministic and visibly labelled synthetic.
2. Build one complete vertical slice: account setup and limit, POS account-sale request, invoice/receivable, receipt and allocation, reversal, aged balance and statement. Show the same balances in admin and POS views.
3. Exercise failures: two simultaneous tills at one limit, overpayment, duplicate webhook, return after allocation, month-end cutoff and rejected credit hold. Automated tests compare journal, account and statement totals.
4. Install in a Shopify development store to test actual API scopes, POS extension behavior, plans, location, tax and stock semantics. A simulator cannot prove device or plan support.
5. Record a short scenario-based demo and a clear capability matrix. Use it to recruit merchants and implementation partners later. Ask them about current workflow, alternatives and willingness to pay before treating the price or scope as validated.

## Decision boundaries

- Local implementation and synthetic testing can continue now.
- A development store and Shopify Partner/developer access are needed for platform proof; no merchant account is required. Shopify says dev stores are testing environments and support local app testing with Shopify CLI.
- A finance review is needed before claiming Genesis formula parity or allowing real financial use. Until then, fixtures are provisional.
- Real merchant feedback and reconciled pilots are required before claiming demand, production readiness or a public launch. Lack of recruits today is an evidence gap, not evidence that the idea has failed.

Sources: [Shopify dev stores](https://shopify.dev/docs/apps/build/stores/development-stores), [POS extension getting started](https://shopify.dev/docs/apps/build/pos/getting-started).
