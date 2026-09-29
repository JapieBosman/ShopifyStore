# Architectural Readiness Audit & Plan Reconciliation

**Document:** `docs/evidence/readiness-audit.md`  
**Date:** 2026-09-29  
**Task:** TASK-039 — Reconcile plan evidence and active handoff  
**Authority:** [tracking.json](../../plan/tracking.json), [architecture-shopify-trade-accounts-1.md](../../plan/architecture-shopify-trade-accounts-1.md), [feature-trade-suite-expansion-1.md](../../plan/feature-trade-suite-expansion-1.md)  
**Status Authority:** `plan/tracking.json` is the sole machine-readable authority.

---

## 1. Executive Summary

This audit assesses the completion claims and evidence base for all 38 original tasks (TASK-001 through TASK-038) of the **Genesis Trade Suite for Shopify**. 

### Key Audit Findings

1. **Synthetic Completeness vs. Live External Verification:**
   The monorepo contains a high-quality, robust TypeScript and PostgreSQL codebase. All 132 automated tests pass across unit and integration suites (`pnpm test`), typechecks pass cleanly (`pnpm typecheck`, `pnpm shopify:typecheck`), and production builds succeed (`pnpm build`). However, most "Completed" claims represent **synthetic completeness** (verified in memory with `@electric-sql/pglite` and HTTP mocks), rather than **external live verification** on real Shopify production stores, external standalone PostgreSQL servers, physical POS hardware, or external email delivery networks.

2. **The Dependency Inversion Caveat (TASK-004 / TASK-011 vs. TASK-012 / TASK-013 / TASK-014):**
   - [TASK-011](../../packages/domain/src/terms.ts) ("Money and dates") is tracked as **In progress** because it is gated on formal finance reviewer sign-off on [TASK-004](../../spikes/rule-proof/src/rules.ts) ("Formula proof"). 
   - Downstream tasks [TASK-012](../../packages/domain/src/posting.ts) (Ledger), [TASK-013](../../packages/domain/src/allocation.ts) (Allocation), and [TASK-014](../../packages/domain/src/aging.ts) (Ageing) are recorded as **Completed**. 
   - While the code, mathematical invariants, and database triggers for these modules are fully implemented and pass all 47 parity fixtures, their completion is formally conditional on the pending finance sign-off on TASK-004/011.

3. **External Database Runtime Gap (TASK-007 vs. TASK-040):**
   [TASK-007](../../packages/database/migrations/0001_core.sql) ("Tenant database") is recorded as **Completed** based on migrations and tests executed against in-process WASM PGlite. PGlite does not validate network socket connection pooling, OS-level process restarts, external role permissions under `pg_hba.conf`, or multi-process concurrency. Proving the runtime against a live, external PostgreSQL database is the explicit purpose of **TASK-040**.

4. **Embedded UI DisplayDeck Evidence Limits (TASK-017):**
   Owner screenshots from 2026-09-29 confirm that the embedded **Home**, **Trade Accounts**, **Allocation Workbench**, and **Setup & Onboarding** pages successfully render inside the Shopify admin iframe on `displaydeck.myshopify.com`. However:
   - The UI is currently operating in `demo_memory` mode without a connected `TRADE_API_URL`.
   - The screenshots prove rendering only; they do not show submitted receipts, balance mutations, reversals, or durable posting.
   - **TASK-017 must remain In progress.** The embedded workflow cannot be marked complete from screenshots alone. The immediate browser acceptance step is submitting and reversing a synthetic allocation for `ACC-002`.

5. **Statement Delivery Gating (TASK-019):**
   Two-phase crash-proof dispatch, stale send reconciliation, AES-256-GCM recipient encryption, and tenant-bound signed download URLs are implemented and verified across 15 integration tests. However, zero real emails have been dispatched through a live provider gateway (e.g., SendGrid, Postmark, or AWS SES). TASK-019 is correctly tracked as **In progress**.

6. **Next Immediate Step:**
   **TASK-040 (Prove durable runtime and tenant concurrency)** is the exact next ready task.

---

## 2. Four-Tier Readiness Framework

To prevent misleading claims, every task is evaluated across four distinct dimensions:

