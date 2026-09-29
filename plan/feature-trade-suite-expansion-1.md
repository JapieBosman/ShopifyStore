---
goal: Expand Genesis Trade Suite with sequenced, testable Shopify modules
version: 1.0
date_created: 2026-09-29
last_updated: 2026-09-29
owner: Genesis Retail Solutions
status: Planned
tags: [feature, roadmap, shopify, trade-suite, agent-handoff]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

One Shopify installation, one subscription, and one connected web suite. This plan extends the original TASK-001–038 roadmap with TASK-039–063. It does not claim that the new features exist. [tracking.json](tracking.json) remains the only status authority; existing task statuses are preserved pending evidence audit.

The recommended sequence is a product judgement: finish the durable demonstration, then strengthen collections, trade sales and reporting before adding stock and purchasing complexity. Merchant demand is still unvalidated. No live users are needed for synthetic implementation and testing; pilot evidence is required for live release.

**First assignment:** TASK-039, then TASK-040. Continue TASK-017/019 and the independent TASK-003/004 evidence work. Do not send a new agent back to TASK-006 merely because the older handoff called it current.

## Source-first competitive priority

The [Genesis advantage plan](architecture-genesis-advantage-1.md) now governs feature selection. TASK-064–070 trace the seven desktop modules; TASK-071 selects up to three workflow packages with source, platform and competitor evidence. New web surfaces remain proposals until mapped. Runtime TASK-039–042 continues independently. Generic feature breadth is not an advantage claim.

## 1. Requirements & Constraints

- **REQ-101**: Ship modules within the existing Genesis Trade Suite subscription. Admin pages, POS extensions and customer-account extensions are surfaces of that app, not separately billed apps.
- **REQ-102**: Use the installed React Router app at `apps/shopify/genesis-trade-suite`, `apps/api/src`, `apps/worker/src` and `packages/domain/src`. Do not add production screens to `apps/admin`.
- **REQ-103**: Use Genesis source read-only to recover business rules; record source hashes and synthetic fixtures before claiming parity. No Delphi, legacy database or OnlineVersion runtime dependency.
- **REQ-104**: Every feature has an independent demonstration, measurable acceptance, explicit dependencies and a module-level release record. Local demonstration completion does not mean public launch.
- **SEC-101**: Authenticate and authorise each server operation; enforce tenant and buyer membership, private artifacts, auditable writes, decimal money, idempotency and concurrency.
- **CON-101**: Shopify owns orders, payments, taxes and inventory for Shopify transactions. The suite owns its trade subledger and operational workflow records. Never create a second stock, tax or payment authority implicitly.
- **CON-102**: Existing MVP exclusions remain. Purchasing, stock, customer portal and service are later modules. Full general ledger, payroll, tax filing, lending, automatic interest and offline credit authorisation are not added to the build queue.
- **CON-103**: No implementation estimate is a launch promise. A feature requiring unknown Shopify operations must complete its capability task first. Research links are inputs, not proof for this app/store/plan.
- **GUD-101**: New paths listed below are intended deliverables. Use existing services where present. For database changes, allocate the next unused migration number after inspecting the directory; never reuse `0005_idempotency.sql` or copy the stale cash-office migration number from the original plan.
- **PAT-101**: Preserve the modular monolith, shared permission checks, immutable ledger and durable inbox/outbox. Each module records workflow state separately from confirmed remote financial/stock effects.

### Priority and merchant value

| Priority | Module | Concrete benefit | Task ownership |
|---|---|---|---|
| Now | Reliable demo and operations | A new agent can start the app and reproduce a complete account workflow | TASK-039–042, existing TASK-017/019/020–027 |
| Next | Cash office and trade pricing | Explain till shortages; apply proven account pricing | Existing TASK-030–033; no duplicate module implementation |
| Next | Collections | Manage overdue accounts, disputes and promises to pay | TASK-044, TASK-062 |
| Next | Quotations and repeat orders | Turn a versioned quote into one supported order | TASK-045–046 |
| Next | Buyer/project controls | Know who may buy, against which account and job | TASK-047 |
| Next | Owner reports | See debt, exposure and exceptions with reconciled totals | TASK-054 |
| Next | Imports and accounting exports | Bring opening items in safely; give bookkeepers a reconciled pack | TASK-050–051 |
| Later | Customer self-service | View statements, submit disputes and remittance advice | TASK-048–049 |
| Later | Accounting connector | Reduce repeat entry after ownership and sandbox proof | TASK-052–053 |
| Later | Returns/warranty desk | Track cases without accidentally issuing credit or stock | TASK-055 |
| Later | Stock counts and transfers | Investigate count differences and location movements | TASK-056–057 |
| Later | Supplier purchasing | Approve replenishment and receive goods once | TASK-058–059 |
| Later | Dispatch/delivery evidence | Track partial job-site deliveries and acknowledgment | TASK-060–061 |
| Existing later scope | Workshop/job cards | Estimate, approve and track service jobs | Existing TASK-036–037; reuse quotes/dispatch when compatible |
| Conditional | Browser counter | Consider only after the existing distribution gate | Existing TASK-034–035 |

