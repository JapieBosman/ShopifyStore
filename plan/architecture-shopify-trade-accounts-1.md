---
goal: Build a new Shopify-native trade accounts application using source-derived Genesis formulas
version: 1.0
date_created: 2026-09-26
last_updated: 2026-09-29
owner: Genesis Retail Solutions
status: In progress
tags: [architecture, shopify, greenfield, accounts-receivable, postgresql]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

Build a completely new web product inside Shopify. Genesis and OnlineVersion source are formula/workflow reference material only. No Delphi binary, old database, replication service or existing API is used by the product.

This plan is paired with [tracking.json](tracking.json), the machine-readable status authority. Task state is recorded in tracking.json; commercial and device gates remain open. All implementation paths below are relative to C:/Github/Shopify; evidence files are future deliverables, not files claimed to exist now.

**Current implementation path:** The installed app is `apps/shopify/genesis-trade-suite`, with embedded routes under `app/routes` and its POS extension under `extensions/trade-account`. Older task rows that name `apps/admin` or a root `extensions/trade-account` describe the intended surface; implement those screens in the installed React Router app instead. `apps/admin` remains a local prototype. The [current agent handoff](agent-execution-handoff.md) maps tasks to live paths.

An 8–10-week engineering target is conditional on two experienced full-time engineers, part-time QA/product/finance support, immediate partner/dev-store/device access and Phase 0 success. A single agent without human merchant/device support cannot guarantee it. App review and a full monthly statement cycle can extend launch beyond week 10. Phase 0 uncertainty is deliberate evidence gating, not permission to invent platform capabilities.

## Roadmap extension — 2026-09-29

The [suite expansion plan](feature-trade-suite-expansion-1.md) adds TASK-039–063: current-build verification, collections, quotations, buyer/project controls, customer portal, generic imports, accounting exports/connectors, reports, returns, stock workflows, purchasing and dispatch. Start with TASK-039/040; use tracking.json for current status. New modules remain inside one app and subscription.

Cash office, pricing and workshop retain their existing task identities. Their local engineering dependencies are separated from live pilot gates below and in the tracker; lack of merchants does not block a synthetic prototype. Runtime/delivery proof TASK-040/041 is also required by release validation TASK-027. TASK-038 remains the discovery umbrella; imports/connectors are specified in TASK-050–053.

## Source-first competitive priority

The [Genesis advantage plan](architecture-genesis-advantage-1.md) now governs feature selection. TASK-064–070 trace the seven desktop modules; TASK-071 selects up to three workflow packages with source, platform and competitor evidence. New web surfaces remain proposals until mapped. Runtime TASK-039–042 continues independently. Generic feature breadth is not an advantage claim.

## 1. Requirements & Constraints

- **REQ-001**: New Shopify app: embedded web dashboard plus official POS extension; no Genesis runtime dependency.
- **REQ-002**: Preserve validated credit, allocation, ageing, statement and tender-integrity business semantics; record intentional improvements.
- **REQ-003**: Use TypeScript, the installed Shopify React Router/App Bridge/Polaris runtime, official POS extension components, PostgreSQL and containerised API/worker. The earlier Next.js shell is a local prototype only; see [ADR 0000](../docs/decisions/0000-embedded-runtime.md).
- **REQ-004**: Deliver all six required schema areas using the accompanying reference DDL and mandatory posting invariants.
- **REQ-005**: One public app installation and one recurring subscription grant access to every module released in the suite. Rollout flags are operational, not paid feature tiers.
- **SEC-001**: Server-authenticated tenant/actor context, non-owner RLS, tenant-safe FKs, secret-managed tokens, protected-data review and mandatory compliance handlers.
- **SEC-002**: Financial writes require server authorisation, decimal arithmetic, idempotency, audit and concurrency control.
- **CON-001**: No copied Genesis schema, Delphi executables, live SQL Server dependency, legacy triggers or OnlineVersion backend calls.
- **CON-002**: No public standalone replacement POS, invented tender API, offline account authorisation or unsupported partial-payment write-back.
- **CON-003**: One shop/tenant and one currency per debtor at MVP; no FX, general ledger, factoring, workshop or automated interest.
- **GUD-001**: Treat source code/tests/docs as evidence to verify, not proof of correctness; preserve negative excess credit.
- **PAT-001**: Modular monolith, explicit domain services, append-only accounting, inbox/outbox, per-shop adapter budget and rebuildable projections.