| Tier | Definition | Meaning |
|---|---|---|
| **Tier 1: Implemented** | Code, migrations, templates, or documentation exist in `C:\Github\Shopify`. | Not a placeholder or stub. |
| **Tier 2: Synthetic-Tested** | Automated unit and integration tests pass in local CI using PGlite and mock drivers. | Deterministic, repeatable local proof. |
| **Tier 3: Externally-Verified** | Tested against real external environments: live standalone PostgreSQL, Shopify API, dev store iframe, physical POS device, or real email provider. | Proven against real external software/hardware. |
| **Tier 4: Release-Ready** | Validated with real pilot merchants, commercial agreements, and public App Store review approval. | Ready for commercial production. |

---

## 3. Comprehensive Task Audit (TASK-001 through TASK-038)

### Phase 1: Technical & Commercial Discovery

| Task ID | Title | Tracker Status | Implemented | Synthetic-Tested | Externally-Verified | Release-Ready | Audit Finding & Status Justification |
|---|---|---|:---:|:---:|:---:|:---:|---|
| **TASK-001** | Commercial demand | **Planned** | No | N/A | No | No | **Planned.** 0 merchant interviews or pilot commitments recorded. Correctly marked unvalidated. |
| **TASK-002** | Distribution | **Planned** | No | N/A | No | No | **Planned.** Official Shopify POS extension public distribution rules documented, pending owner outreach. |
| **TASK-003** | POS & payment feasibility | **Planned** | No | N/A | No | No | **Planned.** Physical iOS/Android POS Pro/Lite device matrix and manual payment write-back restrictions remain unverified. |
| **TASK-004** | Formula proof | **In progress** | **Yes** | **Yes** | No | No | **In progress.** 47 formula fixtures derived from Genesis rules and implemented in `spikes/rule-proof`; pending formal finance reviewer sign-off. |
| **TASK-005** | Launch decision | **Planned** | No | N/A | No | No | **Planned.** Formally gated on TASK-002, TASK-003, and TASK-004. |

---

### Phase 2: Greenfield Foundation

| Task ID | Title | Tracker Status | Implemented | Synthetic-Tested | Externally-Verified | Release-Ready | Audit Finding & Status Justification |
|---|---|---|:---:|:---:|:---:|:---:|---|
| **TASK-006** | Foundation | **Completed** | **Yes** | **Yes** | **Yes** | No | **Completed.** Clean TypeScript workspaces, pinned Node 24/Shopify API 2026-07, zero Delphi/MSSQL runtime dependencies. Embedded app and POS extension preview install on `displaydeck.myshopify.com`. |
| **TASK-007** | Tenant database | **Completed** | **Yes** | **Yes** | No | No | **Completed (Synthetic).** Schema migrations `0001_core.sql`..`0005_idempotency.sql`, RLS policies, non-owner `app_runtime` role verified in PGlite. External PostgreSQL multi-connection verification is deferred to **TASK-040**. |
| **TASK-008** | Authentication | **Completed** | **Yes** | **Yes** | **Partial** | No | **Completed.** Cryptographic Shopify session token verification, role permissions (cashier, bookkeeper, manager), tenant isolation. App Bridge authenticates in DisplayDeck; cloud secret manager integration remains simulated via `secrets://`. |
| **TASK-009** | Event reliability | **Completed** | **Yes** | **Yes** | No | No | **Completed (Synthetic).** Durable webhook inbox with raw HMAC verification, idempotency deduplication, leased outbox dispatch. Real Shopify webhook deliveries over public Internet remain to be tested in staging. |
| **TASK-010** | Shopify adapter | **Completed** | **Yes** | **Yes** | No | No | **Completed (Synthetic).** GraphQL client with cost scheduler, HTTP 429/200 THROTTLED retry handling, pagination, and cursor reconciliation. Verified against mock HTTP servers; live rate limits unverified. |

---

### Phase 3: Financial Engine