### Execution and release rules

1. TASK-039 audits historical completion claims; this planning change does not re-audit the whole implementation.
2. New tasks start as Planned with empty evidence. Before coding, set actual owner/start time and check dependencies in the tracker.
3. TASK-030/032/036 now separate local engineering dependencies from `release_dependencies`. TASK-028 remains a live pilot gate for those modules; no pilot is invented or required merely to design a synthetic prototype.
4. Every new module's live release additionally requires TASK-024–029 as applicable and the TASK-063 module release record. External messages, charges, publication and production mutations follow the owner's actual authorisation.
5. If an external capability/access gate is unavailable, record exactly what is missing and work on an independent task. Do not substitute mocks for that gate.
6. For agent handoff, assign explicit task IDs. One integrator owns tracker edits; never let two agents edit shared module files concurrently.

## 2. Implementation Steps

### Implementation Phase 8

- **GOAL-108**: Close the current build and demonstrate it. Exit when the phase's assigned tasks meet their acceptance evidence; unreleased modules remain unavailable.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-039 | **Reconcile plan evidence and active handoff. Owner:** Implementation agent. **Files:** `docs/evidence/readiness-audit.md`; `plan/agent-execution-handoff.md`. **Action:** Audit each recorded Completed task against its acceptance evidence and prerequisites, including TASK-007/011/012/014. Record implemented, synthetic-tested, externally-verified and release-ready separately; correct unsupported completion only with a recorded reason. Replace stale foundation-first handoff instructions. **Depends:** none. **Pass:** Audit covers every original task; missing external PostgreSQL, finance, POS/device and email evidence is explicit. No test count or completion is inferred from a pasted report. | Yes | 2026-09-29 |
| TASK-040 | **Prove durable runtime and tenant concurrency. Owner:** Implementation agent. **Files:** `apps/api/src/db.ts`; `packages/database/tenant-context.ts`; `tests/integration/postgres-runtime.test.ts`; `docs/LOCAL-TESTING.md`. **Action:** Add an external PostgreSQL test profile using a non-owner runtime role and pinned connections. Exercise concurrent tenants, nested same-tenant transactions, acquisition/BEGIN/rollback failures, migrations on restart and restart persistence. Document API, worker and embedded-app start commands and required environment names. **Depends:** TASK-039, TASK-006, TASK-008, TASK-009. **Pass:** Two concurrent tenants cannot share context or commit each other's work; every checked-out connection is released on errors; financial records survive restart. Record actual external server/version and exact commands. | No | — |
| TASK-041 | **Wire and prove statement recovery end to end. Owner:** Implementation agent. **Files:** `apps/worker/src/index.ts`; `apps/worker/src/delivery.ts`; `packages/domain/src/delivery.ts`; `tests/integration/statement-delivery.test.ts`; `docs/evidence/delivery-gateway-contract.md`. **Action:** Wire dispatch and reconciliation into scheduled worker jobs with leases. Define authoritative not_found versus unknown provider responses, tenant-scoped idempotency and bounded lookup timeouts. Use a local HTTP gateway with a durable message log to inject lost responses, crashes, 503s and delayed visibility; no external customer emails. **Depends:** TASK-040. **Pass:** Crash-before/after-send, unavailable lookup, multiple billing contacts and active slow batch tests produce at most one gateway acceptance per tenant/delivery. Unknown never authorises retry. A real-provider sandbox check remains separate evidence for TASK-019. | No | — |
| TASK-042 | **Record a repeatable owner demo. Owner:** Implementation agent. **Files:** `scripts/seed-synthetic-demo.ts`; `tests/e2e/trade-demo.spec.ts`; `docs/evidence/synthetic-demo.md`; `docs/LOCAL-TESTING.md`. **Action:** Create repeatable synthetic fixtures and a guided embedded walkthrough: debtor, hold/limit, invoice, partial receipt, overpayment, allocation, reversal, aged balance, immutable PDF and captured email. Label Shopify test orders versus internal synthetic obligations; use TASK-020 only when proven. **Depends:** TASK-040, TASK-017, TASK-018, TASK-041. **Pass:** A new agent follows documented startup and completes the scenario without Genesis or real merchants; restart preserves records; screenshots and totals match fixtures. Device/order gaps stay visible. | No | — |