## 2. Implementation Steps

### Implementation Phase 1

- **GOAL-001**: Build and technical proof — initial milestone. Use synthetic merchant data and Shopify development stores. Record commercial demand as unvalidated; live merchant evidence gates public launch, not local implementation.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | **Owner:** Owner. **Files:** docs/evidence/discovery.md. **Action:** After a working demo exists, seek qualified merchants, partners and bookkeepers; record anonymised interviews and pilot interest. Until then, mark demand and price unvalidated. **Depends:** none. **Pass:** Evidence sufficient for a public-launch commercial decision; no interview or commitment is fabricated. This task does not block local engineering. | No | — |
| TASK-002 | **Owner:** Owner + implementation agent. **Files:** docs/evidence/platform-classification.md. **Action:** Document public-app classification for the Shopify POS extension and separately the optional browser counter; obtain Shopify clarification where required. Do not send outreach without owner instruction. **Depends:** none. **Pass:** Official published rules mapped to exact design; any ambiguous core POS/payment classification resolved before dependent launch work. | No | — |
| TASK-003 | **Owner:** Implementation agent. **Files:** spikes/pos-account-flow/; docs/evidence/api-capabilities.md. **Action:** Prove customer and company account orders on 2026-07; test Basic/Grow/Advanced/Plus capability matrix, POS Pro/Lite, physical iOS/Android, draft completion, location, taxes, stock, receipts and duplicate-cart handling. Prove partial manual-payment restrictions and supported write-back path. **Depends:** none. **Pass:** Recorded operations, scopes, plan/device results and unsupported cases; select integrated or disclosed external-receipt mode, never pretend lower-plan partial write-back works. | In progress | — |
| TASK-004 | **Owner:** Implementation agent + finance reviewer. **Files:** tests/fixtures/genesis-rules.json; docs/evidence/formula-parity.md. **Action:** Freeze source file SHA256/anchors and convert observed formulas into sanitised fixtures; include excess-credit sign and period-vs-due-date cases. Derive independently from Delphi rather than copying OnlineVersion expected results. **Depends:** none. **Pass:** At least 30 reviewed fixtures covering signs, date boundaries, allocation, reversal and cash-office arithmetic; unresolved formulas excluded from MVP. | In progress | — |
| TASK-005 | **Owner:** Owner. **Files:** docs/decisions/0001-launch-gate.md. **Action:** After the synthetic demo and technical proof, combine distribution, API, formula and available demand evidence; select launch country/currency/vertical, supported Shopify plans and payment mode. Decide whether to recruit pilots, narrow or stop. **Depends:** TASK-002, TASK-003, TASK-004. **Pass:** Written technical/commercial decision records evidence gaps and next validation step. Lack of pilot merchants cannot be presented as proof of demand or a reason to halt the local demo. | No | — |

### Implementation Phase 2