| Task ID | Title | Tracker Status | Implemented | Synthetic-Tested | Externally-Verified | Release-Ready | Audit Finding & Status Justification |
|---|---|---|:---:|:---:|:---:|:---:|---|
| **TASK-011** | Money and dates | **In progress** | **Yes** | **Yes** | No | No | **In progress.** `money.ts` and `terms.ts` pass all 7 unit tests and 47 Genesis fixtures. Marked In progress pending formal finance reviewer sign-off on TASK-004. |
| **TASK-012** | Ledger | **Completed** | **Yes** | **Yes** | No | No | **Completed (Conditional).** Double-entry journal posting, deferred constraints enforcing balance & currency, deterministic row locking, immutable reversals. Note: Downstream from TASK-011. |
| **TASK-013** | Allocation | **Completed** | **Yes** | **Yes** | No | No | **Completed (Conditional).** Oldest-first FIFO, explicit allocation, debit 10 / payment 40 = net -30 & unapplied 30, concurrency control, allocation reversals. Note: Downstream from TASK-011/012. |
| **TASK-014** | Ageing | **Completed** | **Yes** | **Yes** | No | No | **Completed (Conditional).** 8 due-date buckets, calendar-period profile, aging snapshots, stale snapshot rejection. Tested in PGlite against parity fixtures. Note: Downstream from TASK-011. |
| **TASK-015** | Credit controls | **Completed** | **Yes** | **Yes** | No | No | **Completed.** Row-locked credit reservations, cart digest verification, manager overrides, atomic consumption on post. Physical POS integration remains Planned under TASK-003/021. |
| **TASK-016** | Application API | **Completed** | **Yes** | **Yes** | No | No | **Completed (Synthetic).** Fastify routes for accounts, payments, allocations, credit reservations, policy updates. Contract tests pass with session token verification, role permissions, and idempotency caching. |

---

### Phase 4: Shopify Web & POS Workflows

| Task ID | Title | Tracker Status | Implemented | Synthetic-Tested | Externally-Verified | Release-Ready | Audit Finding & Status Justification |
|---|---|---|:---:|:---:|:---:|:---:|---|
| **TASK-017** | Embedded web UX | **In progress** | **Yes** | **Yes** | **Partial** | No | **In progress.** Embedded routes render in DisplayDeck preview (`docs/evidence/development-store.md`). Currently operating in `demo_memory` mode without `TRADE_API_URL`. **Must not be marked complete from screenshots alone.** Real browser submission/reversal and durable API connection required. |
| **TASK-018** | Statement engine | **Completed** | **Yes** | **Yes** | No | No | **Completed (Synthetic).** Deterministic pure ISO 32000-1 PDF 1.4 binary generation, multi-page pagination (1 page for 1/10 lines, 6 pages for 200 lines), storage provider abstraction (Local, S3, GCS). Visual stakeholder inspection and production cloud storage pending. |
| **TASK-019** | Statement delivery | **In progress** | **Yes** | **Yes** | No | No | **In progress.** Two-phase dispatch (committing `sending` before remote send), stale send reconciliation, AES-256-GCM secret decryption, tenant-bound signed download URLs pass 15 integration tests. Real external email dispatch pending. |
| **TASK-020** | Account order flow | **Planned** | No | N/A | No | No | **Planned.** Correlation of reservation, draft order, and Shopify order creation without double obligations. Gated on TASK-003 and TASK-010. |
| **TASK-021** | Shopify POS UX | **Planned** | **Partial** | No | **Partial** | No | **Planned.** `extensions/trade-account` contains an offline smart-grid UI mockup. Clearly labelled as simulated. Physical iOS/Android device flow and server check remain unbuilt. |
| **TASK-022** | Settlement integrity | **Planned** | No | N/A | No | No | **Planned.** Split tender, refund mapping, and native manual payment reconciliation. |
| **TASK-023** | Native visibility | **Planned** | No | N/A | No | No | **Planned.** App-owned metafield definitions and async projections. |

---

### Phase 5: Operations, Pilot & Submission

| Task ID | Title | Tracker Status | Implemented | Synthetic-Tested | Externally-Verified | Release-Ready | Audit Finding & Status Justification |
|---|---|---|:---:|:---:|:---:|:---:|---|
| **TASK-024** | Billing | **Planned** | No | N/A | No | No | **Planned.** Shopify recurring application charges and entitlement lifecycle. |
| **TASK-025** | Privacy & uninstall | **Planned** | No | N/A | No | No | **Planned.** Mandatory compliance webhooks, customer redaction, and secret revocation. |
| **TASK-026** | Operations | **Planned** | No | N/A | No | No | **Planned.** Docker containers, compose, migrations runner, backup/restore runbooks. |
| **TASK-027** | Release validation | **Planned** | No | N/A | No | No | **Planned.** Comprehensive acceptance test suite across real environments. |
| **TASK-028** | Pilot | **Planned** | No | N/A | No | No | **Planned.** Pilot merchant recruitment and month-close reconciliation sign-off. |
| **TASK-029** | App Store | **Planned** | No | N/A | No | No | **Planned.** App Store listing, review instructions, and Shopify publication approval. |