### Implementation Phase 9

- **GOAL-109**: Trade sales, collections and self-service. Exit when the phase's assigned tasks meet their acceptance evidence; unreleased modules remain unavailable.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-043 | **Suite navigation and module registry. Owner:** Implementation agent. **Files:** `apps/shopify/genesis-trade-suite/app/modules.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.tsx`; `apps/api/src/auth/roles.ts`; `tests/unit/module-registry.test.ts`. **Action:** Add one module registry with route, permissions, operational flag, implementation task IDs and capability evidence references. Group Accounts, Sales, Cash Office, Stock, Service and Reports. Unreleased modules display planned state without functional claims; share the existing subscription. **Depends:** TASK-040, TASK-017. **Pass:** One installation and subscription; flags never create paid tiers; direct URL/API access enforces permissions; planned modules cannot submit transactions. | No | — |
| TASK-044 | **Collections workbench and payment promises. Owner:** Implementation agent. **Files:** `packages/domain/src/collections.ts`; `apps/api/src/routes/collections.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.collections.tsx`; `tests/integration/collections.test.ts`. **Action:** Implement overdue worklists, assigned collector, contact notes, disputed items, dated promises to pay and promise follow-up. Derive balances from open items; a promise never posts a receipt or releases credit. Add reminder preview; dispatch uses TASK-019 and TASK-062 only after their gates. **Depends:** TASK-043, TASK-014, TASK-66, TASK-071. **Pass:** Partial payment refreshes overdue amount; promise does not reduce exposure; cross-tenant access fails; disputes remain accounted for; reminders require current balance and authorised recipient. | No | — |
| TASK-045 | **Quotation capability and business contract. Owner:** Implementation agent. **Files:** `spikes/quotes/`; `docs/evidence/quote-capabilities.md`; `docs/decisions/0004-quote-authority.md`. **Action:** Prove supported draft-order operations on the pinned API and dev store: taxes, customer/company mapping, currency, price changes, expiry, completion and read-after-timeout. Define quote versions and acceptance; distinguish a quote from an invoice and a payment. **Depends:** TASK-010. **Pass:** Record exact scopes/operations and observed restrictions; choose the supported conversion path. Unsupported company or pricing modes are disabled explicitly. | No | — |
| TASK-046 | **Quotation and repeat-order module. Owner:** Implementation agent. **Files:** `packages/domain/src/quotes.ts`; `apps/api/src/routes/quotes.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.quotes.tsx`; `tests/integration/quotes.test.ts`. **Action:** Build draft, sent, accepted, expired and cancelled quote versions with PO/job reference, validity date, duplicate-as-new and repeat-order templates. Revalidate price/tax/stock/credit on conversion using the proven order adapter. Do not reserve stock or recognise receivables merely by quoting. **Depends:** TASK-043, TASK-045, TASK-020, TASK-64, TASK-68, TASK-071. **Pass:** Changed/expired quotes require a new accepted version; duplicate acceptance creates one Shopify order and one obligation; lost conversion response reconciles before retry; repeat orders recalculate current values. | No | — |
| TASK-047 | **Authorised buyers and customer projects. Owner:** Implementation agent. **Files:** `packages/domain/src/buyers.ts`; `apps/api/src/routes/buyers.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.buyers.tsx`; `tests/integration/buyers.test.ts`. **Action:** Manage account buyer memberships, active dates, purchase limits, PO requirements and project/job-site references. Preserve the existing return exception for PO requirements. Enforce suite-level buyer checks on server authorisation and document any native checkout bypass. **Depends:** TASK-043, TASK-015, TASK-66, TASK-071. **Pass:** Revoked buyer cannot obtain new approval; project limits do not replace account credit checks; simultaneous approvals respect both limits; company/customer mapping cannot expose another account. | No | — |
| TASK-048 | **Customer portal identity proof. Owner:** Implementation agent. **Files:** `spikes/customer-portal/`; `docs/evidence/customer-portal-capabilities.md`. **Action:** Verify customer-account extension targets and signed identity on the pinned API; map customer/company membership to one or more permitted debtor accounts. Test revoked membership and shared billing contact without using email as authority. **Depends:** TASK-008. **Pass:** Document supported customer account mode, scopes and protected-data requirements; arbitrary account IDs and email matches cannot grant access. No customer invitation is sent. | No | — |
| TASK-049 | **Trade customer self-service portal. Owner:** Implementation agent. **Files:** `apps/shopify/genesis-trade-suite/extensions/trade-portal/`; `apps/api/src/routes/customer-portal.ts`; `tests/integration/customer-portal.test.ts`. **Action:** Expose authorised account balances, open invoices, expiring statement downloads, PO/project history, dispute requests and remittance advice. Use a supported Shopify payment path only after TASK-003/TASK-022 proof; an uploaded remittance is unverified evidence, never an automatic receipt. **Depends:** TASK-048, TASK-043, TASK-018, TASK-025. **Pass:** Customer sees only permitted accounts; membership removal takes effect server-side; shared/guessed file IDs fail; remittance cannot mark an order paid or reduce debt. | No | — |
| TASK-050 | **Generic opening-item and contact imports. Owner:** Implementation agent. **Files:** `packages/domain/src/imports.ts`; `apps/api/src/routes/imports.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.imports.tsx`; `tests/integration/imports.test.ts`. **Action:** Implement documented CSV templates, preview, validation, batch hash/idempotency, source reference deduplication and explicit commit for generic contacts/opening items. Post opening debits/credits through ledger services with control totals; exclude obligations already represented by Shopify orders. **Depends:** TASK-040, TASK-012, TASK-013, TASK-004, TASK-66, TASK-071. **Pass:** Dry run writes no financial records; invalid/mixed-currency/cross-tenant rows reject the batch; replay posts once; overpayment stays credit; corrections use reversals; no legacy schema/database dependency. | No | — |
| TASK-051 | **Accounting export and reconciliation pack. Owner:** Implementation agent. **Files:** `packages/domain/src/accounting-export.ts`; `apps/api/src/routes/accounting-export.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.accounting.tsx`; `tests/integration/accounting-export.test.ts`. **Action:** Create generic CSV exports for journal lines, open items, allocations, receipts and reversals with immutable export batch IDs, source IDs, currency, cutoff and account mappings. Separate Shopify-origin entries from app-origin entries to prevent double accounting. **Depends:** TASK-040, TASK-012, TASK-013, TASK-67, TASK-071. **Pass:** Export debits equal credits; repeat export of frozen batch is identical; correction does not mutate old export; bank/Shopify control totals and unmatched items are explicit; CSV formula injection is neutralised. | No | — |
| TASK-052 | **Accounting connector feasibility. Owner:** Implementation agent. **Files:** `docs/evidence/accounting-connectors.md`; `docs/decisions/0005-accounting-authority.md`; `spikes/accounting-connectors/`. **Action:** Compare Xero, QuickBooks and Sage sandbox access, supported regions, APIs, mappings and webhook/replay contracts using current official docs. Select one for the first connector only after sandbox access and a defined accounting authority; otherwise retain the generic export. **Depends:** TASK-051. **Pass:** Record selected provider and why, or an explicit access blocker; define ownership for invoices, receipts, taxes and contacts plus duplicate prevention when another Shopify connector exists. | No | — |
| TASK-053 | **First approved accounting connector. Owner:** Implementation agent. **Files:** `apps/api/src/accounting/`; `apps/worker/src/accounting-sync.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.accounting.tsx`; `tests/integration/accounting-sync.test.ts`. **Action:** Implement only the provider selected by TASK-052 using secret-managed OAuth, source IDs, leased outbox, status/retry UI and reconciliation. Start with explicitly approved one-way records; leave ambiguous accounting records in an exception queue. **Depends:** TASK-052, TASK-051, TASK-026. **Pass:** Duplicate events/lost response cannot create duplicate accounting documents; revoked access stops sends; balanced control totals and sandbox reconciliation pass. No unverified automatic bidirectional sync. | No | — |
| TASK-054 | **Owner dashboard and exception centre. Owner:** Implementation agent. **Files:** `apps/api/src/routes/reports.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.reports.tsx`; `tests/integration/reports.test.ts`. **Action:** Add aged debt, overdue concentration, limit utilisation, unapplied cash, failed integrations and uncertain deliveries with drill-down and as-of/freshness labels. Show cash variance only after TASK-031 and realised margin only where cost evidence exists; omit unsupported metrics. **Depends:** TASK-043, TASK-014, TASK-67, TASK-071. **Pass:** Totals reconcile to ledger/open items for same cutoff and currency; stale projections cannot authorise credit; role and location filters are server-enforced; unavailable modules show no invented zeros. | No | — |
| TASK-055 | **Returns and warranty case tracking. Owner:** Implementation agent. **Files:** `packages/domain/src/returns.ts`; `apps/api/src/routes/return-cases.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.returns.tsx`; `tests/integration/return-cases.test.ts`. **Action:** Add case intake linked to original order/line, reason, inspection, warranty evidence and disposition; route approved financial outcomes through existing settlement logic and proven Shopify return operations. Keep serial capture informational until inventory proof covers it. **Depends:** TASK-043, TASK-022, TASK-68, TASK-071. **Pass:** Case creation changes no money/stock; credited/refunded quantity cannot exceed eligible original quantity; return after partial payment reconciles; replay creates one outcome; cash/card/account refunds remain distinct. | No | — |
| TASK-062 | **Audited reminders and workflow automation. Owner:** Implementation agent. **Files:** `packages/domain/src/automation.ts`; `apps/worker/src/automation.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.automation.tsx`; `tests/integration/automation.test.ts`. **Action:** Add deterministic rules for overdue reminder drafts, promise follow-up and internal exceptions with preview, approval, cooldown, tenant-local schedule, recipient preferences and event deduplication. Auto-send stays off until configured and authorised; no automated interest or credit overrides. **Depends:** TASK-044, TASK-019. **Pass:** Repeated scheduler runs create one event per rule/account/window; payment before dispatch suppresses obsolete reminder; changed recipient invalidates approval; failures follow delivery uncertainty handling. | No | — |