- **GOAL-002**: Greenfield foundation — weeks 3–4. Exit with authenticated Shopify-only installation, non-owner RLS tests, durable ingestion and clean builds.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | **Owner:** Implementation agent. **Files:** package.json; pnpm-workspace.yaml; apps/shopify/genesis-trade-suite/; apps/api/; apps/worker/; packages/domain/. **Action:** Finish greenfield TypeScript workspaces; pin supported Node/dependencies and Shopify API 2026-07; establish lint/typecheck/test/build commands and stable Polaris/App Bridge integration. **Depends:** none; local foundation may proceed before the commercial gate. **Pass:** Clean install and workspace builds; no Delphi, mssql, Genesis-table or OnlineVersion runtime dependency. Embedded app and read-only POS preview already install on DisplayDeck. | Yes | 2026-09-28 |
| TASK-007 | **Owner:** Implementation agent. **Files:** packages/database/migrations/0001_core.sql; packages/database/tenant-context.ts. **Action:** Translate reference schema MVP tables to migrations; create roles, transaction-local RLS context and tenant-aware repositories; exclude future optional tables until needed. **Depends:** TASK-006. **Pass:** Fresh PostgreSQL migration succeeds; no-context denial and two-tenant FK/RLS tests pass under actual non-owner runtime role. | Yes | 2026-09-28 |
| TASK-008 | **Owner:** Implementation agent. **Files:** apps/api/src/auth/shopify.ts; apps/api/src/auth/roles.ts; tests/integration/auth.test.ts. **Action:** Implement installation/token lifecycle, browser/POS token verification, control-plane routing and cashier/bookkeeper/manager permissions; store token secret references. **Depends:** TASK-006, TASK-007. **Pass:** Wrong signature/audience/shop/expiry rejected; reinstall, expiry and role restrictions proven without leaking tokens. | Yes | 2026-09-28 |
| TASK-009 | **Owner:** Implementation agent. **Files:** apps/api/src/shopify/webhooks.ts; apps/worker/src/inbox.ts; packages/database/outbox.ts; shopify.app.toml. **Action:** Implement HMAC durable inbox, exact topics from integration spec, business deduplication and leased outbox dispatch. **Depends:** TASK-007, TASK-008. **Pass:** Duplicate/out-of-order deliveries and process crash after durable ack cause one effect; durable ack p95 <1s in load fixture. | Yes | 2026-09-28 |
| TASK-010 | **Owner:** Implementation agent. **Files:** apps/api/src/shopify/client.ts; apps/worker/src/reconcile.ts. **Action:** Implement per-shop cost scheduler, userErrors handling, pagination/bulk bootstrap and overlapping sync cursors; keep Preview Events optional. **Depends:** TASK-009. **Pass:** Throttle/HTTP 200 errors handled; missed event recovered by polling with no duplicate financial effect. | Yes | 2026-09-28 |

### Implementation Phase 3