---

### Phase 6 & 7: Roadmap Expansions (Cash Office, Pricing, Workshop, Finance)

- **TASK-030–035 (Cash Office & Pricing):** All **Planned**.
- **TASK-036–038 (Workshop & Optional Finance):** All **Planned**.

---

## 4. Unsupported Claims & Discrepancy Reconciliation

### 1. Inconsistent Dependency Chains
- **Observation:** `TASK-012`, `TASK-013`, `TASK-014`, and `TASK-016` are marked "Completed", but they depend on `TASK-011` ("Money and dates"), which is marked "In progress".
- **Reason:** The domain logic for money, dates, terms, and aging was implemented and passes all 47 parity tests. However, formal sign-off on `TASK-004` by a finance reviewer has not been completed.
- **Resolution:** Retain `TASK-012`, `TASK-013`, `TASK-014`, and `TASK-016` as Completed with an explicit recorded caveat in the tracker and plan that their financial correctness is synthetically proven but subject to final TASK-004 sign-off.

### 2. PGlite In-Memory vs. Standalone Networked PostgreSQL
- **Observation:** `TASK-007` ("Tenant database") is marked "Completed", but tests ran solely on PGlite (WASM).
- **Reason:** PGlite simulates PostgreSQL in memory. It does not prove connection pooling under `pg.Pool`, transaction ownership across concurrent socket connections, or restart persistence on disk.
- **Resolution:** Acknowledge this limitation explicitly. **TASK-040** is scheduled immediately to provide this exact external PostgreSQL proof.

### 3. DisplayDeck Screenshots vs. Workflow Acceptance
- **Observation:** The owner provided screenshots of Home, Accounts, Allocations, and Onboarding in DisplayDeck on 2026-09-29.
- **Reason:** The screens render cleanly, but the server is running in `demo_memory` mode without `TRADE_API_URL`. No financial transactions were posted or reversed in the browser session.
- **Resolution:** Maintain `TASK-017` as **In progress**. Do not claim full workflow acceptance until synthetic receipt posting and reversal are executed in the browser, followed by durable PostgreSQL execution under TASK-040.

### 4. POS Smart-Grid Simulation
- **Observation:** The POS modal in `extensions/trade-account` allows supervisor override simulation.
- **Reason:** The modal is clearly labelled as a synthetic preview. No live credit reservation or server API call occurs.
- **Resolution:** Keep `TASK-003` and `TASK-021` marked **Planned**.

---

## 5. Immediate Sequence & Next Ready Task

### Next Ready Task: **TASK-040 — Prove durable runtime and tenant concurrency**

- **Goal:** Validate the API and worker against a real, external standalone PostgreSQL instance (Docker or local service) using non-owner `app_runtime` roles, dedicated connection pinning, and connection pools.
- **Prerequisites:** 
  - `TASK-039` (Reconcile plan evidence and active handoff) — **Satisfied by this audit**.
  - `TASK-006` (Foundation) — **Satisfied**.
  - `TASK-008` (Authentication) — **Satisfied**.
  - `TASK-009` (Event reliability) — **Satisfied**.
- **Scope of Work for TASK-040:**
  1. Add an external PostgreSQL integration test profile in `tests/integration/postgres-runtime.test.ts`.
  2. Test multi-tenant isolation under concurrent load: two tenants executing simultaneous transactions across connection pool workers without context leakage or cross-tenant visibility.
  3. Validate connection release on query errors, transaction rollbacks, and simulated worker crashes.
  4. Prove schema migrations on startup and restart persistence (verifying financial records survive process reboot).
  5. Document exact startup commands and environment configurations in `docs/LOCAL-TESTING.md`.

Following TASK-040, the sequence proceeds to **TASK-041** (statement recovery with durable message log) and **TASK-042** (owner demo walkthrough).