### Implementation Phase 10

- **GOAL-110**: Stock, suppliers and delivery. Exit when the phase's assigned tasks meet their acceptance evidence; unreleased modules remain unavailable.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-056 | **Stock workflow capability proof. Owner:** Implementation agent. **Files:** `spikes/inventory/`; `docs/evidence/inventory-capabilities.md`; `docs/decisions/0006-inventory-authority.md`. **Action:** Prove inventory reads, counts/adjustments, transfers and receiving against the pinned API, scopes and test locations. Record idempotency, concurrent quantity changes and source-of-truth rules. Shopify owns stock; suite stores workflows and projections. **Depends:** TASK-010. **Pass:** Record exact operations and tests for two locations, concurrent sale/count, partial receiving and lost responses; unsupported writes stay disabled. | No | — |
| TASK-057 | **Stock counts and inter-location transfers. Owner:** Implementation agent. **Files:** `packages/domain/src/stock-workflows.ts`; `apps/api/src/routes/stock-workflows.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.stock.tsx`; `tests/integration/stock-workflows.test.ts`. **Action:** Implement blind cycle counts, count approval, variance reason and transfer pick/ship/receive workflows using the proven adapter. Revalidate quantities before approved writes, correlate remote effects and reconcile uncertainty. Do not introduce an independent available-stock balance. **Depends:** TASK-056, TASK-043, TASK-69, TASK-071. **Pass:** Concurrent sale/count cannot silently overwrite stock; duplicate receipt applies once; partial transfer receipt preserves remainder; count preview changes no stock; confirmed Shopify quantities match projections. | No | — |
| TASK-058 | **Purchasing and supplier capability contract. Owner:** Implementation agent. **Files:** `spikes/purchasing/`; `docs/evidence/purchasing-capabilities.md`; `docs/decisions/0007-purchasing-authority.md`. **Action:** Verify native purchase-order and receiving APIs/scopes available to this app and plan; define suppliers, order approvals, partial receipt and cancellation boundaries. Choose native ownership if supported; otherwise document app-owned purchasing workflow with only proven inventory writes. **Depends:** TASK-010. **Pass:** Decide supported mode from real dev-store operations; no fabricated purchase-order endpoint. Supplier payments, accounts payable, landed cost and valuation remain excluded from this first module. | No | — |
| TASK-059 | **Supplier purchasing and replenishment. Owner:** Implementation agent. **Files:** `packages/domain/src/purchasing.ts`; `apps/api/src/routes/purchasing.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.purchasing.tsx`; `tests/integration/purchasing.test.ts`. **Action:** Build supplier directory, min/max reorder proposals from current Shopify stock, approved purchase orders and partial goods receipt using the TASK-058 ownership decision. Separate proposed, ordered and received quantities; require approval before native mutations. **Depends:** TASK-058, TASK-056, TASK-043, TASK-69, TASK-70, TASK-071. **Pass:** Proposal creates no purchase/stock effect; replayed receipt does not double stock; cancelled or excessive receipt rejects; unit/currency mismatches reject; no automatic supplier payment or AR posting. | No | — |
| TASK-060 | **Dispatch and proof-of-delivery contract. Owner:** Implementation agent. **Files:** `spikes/dispatch/`; `docs/evidence/dispatch-capabilities.md`. **Action:** Prove supported fulfillment-order/location operations, partial fulfillment, pickup versus delivery and evidence attachment access. Define privacy/retention for signatures/photos and what a delivery acknowledgment means; no legal-signature guarantee. **Depends:** TASK-010, TASK-020. **Pass:** Document scopes, source authority, supported statuses and cancellation races using test orders; delivery evidence cannot imply payment. | No | — |
| TASK-061 | **Job-site dispatch and delivery evidence. Owner:** Implementation agent. **Files:** `packages/domain/src/dispatch.ts`; `apps/api/src/routes/dispatch.ts`; `apps/shopify/genesis-trade-suite/app/routes/app.dispatch.tsx`; `tests/integration/dispatch.test.ts`. **Action:** Build dispatch board with job/site references, pick list, split quantities, assigned driver, delivery acknowledgment and signed/private evidence links. Reconcile Shopify fulfillment only through supported operations; expose pending/uncertain states. **Depends:** TASK-060, TASK-043, TASK-64, TASK-071. **Pass:** Duplicate acknowledgment does not duplicate fulfillment; cancelled orders cannot dispatch; split quantities sum to original; evidence access is tenant/customer scoped; delivery does not create payment. | No | — |