- **GOAL-003**: Financial engine — weeks 4–6. Exit with balanced immutable posting, allocation/ageing parity and concurrent credit tests.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | **Owner:** Implementation agent. **Files:** packages/domain/money.ts; packages/domain/terms.ts; tests/unit/money-terms.test.ts. **Action:** Implement decimal-string money and currency quantisation, net/EOM/COD due dates, local-date cutoffs and versioned ageing basis. **Depends:** TASK-006, TASK-004. **Pass:** Fixtures pass including leap year, month end, zero-/three-decimal currency logic; unsupported v1 currency combinations rejected. (Implementation complete; 49 rule-proof tests and 9 money/terms tests pass; awaiting formal sign-off on TASK-004 dependency). | In progress | — |
| TASK-012 | **Owner:** Implementation agent. **Files:** packages/database/migrations/0002_posting.sql; packages/domain/posting.ts; tests/integration/posting.test.ts. **Action:** Implement post_journal and reverse_posting contracts, document links, restricted grants, immutable records and atomic version/outbox updates. **Depends:** TASK-007, TASK-011. **Pass:** Unbalanced/empty/mixed-currency postings fail; duplicate source is safe; reversal leaves original intact and balances zero. | Yes | 2026-09-28 |
| TASK-013 | **Owner:** Implementation agent. **Files:** packages/domain/allocation.ts; packages/database/migrations/0003_allocation.sql. **Action:** Implement explicit and oldest-issued-first allocation, allocation reversal, overpayment remainder and lock ordering. **Depends:** TASK-012. **Pass:** Concurrent allocation never exceeds debit or credit; debit 10/payment 40 gives net -30 and unapplied 30. | Yes | 2026-09-28 |
| TASK-014 | **Owner:** Implementation agent. **Files:** packages/domain/aging.ts; apps/worker/src/aging.ts. **Action:** Implement all eight due-date buckets and separate calendar-period profile; build versioned snapshots from immutable items and allocations. **Depends:** TASK-013, TASK-011. **Pass:** All boundary fixtures and credit signs pass; sum(open debt)-unapplied equals ledger; no stale snapshot used for authorisation. | Yes | 2026-09-28 |
| TASK-015 | **Owner:** Antigravity implementation agent. **Files:** packages/domain/credit.ts; packages/database/migrations/0004_reservations.sql; tests/integration/credit.test.ts. **Action:** Implement account status/limit policy, row-locked reservation lifecycle, supervisor evidence and atomic consumption. **Depends:** TASK-012, TASK-008. **Pass:** Two 80 baskets against 100 allow one; changed cart/hold invalidates approval; uncertain remote outcome retains exposure. | Yes | 2026-09-28 |
| TASK-016 | **Owner:** Implementation agent. **Files:** apps/api/src/routes/accounts.ts; apps/api/src/routes/payments.ts; apps/api/src/routes/allocations.ts; docs/api/openapi.yaml. **Action:** Expose validated account, receipt, allocation, balance and approval APIs with Idempotency-Key and role/tenant scope; implement chosen payment mode visibly. **Depends:** TASK-013, TASK-014, TASK-015. **Pass:** Contract tests reject wrong tenant/currency/role; retried requests reuse result or reject changed payload. | Yes | 2026-09-28 |

### Implementation Phase 4

- **GOAL-004**: Shopify web and POS workflows — weeks 6–8. Exit with a supported device flow, immutable statements, receipts/refunds and native visibility proven.

