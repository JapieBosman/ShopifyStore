# DisplayDeck Trade Suite for Shopify
Design and implementation workspace • started 2026-09-28 • live Shopify and commercial validation remain gated.

**Recommendation: fund a two-week validation and technical proof, then conditionally build a debtor-control app for Shopify POS. Do not commit to a general replacement POS or promise a public Windows till.** There is a plausible specialist business, but direct competitors already exist and the original brief contains outdated assumptions.

## Read in this order
1. [Business case and competitor evidence](docs/01-business-case.md)
2. [Genesis and OnlineVersion assessment](docs/02-genesis-rule-extraction.md)
3. [Architecture, business contracts and UX](docs/03-architecture.md)
4. [Shopify integration contract](docs/04-shopify-integration.md)
5. [Schema guide](docs/05-schema-guide.md) and [PostgreSQL table definitions](schema/trade-accounts.sql)
6. [Agent implementation plan](plan/architecture-shopify-trade-accounts-1.md)
7. [Machine-readable progress tracker](plan/tracking.json) and [agent handoff](AGENT-HANDOFF.md)
8. [Validation results](docs/VALIDATION.md)
9. [Build-first demonstration strategy when no merchants are available](docs/evidence/no-merchant-demo-strategy.md)
10. [Development-store integration status](docs/evidence/development-store.md)
11. [Current agent execution handoff](plan/agent-execution-handoff.md)

12. [Next steps and additional suite modules](plan/feature-trade-suite-expansion-1.md) — TASK-039–063, with dependencies and acceptance criteria.

## Boundaries
**Historical initial-build snapshot (2026-09-28):** The paragraph below describes the initial demonstration, not the latest implementation. Read the tracker and current execution handoff for current work.

This workspace includes a dependency-free TypeScript [rule proof](spikes/rule-proof/src/rules.ts), [44 synthetic fixtures](tests/fixtures/genesis-rules.json), domain logic, a local PostgreSQL-compatible schema test, an API skeleton, and a Shopify-authenticated [embedded test app](apps/shopify/genesis-trade-suite/app/routes/app._index.tsx). The app is installed on the owner's DisplayDeck development store and shows a fictional credit decision. It does not yet create Shopify orders, post a ledger, or run in POS. The webhook route verifies signatures and deliberately returns 503 until a durable inbox exists. Source files were inspected read-only. No production database, customer records, paid subscription or merchant communication was accessed or changed. Finance review, Shopify device flows, public distribution eligibility and commercial demand remain explicit gates.

The source brief is preserved in [original-mission.txt](original-mission.txt). Research links are attached to claims in the documents; public information was checked on 2026-09-26. Prices are USD hypotheses unless explicitly attributed to a vendor.

## Decision
Build **DisplayDeck Trade Suite** as one installed suite with one subscription. Account control, allocation, aged debt, statements, audited counter approval and reconciliation are the first release. Cash office, price grids and workshop join the same subscription as each is proven and shipped. A browser counter remains conditional on Shopify distribution permission and demonstrated merchant need.