### Implementation Phase 11

- **GOAL-111**: Release modules independently. Exit when the phase's assigned tasks meet their acceptance evidence; unreleased modules remain unavailable.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-063 | **Reusable expansion release checklist. Owner:** Implementation agent. **Files:** `docs/evidence/module-release-template.md`; `tests/e2e/suite-modules.spec.ts`; `docs/operations/module-rollout.md`. **Action:** Define a per-module release record referencing registry task IDs, completed dependencies, supported plan/device matrix, migrations/restore, privacy, one-subscription entitlement, synthetic evidence, pilot feedback and rollback flag. Apply independently to each implemented module rather than waiting for every roadmap idea. **Depends:** TASK-042, TASK-027. **Pass:** Every enabled module has its own passing record; unreleased modules remain planned; one module can roll back without corrupting ledger/stock or disabling read/export. Synthetic evidence is never labelled real pilot validation. | No | — |

## 3. Alternatives

- **ALT-101**: Separate app subscriptions rejected for this roadmap because they contradict the owner's one-suite model. Separate extensions remain possible inside one app.
- **ALT-102**: Rebuild every Genesis module immediately rejected: it delays a usable demonstration and multiplies accounting/stock authority risks.
- **ALT-103**: Full accounting replacement rejected for this increment. Start with balanced exports and one proven connector.
- **ALT-104**: Full warehouse management, forecasting AI, loyalty/gift-card replacement and automatic interest remain candidates outside this build queue. Define demand, native overlap and financial contracts before scheduling them.