| Task | Description | Completed | Date |
| TASK-017 | **Owner:** Implementation agent. **Files:** apps/admin/src/app/accounts/; apps/admin/src/app/allocations/; apps/admin/src/app/onboarding/; apps/shopify/genesis-trade-suite/app/routes/, including `app.demo.tsx`. **Action:** Build embedded debtor list/details, mapping, policy settings and payment workbench using shared API contracts. **Depends:** TASK-016, TASK-008. **Pass:** Keyboard-accessible flows; balances/remainders visible; onboarding needs only Shopify installation, not Genesis. **Evidence:** Signed-in durable account/receipt/reversal/onboarding and restart checks; owner-confirmed create/policy persistence, stale-edit rejection, search, invalid receipts and keyboard Enter navigation. See docs/evidence/browser-walkthrough-2026-09-30.md. | Yes | 2026-09-30 |
| TASK-018 | **Owner:** Implementation agent. **Files:** packages/domain/statements.ts; apps/worker/src/statements.ts; apps/worker/templates/statement.html. **Action:** Implement snapshot cutoff, opening/debit/credit/closing totals, eight buckets, remittance details and deterministic PDF artifact/hash. **Depends:** TASK-014, TASK-012. **Pass:** Historical late posting leaves old statement unchanged; line/control totals match; 1/10/200-line PDF layouts visually inspected. | Yes | 2026-09-29 |
| TASK-019 | **Owner:** Implementation agent. **Files:** apps/admin/src/app/statements/; apps/worker/src/delivery.ts; apps/api/src/routes/statement-delivery.ts; apps/api/src/routes/statements.ts. **Action:** Build preview/build/send workflow, scheduled authorisation, recipient validation, email status callback and retry/uncertain delivery handling; defer SMS. **Depends:** TASK-018, TASK-017, TASK-009. **Pass:** One authorised delivery per idempotency key; bounced/uncertain status visible; PDF links expire and reject other tenants. **Remaining:** Provider sandbox send/callback, deferred at owner request until provider selection. | Deferred | 2026-09-30 |
| TASK-020 | **Owner:** Implementation agent. **Files:** apps/api/src/shopify/orders.ts; apps/worker/src/order-reconciliation.ts. **Action:** Implement the exact account-order path selected by spike; correlate reservation/draft/order and enrolled obligations; handle remote ambiguity without blind create retries. **Depends:** TASK-003, TASK-010, TASK-015, TASK-016. **Pass:** Lost responses, abandoned carts, order edits/cancellation and duplicate hooks produce one correct obligation; no fake paid order. | No | — |
| TASK-021 | **Owner:** Implementation agent. **Files:** extensions/trade-account/src/Tile.tsx; extensions/trade-account/src/AccountModal.tsx; extensions/trade-account/shopify.extension.toml. **Action:** Build supported tile/modal customer selection, balance, PO/job fields, supervisor and confirmation flow; retain source return exceptions. **Depends:** TASK-017, TASK-020. **Pass:** Physical iOS and Android supported plan tests pass; bypass/receipt limitations accurately shown; failure blocks app account sale. | No | — |
| TASK-022 | **Owner:** Implementation agent. **Files:** apps/worker/src/payments.ts; apps/worker/src/refunds.ts; tests/integration/settlement.test.ts. **Action:** Map successful native/manual payment and refund transaction identities; separate receipts, discounts, credit notes and cash refunds; support selected plan/payment mode. **Depends:** TASK-013, TASK-020, TASK-010. **Pass:** Split tender/partial payment/return after payment tested; no double receipt from paid+transaction topics; bank receipt write-back restriction respected. | No | — |
| TASK-023 | **Owner:** Implementation agent. **Files:** apps/api/src/shopify/metafields.ts; apps/worker/src/projections.ts. **Action:** Create the specified app-owned metafield definitions and async projections, with freshness and no sensitive details; omit unsupported types after documented spike result. **Depends:** TASK-017, TASK-020. **Pass:** Admin visibility works; projection delay cannot affect credit approval; ambiguous company buyers do not show wrong account balance. | No | — |

### Implementation Phase 5

- **GOAL-005**: Pilot, operations and submission — weeks 9–10+. Exit with pilot month-close sign-off and accurate submission. Public launch depends on Shopify approval.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-024 | **Owner:** Implementation agent. **Files:** apps/api/src/billing.ts; apps/admin/src/app/billing/; tests/integration/billing.test.ts. **Action:** Implement one Shopify recurring suite subscription, trial and entitlement lifecycle; test approved/declined/frozen/cancelled and price-change cases. Shipped modules share this subscription. **Depends:** TASK-017, TASK-008, TASK-005. **Pass:** No entitlement on return URL alone; dev charges use test; read/export/repayment preserved when billing changes. | No | — |
| TASK-025 | **Owner:** Implementation agent. **Files:** apps/api/src/privacy.ts; apps/worker/src/compliance.ts; docs/operations/privacy-retention.md. **Action:** Implement mandatory compliance handlers, customer data export/redaction, scoped financial retention and uninstall secret revocation; finish protected-data review material. **Depends:** TASK-009, TASK-018, TASK-008. **Pass:** Signed compliance fixtures pass; uninstall blocks new remote calls; PDFs/contact caches obey documented retention. | No | — |
| TASK-026 | **Owner:** Implementation agent. **Files:** Dockerfile; compose.yaml; devops/; docs/operations/runbook.md. **Action:** Build reproducible containers, migration job, private managed services, backup/restore, health checks, alerts and rolling rollback procedure. **Depends:** TASK-006, TASK-012, TASK-009. **Pass:** Staging restore meets proposed RPO/RTO; no secrets in image/log; graceful worker recovery and deployment tested. | No | — |
| TASK-027 | **Owner:** Implementation agent. **Files:** tests/integration/tenant-isolation.test.ts; tests/e2e/trade-account.spec.ts; docs/evidence/release-tests.md. **Action:** Run complete acceptance suite: real PostgreSQL roles/concurrency, money regressions, Shopify plan/device contracts, replay/throttling, accessibility and statement layouts. **Depends:** TASK-019, TASK-021, TASK-022, TASK-023, TASK-024, TASK-025, TASK-026, TASK-040, TASK-041. **Pass:** All required tests pass; evidence records commit, environment and unresolved exclusions; zero unexplained ledger drift. | No | — |
| TASK-028 | **Owner:** Owner + implementation agent. **Files:** docs/evidence/pilot-signoff.md; docs/operations/support.md. **Action:** After a demonstrable prototype, recruit pilot merchants and operate real pilots through a full statement cycle with reconciliation and support measurements. **Depends:** TASK-027, TASK-001. **Pass:** Pilot reconciliations signed; no unexplained debt/receipt/tender difference; demand and support economics still pass. Synthetic tests never count as merchant sign-off. | No | — |
| TASK-029 | **Owner:** Owner + implementation agent. **Files:** docs/app-store/listing.md; docs/app-store/reviewer-guide.md; docs/evidence/launch.md. **Action:** Prepare accurate listing/screenshots, capability and plan restrictions, privacy/support pages, reviewer test account instructions; submit when approved within normal publication workflow. **Depends:** TASK-028, TASK-002, TASK-025. **Pass:** Submission package complete; launch complete only when Shopify approves. Review duration is outside 8–10-week engineering estimate. | No | — |

### Implementation Phase 6

- **GOAL-006**: Expansion: cash office, pricing and conditional browser counter. Each expansion has its own demand/platform acceptance; browser counter can remain deferred forever.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-030 | **Owner:** Implementation agent. **Files:** packages/domain/src/cashoffice.ts; packages/database/migrations/ (next unused number). **Action:** Add schema/session/tender movements, denomination counts and manager reconciliation with immutable submissions. **Depends:** TASK-040, TASK-004, TASK-022, TASK-65, TASK-071. **Live release gate:** TASK-028. **Pass:** Expected cash example 120/count115 gives -5; card refund never reduces cash; closed-shift race fails. | No | — |
| TASK-031 | **Owner:** Implementation agent. **Files:** apps/shopify/genesis-trade-suite/app/routes/app.cash-office.tsx; apps/shopify/genesis-trade-suite/extensions/trade-account/; docs/evidence/cash-session-coverage.md. **Action:** Build float/drop/blind-count/variance UX; prove native session coverage or document supported app-owned session boundaries. **Depends:** TASK-030. **Pass:** Cashier cannot retrieve expected cash before submit; tender totals reconcile across a pilot week. | No | — |
| TASK-032 | **Owner:** Implementation agent. **Files:** packages/domain/src/pricing.ts; packages/database/migrations/ (next unused number); docs/decisions/0002-pricing-authority.md. **Action:** Extract Genesis pricing precedence fixtures; define price-list/assignment/rule/quantity-break entities and Shopify-native catalogue authority; prove supported POS price application. **Depends:** TASK-040, TASK-004, TASK-003, TASK-64, TASK-66, TASK-071. **Live release gate:** TASK-028. **Pass:** Account price/forced deal/quantity boundaries/tax rounding agree with approved fixtures; no unsupported arbitrary price override. | No | — |
| TASK-033 | **Owner:** Implementation agent. **Files:** apps/shopify/genesis-trade-suite/app/routes/app.pricing.tsx; apps/worker/src/catalog.ts; packages/database/migrations/ (next unused number). **Action:** Implement pricing admin and scoped catalogue/barcode/inventory projections with invalidation and duplicated-barcode handling. **Depends:** TASK-032, TASK-010, TASK-69, TASK-071. **Pass:** Shopify checkout totals match displayed quotes; stale price triggers revalidation; scan benchmark recorded. | No | — |
| TASK-034 | **Owner:** Owner. **Files:** docs/decisions/0003-browser-counter.md. **Action:** Reassess fully web counter need within Shopify. Apply current external-POS distribution rules to actual functions and obtain written clarification for ambiguous use cases. **Depends:** TASK-028, TASK-002. **Pass:** Proceed only with lawful supported distribution and three willing users; otherwise defer indefinitely without blocking embedded app. | No | — |
| TASK-035 | **Owner:** Implementation agent. **Files:** apps/counter/; docs/evidence/hardware-matrix.md. **Action:** Only after browser-counter gate, build approved browser surface, local scan index, parked drafts and supported print bridge; no Delphi or offline credit/card dependencies. **Depends:** TASK-034, TASK-033. **Pass:** Warm scan-to-line p95 <100ms on stated device/catalogue; printer/drawer tests; disconnect/reconnect produces no duplicate order. | No | — |