## 4. Dependencies

- **DEP-101**: The original architecture plan remains the contract for TASK-001–038. Existing dependencies are referenced, not redeclared as new tasks.
- **DEP-102**: External PostgreSQL, test gateway, Shopify dev store and suitable POS devices are separate evidence environments. Missing access is not a failed business case.
- **DEP-103**: Customer-account identity, inventory, purchasing and fulfillment operations require capability proofs before dependent implementation.
- **DEP-104**: Accounting provider selection and sandbox credentials are unresolved until TASK-052; no provider has been selected by this roadmap.
- **DEP-105**: Cash-office source reference: `C:/Github/GENESIS/genCOF`; trade controls/pricing: `C:/Github/GENESIS/genTIL`; debtor rules: `C:/Github/GENESIS/genDEB` and `System/DEB`. New modules without reviewed source anchors are new-product requirements, not claimed Genesis parity.

## 5. Files

- **FILE-101**: `plan/feature-trade-suite-expansion-1.md` — this roadmap and acceptance contracts.
- **FILE-102**: `plan/tracking.json` — task status authority, dependency graph and release dependencies.
- **FILE-103**: `plan/architecture-shopify-trade-accounts-1.md`, `plan/agent-execution-handoff.md`, `AGENT-HANDOFF.md`, `README.md` — entry points and current assignment order.
- **FILE-104**: `docs/PROGRESS.md` — append-only work summary. Task rows enumerate implementation/test/evidence deliverables; their presence is not presumed.