### Implementation Phase 7

- **GOAL-007**: Expansion: workshop and optional finance. Workshop and finance additions require fresh scope approval; do not treat this phase as part of MVP.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-036 | **Owner:** Owner + implementation agent. **Files:** docs/discovery/workshop.md; packages/database/migrations/ (next unused number). **Action:** Design synthetic job-card/status/estimate/parts/labour contracts linked to Shopify orders; distinguish source rules from new requirements. **Depends:** TASK-040. **Pass:** Reviewed synthetic estimate-to-job-to-order contract with no duplicate stock/revenue ownership. **Live release gate:** TASK-028, five interviews, three commitments and owner expansion go decision. | No | — |
| TASK-037 | **Owner:** Implementation agent. **Files:** apps/shopify/genesis-trade-suite/app/routes/app.jobs.tsx; packages/domain/src/workshop.ts. **Action:** Implement approved workshop workflow and job references without turning the app into an ERP; stage additions behind operational rollout flags within the same subscription. **Depends:** TASK-036, TASK-032. **Pass:** Estimate-to-approved-job-to-order acceptance and returns tested; immutable audit and inventory reconciliation. | No | — |
| TASK-038 | **Owner:** Implementation agent + owner. **Files:** docs/roadmap/optional-finance.md. **Action:** Evaluate interest, generic CSV opening items, SMS, signature capture and accounting connectors separately; require exact rule, jurisdiction, consent and demand evidence before each addition. **Depends:** TASK-028. **Pass:** Each feature has separate accepted contract or explicit deferred status; no automatic interest seeded from an unverified assumption. | No | — |

## 3. Alternatives

- **ALT-001**: Full Genesis/OnlineVersion port rejected: legacy persistence and workflows extend well beyond the Shopify product boundary.
- **ALT-002**: General POS replacement rejected for MVP: direct competition, hardware/support scope and Shopify distribution restriction.
- **ALT-003**: Django/DRF is technically viable; TypeScript selected for the greenfield Shopify stack, not as a statement that Python cannot handle financial rules.
- **ALT-004**: Ledger-free metafield balances rejected: no reliable concurrency, allocations or audit.
- **ALT-005**: If POS account completion fails its gate, evaluate admin AR plus POS lookup only; require a revised commercial decision, not silent feature removal.

## 4. Dependencies

- **DEP-001**: No merchants currently exist for discovery or pilot. Build and test with synthetic data first; recruit after a demonstrable prototype. Commercial validation and public launch remain gated by real merchant evidence.
- **DEP-002**: Shopify partner/dev access, plan-specific stores, physical iOS/Android POS and protected customer data review.
- **DEP-003**: PostgreSQL test environment with production-like roles; Docker/container hosting, secret manager, private object storage and email test provider.
- **DEP-004**: Read-only Genesis source and reviewed synthetic fixtures; running legacy infrastructure is not required for production. A test-copy comparison can strengthen formula evidence if available.
- **DEP-005**: Supported native order/payment flow and product classification; amount-specific manual payment currently documented as Plus restricted.