## 6. Testing

- **TEST-101**: Runtime: real PostgreSQL restricted roles, concurrent tenant requests, BEGIN failure/release, restart persistence and clean migration restart.
- **TEST-102**: Delivery: local HTTP gateway with persistent receipts; accepted-send/crash/status-503 must not resend; explicitly confirmed absence may retry; tenant keys cannot collide.
- **TEST-103**: Financial workflows: exact decimal values, date/currency boundaries, duplicate CSV batches, quote acceptance replay, overpayment signs and balanced exports.
- **TEST-104**: Identity: revoked buyer and cross-account portal access fail server-side, including downloads and direct API requests.
- **TEST-105**: Stock/dispatch: simultaneous sale/count, duplicate receiving, partial quantities, cancellation and lost remote response are tested on supported dev-store operations.
- **TEST-106**: Run `pnpm test`, `pnpm typecheck`, `pnpm shopify:typecheck` and `pnpm build` for implementation changes; capture relevant browser/device results separately. Tests passing locally do not imply merchant or device verification.
- **TEST-107**: Plan validation: unique TASK declarations across both plans, exact tracker task coverage, dependency references exist, graph is acyclic, new tasks are Planned with empty evidence, and no previously recorded status silently changes.

## 7. Risks & Assumptions

- **RISK-101**: Breadth alone does not establish differentiation. Prioritisation is a workflow hypothesis to validate through demos and later merchant interviews.
- **RISK-102**: Explicit provider not_found must be authoritative; eventual consistency, an unavailable endpoint or a generic HTTP 404 cannot establish safe resend.
- **RISK-103**: Multiple stock/accounting integrations can produce duplicate mutations. Prove ownership and external identity mapping before writing.
- **RISK-104**: Generic imports can double-count existing Shopify debt. Preview, reconciliation and source identity checks are mandatory.
- **ASSUMPTION-101**: There are no real merchants yet. Synthetic development continues; demand, paid uptake and pilot sign-off remain unverified.
- **ASSUMPTION-102**: Additional module code is not being implemented by this documentation update. The user can assign the tasks independently.
- **ASSUMPTION-103**: The project currently pins Shopify API 2026-07; each capability task must inspect the actual configuration before using documentation or changing the version.

## 8. Related Specifications / Further Reading

- [Original architecture and tasks](architecture-shopify-trade-accounts-1.md), [status tracker](tracking.json), [execution handoff](agent-execution-handoff.md), [source-rule map](../docs/02-genesis-rule-extraction.md).
- [Shopify customer-account extensions](https://shopify.dev/docs/apps/build/customer-accounts): official surface for account extensions; legacy accounts are not supported. The portal task still proves the chosen store configuration.
- [Shopify inventory transfers](https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventoryTransferCreate): native transfer operations have specific scopes and idempotency requirements; task evidence must record the pinned-version behaviour.
- [Shopify inventory quantity writes](https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorySetQuantities): use the documented authority/concurrency semantics when deciding how approved counts are applied.
- Public references checked 2026-09-29. They establish potential integration surfaces, not completed implementation or universal plan eligibility.