## 5. Files

- **FILE-001**: [Business case](../docs/01-business-case.md), market gates, prices and competitors.
- **FILE-002**: [Rule extraction](../docs/02-genesis-rule-extraction.md), source anchors and discrepancy.
- **FILE-003**: [Architecture](../docs/03-architecture.md), domain/UX/operations contracts.
- **FILE-004**: [Shopify integration](../docs/04-shopify-integration.md), topics, mapping and API constraints.
- **FILE-005**: [Schema guide](../docs/05-schema-guide.md) and [DDL](../schema/trade-accounts.sql), 44 reference tables and production invariants.
- **FILE-006**: [tracking.json](tracking.json), all task dependencies, status, owner and acceptance evidence.
- **FILE-007**: [Handoff](../AGENT-HANDOFF.md), execution protocol and context boundary. Implementation paths are enumerated per task.

## 6. Testing

- **TEST-001**: Decimal and formula fixtures: all eight buckets, excess credit -30, period boundaries, partial payment and settlement discount.
- **TEST-002**: Real PostgreSQL journal balance, immutability, allocation limits, same-tenant FK and RLS under restricted runtime roles.
- **TEST-003**: Two parallel tills, payment/hold races, single-use override and ambiguous Shopify completion preserve credit exposure.
- **TEST-004**: Webhook duplicates/out-of-order/replay plus reconciliation recover one financial effect; throttles and partial GraphQL errors tested.
- **TEST-005**: Supported Shopify plans and physical POS devices pass sale, receipt, partial settlement, cancellation, return and bypass matrix.
- **TEST-006**: Statement effective-date/recorded-cutoff reproducibility, PDF visual checks, remittance totals and delivery retries.
- **TEST-007**: Cash office opening float/drop/refund/blind count and shortage tests; cashier API cannot expose expected amounts.
- **TEST-008**: Installation/token expiry/reinstall/uninstall, billing state and mandatory privacy lifecycle.
- **TEST-009**: Restore, worker crash recovery, load targets and launch-month pilot reconciliation; record results, do not assume.

## 7. Risks & Assumptions

- **RISK-001**: Direct competitors and broader native B2B availability invalidate “no competition/Plus avoidance” positioning.
- **RISK-002**: Shopify POS extension/tender limits and external-POS rules can constrain product scope.
- **RISK-003**: Partial receipt synchronisation differs by Shopify plan; unsupported native write-back can cause double collection if misrepresented.
- **RISK-004**: Copied tests can preserve bugs: the OnlineVersion overpayment sign is the observed example.
- **RISK-005**: API/scopes change; pin versions, repeat capability tests and review quarterly.
- **RISK-006**: Support burden and month-close correctness may exceed assumptions; do not underprice unreconciled financial operations.
- **ASSUMPTION-001**: Owner wants a new Shopify-native SaaS, confirmed during this task; no Genesis deployment/migration project is included.
- **ASSUMPTION-002**: Proposed schedule assumes the team/access in Introduction and is not an App Store approval guarantee.
- **ASSUMPTION-003**: Exact automatic interest, signature support and complete native cash-session API coverage remain unverified and outside MVP.

## 8. Related Specifications / Further Reading

[Package entry](../README.md) · [Original user brief](../original-mission.txt) · [Shopify plan capabilities](https://help.shopify.com/en/manual/b2b/getting-started/plan-features) · [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements) · [POS APIs](https://shopify.dev/docs/api/pos-ui-extensions/latest/target-apis) · [Manual payments](https://shopify.dev/docs/api/admin-graphql/latest/mutations/ordercreatemanualpayment)

Research claims and source links are maintained beside their detailed discussion in the accompanying specifications.
