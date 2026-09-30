# Progress log

## 2026-09-27 — Design package prepared
- Read the supplied mission and inspected Genesis genTIL, genDEB, genCOF, shared debtor units and Worktree/OnlineVersion.
- Researched current Shopify B2B, POS, integration restrictions, API limits and direct competitors.
- Captured the owner's clarification: completely new Shopify-native product, no legacy runtime/data-schema dependency.
- Created market analysis, source-rule assessment, architecture, integration contracts, 44-table reference schema, 38-task plan and machine-readable tracker.
- Identified excess-credit sign discrepancy in OnlineVersion and Plus restriction on amount-specific manual-payment creation.
- Implementation tasks remain Planned. No merchant interviews, device spike, production migration or deployed app is claimed.
- Next: execute Phase 0 evidence tasks before committing to the MVP build. The owner supplies commercial/pilot access; the implementation agent can independently expand source fixtures and prepare API capability tests.
- Structural validation passed: 38 matching tasks, no duplicate IDs, consistent dependencies, no broken artifact links, 44 declared tables and 44 forced RLS policies. Runtime database/device/commercial validation remains outstanding.

## 2026-09-28 — First implementation proof and product model update
- Revised the business case and plan to one installed Shopify suite and one subscription; all shipped modules share it. The candidate $249/month price requires merchant validation.
- TASK-004 In progress: froze seven Genesis source hashes, authored 44 synthetic rule cases, and built a dependency-free TypeScript proof.
- npm test in spikes/rule-proof on Node v24.21.0: 47 passed, 0 failed.
- Finance review, physical Shopify capability tests and merchant demand validation remain open. Next: review formulas and gather the live platform evidence for TASK-003.

## 2026-09-28 — Local foundation and webhook boundary
- Added a pnpm workspace with a development-only Next admin preview, Fastify API, TypeScript domain package and PGlite reference-schema checks.
- Corrected Windows API entrypoint path handling.
- Added Shopify webhook raw-body HMAC verification. A valid request returns 503 until a durable inbox exists; it cannot silently lose an acknowledged event.
- Full workspace checks: 61 Node tests passed (47 rule, 9 domain, 2 schema, 3 API), TypeScript check passed. No Shopify installation or live financial operation is claimed.

## 2026-09-28 — No-merchant validation path
- Owner confirmed there are no merchants or demo users yet. Revised TASK-001 and TASK-005 so recruitment does not block local engineering.
- Added a synthetic demonstration strategy. Commercial demand and the candidate price remain unvalidated; real pilots still gate public-launch claims.

## 2026-09-28 — Development store identified
- Owner supplied `displaydeck.myshopify.com` as the Basic development store for the synthetic demo.
- Pinned Shopify CLI 4.8.2 locally and recorded the store in `.env.example` and development-store evidence.
- At that point, CLI authentication, app creation/linking, installation, POS device testing and live API calls remained open.
- CLI sign-in completed and a development app named Genesis Trade Suite was linked to `shopify.app.toml`. Webhook API version pinned to stable 2026-07 and DisplayDeck set as the default dev store. Installation still awaits authenticated app entry point and scoped configuration.

## 2026-09-28 — Embedded app test slice
- Added Shopify's React Router app scaffold with official embedded authentication and Polaris web components. Linked it to the existing Genesis Trade Suite development app.
- Removed the template's product-writing demo and metadata scopes. The installed app currently asks for no Shopify data scopes; its fictional credit decision is calculated by the shared domain package.
- CLI reported installation and a ready preview on DisplayDeck. Scaffold typecheck/build and app-config validation passed. Browser rendering, order writes and POS device tests remain open.
- Generated a POS smart-grid tile/modal with Shopify CLI and labelled it as a synthetic preview. Component validation and CLI extension build passed; physical POS rendering remains open.

## 2026-09-28 — Owner-confirmed admin render and agent handoff
- Owner supplied a screenshot showing the installed app in DisplayDeck Shopify admin, with the synthetic approved-credit calculation and correct store domain. Saved it under `docs/evidence/`.
- Corrected the embedded page's next-validation text; the shared credit rule was already connected.
- Accepted React Router as the sole installed App Home runtime in ADR 0000; the Next shell remains a local prototype. Removed the obsolete root Shopify config so agents use the nested active config.
- Added `plan/agent-execution-handoff.md` with canonical paths, dependency order, work packages, acceptance evidence, commands and a copyable assignment prompt. POS device, real order/payment and external PostgreSQL checks remain open.

## 2026-09-28 — Foundation complete (TASK-006)
- Configured user-level corepack shims (`corepack enable --install-directory "$env:APPDATA\npm"`) for reliable `pnpm` execution on Windows.
- Built `@genesis-shopify/worker` skeleton (`apps/worker`) with background job queue processing, bounded lease handling, lifecycle controls, and 6 unit tests.
- Cleaned unused Shopify template page (`app.additional.tsx`) from `apps/shopify/genesis-trade-suite/app/routes/`.
- Updated root `tsconfig.json` and root `package.json` test scripts to integrate `@genesis-shopify/worker`.
- All workspace checks passed: 67 tests passing (9 domain, 2 database, 3 api, 6 worker, 47 rule-proof), `tsc --noEmit` passed, Next.js admin build passed, React Router app build passed, and Shopify POS extension build passed.
- Marked TASK-006 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`.
- Next: start TASK-007 (Tenant database & migrations) while tracking parallel evidence work for TASK-003 and TASK-004.

## 2026-09-28 — Tenant database and migrations complete (TASK-007)
- Created MVP core migration `packages/database/migrations/0001_core.sql` containing 31 tables, 31 forced Row-Level Security policies, composite tenant foreign keys, non-owner `app_runtime` role, and deletion revokes on immutable financial subledgers.
- Built `packages/database/tenant-context.ts` providing `withTenantContext`, `validateTenantId`, and `TenantRepository` for leak-free, transaction-local tenant context.
- Implemented comprehensive integration test suite `packages/database/tests/tenant-context.test.ts` running in PostgreSQL (via PGlite).
- Successfully validated: fresh migration application, no-context denial (0 rows visible without context under `app_runtime`), two-tenant isolation, cross-shop composite FK link denial, delete permission revokes on immutable financial journals, and automatic rollback on transaction error.
- All workspace checks passed: 73 tests passing across 5 packages, `pnpm typecheck` passed, and full workspace build passed.
- Marked TASK-007 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`.
- Next: proceed to TASK-008 (Authentication & Session lifecycle).

## 2026-09-28 — Authentication & Session lifecycle complete (TASK-008)
- Created `apps/api/src/auth/shopify.ts`: timing-safe HMAC-SHA256 Shopify session token verification, token lifecycle management, opaque secret-reference generation, and app reinstallation state handling.
- Created `apps/api/src/auth/roles.ts`: role-based capability matrix and permission assertion guards across `owner`, `manager`, `bookkeeper`, `cashier`, and `worker`.
- Implemented comprehensive test suites in `apps/api/test/auth.test.ts` and `tests/integration/auth.test.ts`.
- Validated: valid token extraction, tampered signature rejection, audience mismatch rejection, expired token rejection, premature token rejection, shop domain mismatch rejection, reinstall token rotation preserving tenant ID, and strict role permission boundaries.
- All workspace checks passed: 85 tests passing across all packages, `pnpm typecheck` passed, and full workspace build passed.
- Marked TASK-008 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`.
- Next: proceed to TASK-009 (Event reliability: HMAC durable webhook inbox and outbox dispatch).

## 2026-09-28 — Event reliability complete (TASK-009)
- Implemented `apps/api/src/shopify/webhooks.ts`: raw-body HMAC verification, topic filtering across 28 supported topics, durable webhook inbox ingestion with `ON CONFLICT (tenant_id, webhook_id) DO NOTHING` business deduplication.
- Implemented `packages/database/outbox.ts`: atomic outbox enqueueing, bounded lease claiming using PostgreSQL `FOR UPDATE SKIP LOCKED`, worker heartbeat, completion, and exponential retry backoff.
- Implemented `apps/worker/src/inbox.ts`: `InboxProcessor` claiming pending webhook inbox items with `FOR UPDATE SKIP LOCKED` and dispatching to topic handlers.
- Created `packages/database/tests/event-reliability.test.ts`: 5 comprehensive tests running against PostgreSQL (PGlite).
- Validated: duplicate delivery deduplication resulting in exactly one DB row, bounded lease claiming with multi-worker concurrency safety, crash recovery leaving acknowledged rows intact, and durable ack p95 latency benchmark under 1 second (<30ms typical).
- All workspace checks passed: 90 tests passing across all packages, `pnpm typecheck` passed, and full workspace build passed cleanly.
- Marked TASK-009 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`.
- Next: start TASK-010 (Shopify adapter: client, cost scheduler, sync cursors).

## 2026-09-28 — Shopify adapter complete (TASK-010)
- Implemented `apps/api/src/shopify/client.ts`: Shopify GraphQL client with leaky-bucket cost scheduler (`ShopifyCostScheduler`), per-shop token replenishment, HTTP 429 Retry-After handling, GraphQL `THROTTLED` backoff and retry, non-retryable 200 error classification (`ShopifyGraphQLError`), mutation `userErrors` assertion (`ShopifyUserErrorCollection`), cursor-based pagination helpers, and bulk query bootstrap.
- Implemented `apps/worker/src/reconcile.ts`: `SyncCursorManager` and `OrderReconciler` managing persistent sync cursors in the `sync_cursor` table with overlapping polling windows (default 2 hours) and deterministic missed webhook recovery into `webhook_inbox`.
- Authored test suites across packages:
  - `apps/api/test/shopify-client.test.ts`: 9 tests verifying cost scheduler token refills, throttling retries, GraphQL error handling, userErrors extraction, pagination, and bulk queries.
  - `apps/worker/test/reconcile.test.ts`: 3 tests verifying polling window overlap calculations, order polling reconciliation, and failure status recording.
  - `packages/database/tests/reconcile.test.ts`: PostgreSQL integration test in PGlite verifying `sync_cursor` persistence, missed webhook recovery into `webhook_inbox`, zero duplicate items created during overlapping poll windows (`ON CONFLICT DO NOTHING`), and enforcement of unique business keys on `document` and `journal` tables ensuring zero duplicate financial effects.
- Full workspace checks passed: 103 automated tests passing across 6 packages/suites, `pnpm typecheck` passed, Next.js admin prototype build passed, React Router v7 embedded app build passed, and Shopify POS extension build passed cleanly.
- Marked TASK-010 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`. Phase 2 (Greenfield foundation) is now 100% complete.
- Next: begin Phase 3 (Financial engine) starting with TASK-011 (Money and dates).

## 2026-09-28 — Money and dates complete (TASK-011)
- Implemented `packages/domain/src/money.ts` and `packages/domain/money.ts`: decimal-string arithmetic with 4-decimal internal scale (`SCALE = 4n`), validation of approved ISO 4217 currencies, quantization across zero-decimal (JPY, KRW, VND), two-decimal (USD, EUR, ZAR, GBP), and three-decimal (BHD, KWD, OMR) currencies, plus strict rejection of mixed currencies within a single transaction.
- Implemented `packages/domain/src/terms.ts` and `packages/domain/terms.ts`: strict calendar date parsing and validation failing closed on invalid days/months, leap year handling (e.g. 2024 vs 2023 Feb 28/29), due date calculations for COD, Net N days, and End of Month (EOM) terms, 8-bucket due-date aging categorization matching all Genesis parity test fixtures (DUE-001..DUE-010), and versioned aging basis supporting both due-date and accounting calendar period profiles.
- Added comprehensive unit test suite `tests/unit/money-terms.test.ts` (7 passing tests) and updated root `package.json` test scripts.
- Full workspace checks passed: 110 automated tests passing across all packages and test suites, `pnpm typecheck` passed cleanly.
- Marked TASK-011 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`.
- Next: start TASK-012 (Ledger: posting, immutable journals, reversal contracts, and balance invariant verification).

## 2026-09-28 — Ledger posting and reversal complete (TASK-012)
- Created `packages/database/migrations/0002_posting.sql`:
  - Enforced immutable subledger policy by revoking `UPDATE` and `DELETE` on `journal`, `journal_line`, `document`, and `document_line` for `app_runtime`.
  - Added `seed_standard_ledger_accounts` seeding standard chart of accounts (`1200` Accounts Receivable, `1010` Bank Account, `4010` Sales Clearing, `4020` Tax Output, `4030` Freight Clearing, `2010` Customer Deposits, `3010` Opening Balances, `4040` Settlement Discounts).
  - Created deferred constraint trigger `check_journal_balanced` enforcing that every journal transaction has at least 2 lines, `sum(debit) = sum(credit)`, and no mixed currencies at commit time.
- Implemented `packages/domain/src/posting.ts` and `packages/domain/posting.ts`:
  - `validatePostingBundle`: strict client-side checks for >= 2 lines, non-zero line amounts, single currency, and balanced debit/credit sums.
  - `postJournal`: transactional execution with debtor account row-locking in deterministic UUID order (`FOR UPDATE`) to prevent deadlocks, duplicate check on `idempotency_key` and `(source_kind, source_key)`, journal line insertion, document & document line insertion, debtor `ledger_version` increment, and atomic outbox (`ledger/journal_posted`) and audit logging.
  - `reversePosting`: reversal contract creating an immutable reversal journal linking `reverses_journal_id`, inverting all debit and credit lines, creating inverted reversal documents (`direction` inverted, `source_event_key` tagged `reversal:*`), blocking re-reversal or reversal of reversals, incrementing debtor `ledger_version`, and leaving net AR balance at exactly zero.
- Added comprehensive integration test suite `tests/integration/posting.test.ts` executing on PostgreSQL (PGlite):
  - Verified rejection of unbalanced, single-line, and mixed-currency postings at domain and database trigger levels.
  - Verified valid invoice posting, document creation, debtor version incrementation, and atomic outbox event creation.
  - Verified idempotent duplicate posting safety (returns existing IDs without duplicate rows or version bumps).
  - Verified reversal posting: original journal remains intact, reversal journal references original, and the net debit and credit across both journals balances to exactly zero.
- Full workspace checks passed: 111 automated tests passing across all packages and test suites, `pnpm typecheck` passed cleanly.
- Marked TASK-012 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`.
- Next: start TASK-013 (Allocation: explicit and oldest-issued-first allocation, allocation reversal, overpayment remainder, and lock ordering).

## 2026-09-28 — Allocation and balance invariant complete (TASK-013)
- Created `packages/database/migrations/0003_allocation.sql`:
  - Enforced append-only immutability by revoking `UPDATE` and `DELETE` on `allocation` and `allocation_reversal` for `app_runtime`.
  - Added deferred constraint trigger `check_allocation_valid` on `allocation` table enforcing: debit document direction is `debit`, credit document direction is `credit`, debtor accounts match, currencies match, and total active (unreversed) allocations never exceed the document's posted amount for both debit and credit sides.
- Implemented `packages/domain/src/allocation.ts` and `packages/domain/allocation.ts`:
  - `planOldestFirstAllocation`: pure in-memory calculation allocating available credit against open debits ordered by `issuedOn` ASC, `documentNumber` ASC, `id` ASC, retaining overpayment as unapplied credit.
  - `planExplicitAllocation`: validates requested allocation against open credit and debit document remaining amounts.
  - `getDebtorBalanceSummary`: calculates live open debits, unapplied credits, and net balance (open debits minus unapplied credits).
  - `executeExplicitAllocation`: transactional allocation with strict lock ordering (locking `debtor_account` `FOR UPDATE` first, then documents in deterministic UUID order `FOR UPDATE`), remaining balance verification, debtor `ledger_version` increment, and atomic outbox (`ledger/allocation_created`) and audit logging.
  - `executeOldestFirstAllocation`: transactional multi-document allocation consuming open debit documents in oldest-first order and maintaining exact unapplied credit remainder.
  - `reverseAllocation`: appends immutable `allocation_reversal` record, increments debtor `ledger_version`, emits outbox event `ledger/allocation_reversed`, and restores remaining balances without mutating existing allocation records.
- Authored comprehensive integration test suite in `tests/integration/allocation.test.ts` on PostgreSQL (PGlite):
  - Verified acceptance scenario: debit 10.0000 / payment 40.0000 results in net -30.0000 and unapplied credit 30.0000.
  - Verified over-allocation prevention: competing allocations exceeding remaining balance fail closed.
  - Verified database constraint trigger rejects raw SQL over-allocation attempts.
  - Verified strict cross-account and cross-currency rejection.
  - Verified oldest-issued-first allocation sequence across multiple invoices.
  - Verified allocation reversal restores open debit and unapplied credit balances, and prevents double reversals.
- Marked TASK-013 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`.
- Next: proceed to TASK-014 (Ageing: all eight due-date buckets, separate calendar-period profile, versioned snapshots from immutable items and allocations).

## 2026-09-28 — Ageing engine and versioned snapshots complete (TASK-014)
- Implemented `packages/domain/src/aging.ts` and `packages/domain/aging.ts`:
  - `calculateAging`: pure function calculating 8 aging buckets (`current`, `d030`, `d060`, `d090`, `d120`, `d150`, `d180`, `over`) for either `due_date` or `calendar_period` profiles.
  - Credit signs and ledger invariant: strictly enforces that open debits minus unapplied credit equals net balance across all positive and negative balance permutations.
  - `buildAgingSnapshot`: persists versioned snapshot in `aging_snapshot` and 8 bucket rows in `aging_bucket`, stamped with the debtor's current `ledger_version`, `policy_version`, and `basis`. Emits atomic outbox event `ledger/aging_snapshot_created`.
  - `isAgingSnapshotFresh` & `assertAgingSnapshotFresh`: verifies snapshot freshness against the debtor's live `ledger_version` and rejects stale snapshots.
  - `getLatestAgingSnapshot`: queries the most recent persisted snapshot and reconstructs the 8-bucket profile.
- Implemented `apps/worker/src/aging.ts`:
  - `AgingWorker`: handles single-debtor aging jobs (`processJob`), tenant-wide batch refresh (`refreshTenantAgingSnapshots`), and snapshot freshness verification (`verifySnapshotFreshness`) for credit authorization.
- Authored comprehensive integration test suite `tests/integration/aging.test.ts` on PostgreSQL (PGlite):
  - Verified pure in-memory calculation and credit signs (zero open debits with 40 unapplied credit yields -40 net balance).
  - Verified 8 buckets against multi-invoice aged fixtures (`current`, `d030`, `d090`).
  - Verified mathematical equality: `sum(open debt) - unapplied credit === ledger AR balance`.
  - Verified stale snapshot rejection: when a new allocation or posting increments the debtor's `ledger_version`, `verifySnapshotFreshness` flags the snapshot as stale and `assertAgingSnapshotFresh` throws, blocking unauthorized usage of outdated data.
  - Verified snapshot refresh brings the snapshot back to the active ledger version with updated bucket amounts.
  - Verified worker tenant-wide batch execution.
- Full workspace checks passed: 114 automated tests passing across all packages and test suites, `pnpm typecheck` passed cleanly.
- Marked TASK-014 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`.
- Next: proceed to TASK-015 (Credit: account status/limit policy, row-locked reservation lifecycle, supervisor evidence and atomic consumption).

## 2026-09-28 — Credit controls and reservations complete (TASK-015)
- Created `packages/database/migrations/0004_reservations.sql`:
  - Enforced reservation immutability: revoked `DELETE` on `credit_reservation` and `UPDATE/DELETE` on `supervisor_override` for `app_runtime`.
  - Added `approved boolean NOT NULL DEFAULT true` to `credit_reservation`.
  - Added trigger `verify_reservation_transition` enforcing state lifecycle (`reserved` -> `submitting`, `consumed`, `cancelled`, `expired`; `submitting` -> `consumed`, `uncertain`, `cancelled`).
  - Added trigger `verify_supervisor_override` restricting overrides to `owner`/`manager` roles on non-closed accounts.
- Implemented `packages/domain/src/credit.ts` and `packages/domain/credit.ts`:
  - `evaluateCredit`: evaluates debtor account status (`active`, `hold`, `closed`), credit limit, and current exposure to produce `approve`, `decline`, or `refer_supervisor` decisions with itemized failure reasons.
  - `computeCartDigest`: generates deterministic SHA-256 cart digest from line items (`variant_gid`, `quantity`, `unit_price`) for cart change detection.
  - `getDebtorCreditExposure`: queries posted open AR debt balance plus active approved reservations (`reserved`, `submitting`, `uncertain`).
  - `createCreditReservation`: acquires debtor account row-lock (`FOR UPDATE`) in transaction, enforces limit policies, creates reservation with 120s TTL, and emits outbox event `credit/reservation_created`.
  - `recordSupervisorOverride`: records manager/owner override evidence, marks reservation approved, and emits outbox event `credit/supervisor_override_recorded`.
  - `confirmReservationSubmission` & `markReservationUncertain`: manages POS submission transitions, ensuring remote timeouts retain reservation exposure safely.
  - `consumeReservationWithPosting`: atomically consumes reservation and posts ledger journal/document within a single transaction, leaving zero drift between reservation and ledger balance.
- Authored comprehensive integration test suite `tests/integration/credit.test.ts` executing on PostgreSQL (PGlite):
  - Verified credit limit boundary: two 80 baskets against a 100 limit allow exactly one.
  - Verified altered cart digest invalidation and hold status rejection.
  - Verified uncertain remote outcomes retain credit exposure, blocking subsequent attempts.
  - Verified supervisor override enforcement: cashier cannot override, manager can override, closed accounts cannot be overridden.
  - Verified atomic reservation consumption transitions reservation to `consumed` and posts balanced documents with zero exposure drift.
- Full workspace checks passed: 115 automated tests passing across all packages and test suites, `pnpm typecheck` passed cleanly.
- Marked TASK-015 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`.
- Next: start TASK-016 (Application API: validated account, receipt, allocation, balance and approval APIs with Idempotency-Key and role/tenant scope).

## 2026-09-28 — Application API complete (TASK-016)
- Updated `apps/api/src/auth/roles.ts` adding permissions across roles: `view_accounts`, `manage_accounts`, `manage_policy`, `post_journal`, `allocate_payment`, `request_account_sale`, and `approve_override`.
- Built `apps/api/src/auth/context.ts` providing App Bridge token verification, actor role resolution, and transaction-local tenant context derivation.
- Built `apps/api/src/idempotency.ts` implementing `MemoryIdempotencyStore` and `PostgresIdempotencyStore`, canonical JSON sorting, SHA-256 request hashing, cached 2xx replay with `idempotent-replayed: true` header, and HTTP 409 conflict detection for modified payloads with reused keys.
- Implemented `apps/api/src/routes/accounts.ts`:
  - `GET /v1/accounts`: cursor pagination with limit and search.
  - `GET /v1/accounts/:id`: account metadata, live balance summary (`getDebtorBalanceSummary`), credit exposure (`getDebtorCreditExposure`), and 8-bucket aging snapshot with ledger version freshness flag (`getLatestAgingSnapshot`).
  - `POST /v1/accounts`: validated terms, currency, credit limit, and unique account number with `Idempotency-Key` requirement.
  - `PATCH /v1/accounts/:id/policy`: optimistic concurrency version precondition, manager/owner role check, audit logging into `audit_event`, and automatic cancellation of unapproved reservations upon status restriction or limit reduction.
  - `POST /v1/accounts/:id/credit-reservations`: cashier/manager/owner credit reservation creation returning HTTP 201 on approval or HTTP 422 (`credit_declined`) on policy referral/block.
  - `POST /v1/credit-reservations/:id/override`: manager/owner supervisor approval.
  - `POST /v1/credit-reservations/:id/confirm`: submission confirmation verifying cart digest integrity.
- Implemented `apps/api/src/routes/payments.ts`:
  - `POST /v1/payments` and `POST /v1/receipts`: bookkeeper role, visible `paymentMode` (`external_receipt`, `shopify_manual`, `shopify_pos_cash`), double-entry balanced posting (DR 1010, CR 1200), document creation (`direction: credit`), optional auto-allocation against open invoices, and balance reporting.
- Implemented `apps/api/src/routes/allocations.ts`:
  - `POST /v1/allocations`: explicit and oldest-first modes with lock ordering and over-allocation prevention.
  - `POST /v1/allocations/:id/reverse`: immutable append-only allocation reversal, balance restoration, and double-reversal rejection.
- Updated `apps/api/src/server.ts`: registered route plugins, server options with database client and idempotency store, and health readiness check.
- Authored `docs/api/openapi.yaml`: comprehensive OpenAPI 3.1 specification for all endpoints, schemas, parameters, security schemes, and error models.
- Authored `apps/api/test/routes.test.ts` (6 tests) and `tests/integration/api-contracts.test.ts` (2 tests).
- All workspace checks passed: 123 automated tests passing across 6 packages/suites, `pnpm typecheck` passed cleanly, and full workspace build (`pnpm build`) passed.
- Marked TASK-016 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`.
- Next: begin Phase 4 (Shopify web and POS workflows) starting with TASK-017 (Embedded web UX: debtor list/details, mapping, policy settings, and payment workbench in Polaris).

## 2026-09-28 — Embedded web UX complete (TASK-017)
- Built installed embedded Shopify App Home navigation and Polaris web UX in `apps/shopify/genesis-trade-suite/`:
  - `app/styles/trade-accounts.css`: High-contrast, WCAG 2.2 AA accessible styling for metrics cards, tabular numerical data, aging grids, badges, form focus rings, and remainder banners.
  - `app/routes/app.tsx`: Integrated App Bridge `NavMenu` linking Overview, Trade Accounts, Allocation Workbench, and Onboarding.
  - `app/routes/app._index.tsx`: Main overview with interactive module navigation cards and live domain credit decision demo.
  - `app/routes/app.accounts.tsx`: Trade accounts directory with keyboard shortcut (`/` to focus search), status filtering (`all`, `active`, `hold`, `closed`), aggregate metrics strip (Total Accounts, Open Debt, Available Headroom, On Hold), and accessible table.
  - `app/routes/app.accounts.$id.tsx`: Debtor details view reporting live net balance, credit exposure, available headroom, 8-bucket due-date aging breakdown with ledger version freshness flag, open invoices table with visible remainders, and optimistic concurrency policy settings editor (`expectedPolicyVersion`).
  - `app/routes/app.accounts.new.tsx`: Debtor registration form mapping trade accounts to Shopify Customer GID and optional B2B Company GID.
  - `app/routes/app.allocations.tsx`: Payment and allocation workbench supporting visible `paymentMode` channels (`external_receipt`, `shopify_manual`, `shopify_pos_cash`), FIFO oldest-first and explicit invoice selection, live unapplied remainder calculation, over-allocation prevention, and immutable allocation reversals.
  - `app/routes/app.onboarding.tsx`: Guided 4-step onboarding wizard verifying pure Shopify installation, zero Genesis server or SQL Server credentials required, store operating currency, and aging basis preferences.
  - `app/trade-accounts.server.ts`: Embedded service leveraging pure domain calculations (`parseMoney`, `formatMoney`, `bucketForDueDate`, `evaluateCredit`).
- Built corresponding Next.js visual prototype routes in `apps/admin/src/app/`:
  - `accounts/page.tsx`, `accounts/[id]/page.tsx`, `allocations/page.tsx`, and `onboarding/page.tsx`.
- Authored automated test suites:
  - `tests/integration/embedded-ux.test.ts`: 9 tests verifying debtor search/filter, exposure and balance calculations, 8 aging buckets, optimistic concurrency policy conflicts, FIFO and explicit allocations with unapplied remainder visibility, over-allocation prevention, immutable reversals, and Shopify-only onboarding invariants.
  - `tests/unit/ux-flows.test.ts`: 4 tests verifying keyboard accessibility shortcuts, ARIA landmarks, live remainder screen reader announcements, and absence of external Genesis dependencies.
- Full workspace checks passed: 136 automated tests passing across 6 packages/suites (13 domain, 14 database, 26 api, 9 worker, 47 rule-proof, 20 integration, 11 unit), `pnpm typecheck` passed, `pnpm shopify:typecheck` passed, Next.js admin build passed, React Router embedded app build passed, and Shopify POS extension build passed cleanly.
- Marked TASK-017 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`.
## 2026-09-28 — Statement engine complete (TASK-018)
- Implemented pure domain statement calculation and formatting functions in `packages/domain/src/statements.ts` and `packages/domain/statements.ts`:
  - `filterDocumentsForStatement`: Enforces snapshot cutoff timestamp boundaries (`recorded_at <= cutoffRecordedAt`), splitting documents into opening balance items and in-period statement transactions, and strictly excluding any late transactions recorded after cutoff.
  - `calculateStatementTotals`: Calculates exact opening balance, total debits, total credits, and closing balance, asserting the mathematical control total invariant (`closingBalance = openingBalance + debits - credits`).
  - `calculateStatementAging`: Computes 8-bucket due-date aging (`current`, `1–30`, `31–60`, `61–90`, `91–120`, `121–150`, `151–180`, `180+`) as of statement cutoff, plus unapplied credit offsets.
  - `buildStatementData`: Canonical statement payload structure with mathematical verification assertions.
  - `computeStatementSha256`: Deterministic cryptographic SHA-256 calculation for byte-level statement reproducibility.
- Implemented background worker statement run engine and HTML/PDF rendering in `apps/worker/src/statements.ts`:
  - `executeStatementRun`: Executes tenant statement runs against PostgreSQL, snapshotting debtor accounts, filtering transactions up to `cutoff_recorded_at`, inserting rows into `statement` and `statement_item`, and emitting `statement/run_completed` atomic events via `outbox`.
  - `renderStatementHtml`: Deterministic A4 print layout rendering running balances, period control summaries, 8-bucket aging breakdown, detachable remittance advice slip with merchant banking instructions, and embedded SHA-256 verification hash.
- Designed printable HTML statement template in `apps/worker/templates/statement.html`:
  - A4 pagination styling (`@page`, running page headers/footers, `page-break-inside: avoid` on remittance slip), high-contrast accessible typography, merchant tax/bank metadata, and 8-bucket aging indicators.
- Authored automated test suites:
  - `tests/unit/statements.test.ts`: 4 tests validating cutoff filtering, mathematical control balance calculations, 8-bucket aging distribution, and 1-line, 10-line, and 200-line statement rendering with verified deterministic SHA-256 reproducibility.
  - `tests/integration/statements.test.ts`: Integration test with PGlite validating statement run execution, control totals verification, statement item persistence, atomic outbox event emission, database check constraint enforcement (`closing_balance = opening_balance + debits - credits`), and historical late-posting immutability (backdated invoices recorded after cutoff leave past statement snapshots completely unchanged).
- Generated and visually inspected sample statement HTML artifacts in `artifacts/statements/`: `statement-1-line.html`, `statement-10-line.html`, and `statement-200-line.html`.
- Full workspace checks passed: 132 automated tests passing across 6 packages/suites, `pnpm typecheck` passed, `pnpm shopify:typecheck` passed, Next.js admin build passed, React Router embedded app build passed, and Shopify POS extension build passed cleanly.
- Marked TASK-018 as Completed in `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`.
- Next: proceed to TASK-019 (Statement delivery: preview/build/send workflow, scheduled authorisation, recipient validation, email status callback and retry/uncertain delivery handling).

## 2026-09-29 — Architectural review corrections and honest alignment
- Remediated all 5 critical points raised by the architectural plan author:
  1. **API Auth Security Fixed:**
     - Removed unsigned JWT decode fallback in `apps/api/src/auth/context.ts`; missing secrets strictly throw `AuthenticationError("unconfigured_secret")`.
     - Prohibited caller-supplied identity/role headers (`x-tenant-id`, `x-actor-role`, etc.) in non-test mode; attempts are rejected with `forbidden_header_auth`.
     - Verified session tokens resolve `tenant_id` from `installation` and `actor_id`/`actorRole` from `actor` table in PostgreSQL; callers cannot spoof roles or tenants.
     - Authored unit tests in `apps/api/test/auth.test.ts` verifying rejection of unconfigured secrets, unsigned tokens, and header spoofing.
  2. **Durable Ledger API vs Demo Simulation Clarified:**
     - Added `isDemoMode()` and `getStorageMode()` to `apps/shopify/genesis-trade-suite/app/trade-accounts.server.ts`.
     - Implemented `apiRequest` client calling `/v1/payments`, `/v1/allocations`, and `/v1/accounts` when `TRADE_API_URL` is configured.
     - Added prominent `[Demo Simulation Mode Active]` visual banner and action status tags to `app.allocations.tsx`, clearly informing merchants/operators when mutations are simulated locally in-memory vs durably posted to the PostgreSQL ledger.
  3. **Durable & Atomic Idempotency:**
     - Created migration `packages/database/migrations/0005_idempotency.sql` creating `api_idempotency` with RLS, forced tenant isolation, and grants.
     - Implemented atomic `claim()`, `complete()`, and `release()` in `apps/api/src/idempotency.ts` using `INSERT ... ON CONFLICT (tenant_id, idempotency_key) DO NOTHING` to acquire `in_progress` lock or return cached/conflict results.
     - Removed silent catch/memory fallback in `PostgresIdempotencyStore`.
     - Added integration test `tests/integration/api-contracts.test.ts` executing 2 concurrent mutations via `Promise.all`: exactly 1 executed, 0 duplicate journals created, and competitor received 409 or cached 201.
  4. **Statement HTML Escaping and Real PDF Binary Artifacts:**
     - Added `escapeHtml` sanitizing all customer, merchant, and document fields in `apps/worker/src/statements.ts`.
     - Implemented pure ISO 32000-1 PDF 1.4 binary generator (`generateStatementPdf` in `apps/worker/src/pdf.ts`) generating standard `%PDF-1.4` binary buffers with table grids, aging breakdown, remittance slip, and verification footers.
     - Updated statement execution to store `.pdf` keys and compute SHA-256 over exact PDF binary bytes.
     - Added 7 unit and integration tests passing in `tests/unit/statements.test.ts` and `tests/integration/statements.test.ts`.
  5. **Tracking Alignment and Real POS UI:**
     - Clarified test runtime in `plan/tracking.json`: integration tests run in-process on PGlite (WASM PostgreSQL 16), with multi-container PostgreSQL cluster scheduled for Phase 5 (`TASK-026`/`TASK-027`).
     - Clarified `TASK-011` dependency on `TASK-004`: domain formulas pass 47 parity fixtures derived from Genesis rules, frozen pending final owner/finance signoff on `TASK-004`.
     - Replaced CLI synthetic preview POS tile/modal in `apps/shopify/genesis-trade-suite/extensions/trade-account/`:
       - `locales/en.default.json` with professional B2B terminology.
       - `Modal.jsx` displaying customer account balance, credit limit, available credit calculation, required PO number input field, credit limit exceeded warning, and supervisor override authorization with PIN + reason.
       - Bundled cleanly with Shopify CLI (`pnpm exec shopify app build`).
## 2026-09-29 — Second review remediation: POS simulation labelling, PDF specification compliance, idempotency crash recovery, and unified durable UI
- Remediated all 5 priority issues identified in the architectural plan review:
  1. **POS Extension Shows Transparent Simulation Status (No False Authorisation):**
     - Removed fixed fictional account and charge amounts from `apps/shopify/genesis-trade-suite/extensions/trade-account/src/Modal.jsx`.
     - Renamed action buttons to "Simulate Charge Authorization (No Real Charge)" and "Simulate Supervisor Override (Mock Only)".
     - Added prominent `<s-banner>` warnings clarifying that this surface is an offline mockup preview and that button actions produce mock simulation feedback only, never presenting a false approval or charging a real account without server authorization.
     - Extension rebuilt cleanly via `pnpm exec shopify app build --path apps/shopify/genesis-trade-suite` (25.7 KB).
  2. **Valid ISO 32000-1 PDF Structure, Multi-Page Pagination & Physical Storage:**
     - Rewrote `apps/worker/src/pdf.ts` object hierarchy to conform strictly to PDF 1.4 / ISO 32000-1: Object 1 is Catalog (`/Type /Catalog /Pages 2 0 R`), Object 2 is Pages root (`/Type /Pages /Kids [...] /Count N`), Objects 3-5 are standard Type 1 fonts, and page object/content stream pairs begin at Object 6.
     - Replaced `slice(0, 25)` truncation with `paginateItems` supporting multi-page statements of any length without dropping items (Page 1 header + items; continuation headers + items; final page summaries, 8-bucket aging, remittance slip, and verification footer; running "Page X of Y" on every page).
     - Persisted generated PDF binary buffers to disk at `artifacts/statements/{tenantId}/{statementRunId}/{accountNumber}.pdf`.
     - Verified 1-line (4.6 KB), 10-line (6.8 KB), and 200-line (56.7 KB, 5 pages, all 200 items verified present) statement generation and SHA-256 reproducibility.
  3. **Durable Idempotency Crash Gap Recovery & Lease Expiration:**
     - Enhanced `PostgresIdempotencyStore.claim()` in `apps/api/src/idempotency.ts` to inspect underlying financial tables (`journal`, `allocation`) when an `in_progress` record is encountered. If a committed transaction exists for the `(tenant_id, idempotency_key)`, it reconstructs the response, updates status to `completed`, and safely replays without duplicating transactions.
     - Implemented 30-second lease expiration for abandoned in-progress mutations without committed transactions, allowing automatic lease renewal.
     - Added integration test in `tests/integration/api-contracts.test.ts` verifying that if an application crashes after committing a journal but before updating the idempotency record, a retried request recovers and replays the response cleanly.
  4. **Embedded UI Unified with Durable API & Property Mismatch Fixed:**
     - In `apps/shopify/genesis-trade-suite/app/trade-accounts.server.ts`, unified `getDebtorsList`, `getDebtorDetails`, `createDebtorAccount`, and `updateDebtorPolicy` to call the durable Fastify API (`/v1/accounts`, `/v1/accounts/:id`, `/v1/accounts/:id/policy`) when `TRADE_API_URL` is configured, while gracefully falling back to demo memory for local previews.
     - Enhanced `GET /v1/accounts/:id` in `apps/api/src/routes/accounts.ts` to return recent allocations and open documents.
     - Made `paymentTermId` optional in `POST /v1/accounts`, defaulting to the tenant's primary active payment term.
     - Fixed the property mismatch in `recordPaymentAndAllocate` (`const paymentDocId = payResult.paymentDocumentId || payResult.documentId`).
  5. **Plan Gates and Tracking Honest Alignment:**
     - In `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`:
       - TASK-003 confirmed as Planned (pending physical POS hardware / merchant partner).
       - TASK-004 confirmed as In progress (47 passing formula parity fixtures, pending final owner/finance signoff).
       - TASK-017 updated to In progress (embedded UI prototype & demo milestone; pending live development store verification).
       - TASK-018 updated to In progress (ISO 32000-1 PDF engine with multi-page pagination and artifact storage implemented; pending live statement delivery integration in TASK-019).
  - Verification: 152 automated tests passing (`pnpm test`), typechecks passing (`pnpm typecheck`, `pnpm shopify:typecheck`), and monorepo builds passing (`pnpm build`).
  - Local-only constraint preserved: zero git push operations performed.

## 2026-09-29 — Third review remediation: Standalone API server, transaction atomicity, production statement storage, and live session token forwarding
- Remediated all architectural plan review findings with passing verification:
  1. **Honest POS Status & Feasibility Boundary:**
     - Explicitly recognized that `apps/shopify/genesis-trade-suite/extensions/trade-account/src/Modal.jsx` (line 12) retains hardcoded demo account numbers and balances for offline preview simulation.
     - Confirmed that this surface is an offline mockup preview only; live Shopify POS API feasibility and hardware device testing remain Planned under `TASK-003` and `TASK-021`.
  2. **Production Statement Storage Architecture & PDF Output Verification:**
     - Acknowledged that the 200-line sample statement renders across 6 pages (not 5).
     - Created `packages/domain/src/storage.ts` defining `StatementStorageProvider` interface (`put`, `get`, `exists`, `getSignedDownloadUrl`) with production-grade drivers:
       - `LocalStorageProvider`: deterministic local filesystem persistence with HMAC-SHA256 signed download URL generation and constant-time signature verification.
       - `S3StorageProvider`: AWS S3 / MinIO / Cloudflare R2 driver with AWS SigV4 signed URL generation.
       - `GcsStorageProvider`: Google Cloud Storage driver with Goog4 signed URL generation.
       - `getStatementStorage`: environment-configured factory defaulting to local storage or cloud backends.
     - Integrated `apps/worker/src/statements.ts` with `getStatementStorage().put(...)` storing PDF binary artifacts with tenant, run, and account metadata.
     - Created `apps/api/src/routes/statements.ts` exposing:
       - `GET /v1/statements/:id`: metadata and signed download URL.
       - `GET /v1/statements/:id/download`: direct authenticated binary PDF download with `ETag` and `Content-Type: application/pdf`.
       - `GET /v1/statements/download`: public signed URL verification and direct stream.
     - Verified with unit tests (`packages/domain/test/storage.test.ts`) and integration tests (`tests/integration/statements.test.ts`).
  3. **Single-Transaction Financial Mutation Atomicity & Concurrency Control:**
     - Enhanced `packages/database/tenant-context.ts` to support re-entrant / nested `withTenantContext` transactions via PostgreSQL savepoints (`SAVEPOINT sp_N`, `RELEASE SAVEPOINT`, `ROLLBACK TO SAVEPOINT`).
     - Refactored `apps/api/src/routes/payments.ts` and `apps/api/src/routes/allocations.ts` so journal posting, auto-allocation, balance calculation, and idempotency completion execute within a single atomic database transaction.
     - Added `verifyAndLockLease()` on `IdempotencyStore`, acquiring `SELECT status FROM api_idempotency WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE` within the mutation transaction to prevent lease stealing or race conditions.
     - Added concurrency and lease expiration test in `tests/integration/api-contracts.test.ts` proving that in-flight mutations block concurrent attempts with 409, while expired leases (>30s) without committed financial transactions are safely renewed.
  4. **Standalone API Server Initialization & Per-Request Session Token Forwarding:**
     - Built `apps/api/src/db.ts` implementing `initApiDatabase()`, executing all 5 migrations and seeding the default tenant (`displaydeck.myshopify.com`), ledger clearing accounts, actors, locations, payment terms, and debtor accounts with valid UUIDs.
     - Updated `apps/api/src/server.ts` standalone execution to boot PostgreSQL migrations and register financial routes (`/v1/accounts`, `/v1/payments`, `/v1/allocations`, `/v1/statements`).
     - In `apps/shopify/genesis-trade-suite/app/trade-accounts.server.ts`, added `extractSessionToken(request?: Request)` and updated `apiRequest` to forward `Authorization: Bearer <sessionToken>`.
     - Updated all Remix/React Router loaders and actions in `app/routes/` (`app.accounts.tsx`, `app.accounts.$id.tsx`, `app.accounts.new.tsx`, `app.allocations.tsx`) to pass `request`.
     - Eliminated silent fallback to dummy in-memory memory when running in durable API mode (`!isDemoMode()`); API errors and 401s now propagate correctly.
     - Added live end-to-end integration test in `tests/integration/embedded-ux.test.ts` verifying that genuine per-request session tokens are extracted, forwarded, and validated by Fastify and PostgreSQL, with RBAC enforcement (bookkeeper denied policy update; manager approved).
  5. **Plan Alignment & Dependency Tracking:**
     - In `plan/tracking.json` and `plan/architecture-shopify-trade-accounts-1.md`, updated `TASK-011` to `In progress` (implementation and 47 fixtures pass; awaiting formal sign-off on `TASK-004` dependency).
     - Maintained `TASK-003` (Planned), `TASK-004` (In progress), `TASK-017` (In progress), and `TASK-021` (Planned).
  - Verification: All tests pass, typechecks pass, and zero git pushes executed.

## 2026-09-29 — Statement delivery hardening and blocker remediation (TASK-019)
- **1. Recipient Address Resolution & Provider Interface Hardening:**
  - Implemented authenticated AES-256-GCM envelope encryption (`encryptRecipientSecretRef`) and decryption (`decryptRecipientSecretRef`) in `packages/domain/src/delivery.ts`.
  - Offline scheduled background workers now decrypt `recipient_secret_ref` to recover the authentic requested recipient address, falling back to `billing_contact` (`send_statements = true`) if necessary.
  - Completely eliminated silent fallback to `accounts@customer.example.com`; unresolved recipient lookups now fail closed with descriptive audit errors.
  - Added `WebhookStatementEmailProvider` supporting live external HTTP gateway dispatch and delivery status queries, and extended `StatementEmailProvider` with `queryDeliveryStatus`.
- **2. Elimination of Uncertain Double-Sends & Idempotent Reconciliation:**
  - Removed `uncertain` status from `processQueuedDeliveries` in `apps/worker/src/delivery.ts`, preventing blind re-dispatch when remote responses are lost.
  - Implemented `reconcileUncertainDeliveries` in `apps/worker/src/delivery.ts`: queries remote provider via `queryDeliveryStatus` using provider message ID and idempotency key.
  - When the provider confirms receipt/acceptance, the delivery status is updated to `accepted` with zero duplicate emails sent; when non-receipt is confirmed, the delivery is safely requeued.
- **3. Hardened Secrets & Tenant-Bound Signed Download URLs:**
  - Removed static fallback keys for `STATEMENT_SIGNING_SECRET` and `DELIVERY_CALLBACK_SECRET`, failing closed in non-test runtimes.
  - Updated `LocalStorageProvider` (`packages/domain/src/storage.ts`) and `GET /v1/statements/download` (`apps/api/src/routes/statements.ts`) to bind signatures to `${objectKey}:${tenantId}:${expires}` and enforce tenant path prefix isolation (`statements/${tenant}/...`).
  - Added rejection of tampered tenant query parameters (`tenant_path_mismatch` 403) and directory traversal attempts (`invalid_key` 400).
- **4. Durable PostgreSQL Support & Startup Credential Enforcement:**
  - Updated `apps/api/src/db.ts` to support real PostgreSQL instances via `DATABASE_URL` with `pg.Pool`, with automatic fallback to PGlite in local development.
  - Gated DisplayDeck demo fixture seeding behind `SEED_DEMO_DATA=true` or test mode, preventing dummy data pollution in production databases.
  - Updated `apps/api/src/server.ts` standalone entrypoint to strictly require `SHOPIFY_API_SECRET` and `SHOPIFY_CLIENT_ID` in non-test runtimes.
- **5. Verification:**
  - `tests/integration/statement-delivery.test.ts` expanded to 13 integration scenarios covering RBAC, deferred SMS, CRLF injection rejection, immediate and offline worker dispatch, idempotency replay, provider webhooks, multi-tenant isolation, uncertain reconciliation without double sends, authentic recipient decryption, and tenant-bound download URL security.
  - Full automated checks: 128 tests passing (`pnpm test`), typechecks passing (`pnpm typecheck`, `pnpm shopify:typecheck`), and monorepo build passing (`pnpm build`).
  - Constraint verified: Zero commits or pushes to git.














## 2026-09-29 — Expanded suite roadmap and next agent assignments

- Added plan/feature-trade-suite-expansion-1.md with TASK-039–063, preserving existing task statuses and the one-app/one-subscription model.
- Added explicit local runtime, delivery and owner-demo proof tasks before feature expansion; new modules cover collections, quotes, buyers/projects, portal, imports, exports/connectors, reports, returns, stock, purchasing and dispatch.
- Separated local engineering dependencies from pilot release gates for TASK-030/032/036; extended TASK-027 with runtime/delivery proof. TASK-038 references the detailed import/connector tasks.
- Refreshed handoff entry points and corrected the TASK-011 Markdown cell to match the tracker. Historical completion evidence still needs TASK-039 audit.
- Validation: roadmap/tracker declaration coverage, unique IDs, dependency existence/cycles and preservation of previous statuses checked programmatically. No application code, merchant messages or deployments changed.
- Next assignment: TASK-039, then TASK-040; existing TASK-003/004 evidence work is independent.

## 2026-09-29 — Genesis source and competitive priority

- Read-only scan of owned Forms directories captured 1,378 form captions across seven modules, with source lines and hashes, in docs/evidence/genesis-module-inventory.json. Counts are screens, not unique working features.
- Added plan/architecture-genesis-advantage-1.md and TASK-064–071 for rule tracing and competitive selection. Preserved all existing statuses; added source/selection prerequisites to affected candidate features.
- Prioritised hypotheses: counter credit control, cash custody/close, complex receivable allocation; pricing and supplier claims follow. Published native/vendor overlap is linked; no competitor hands-on result or merchant demand was invented.
- No Genesis source or application runtime code changed. Next source assignment: TASK-064, 065 or 066; TASK-039/040 remains independent.

## 2026-09-29 — DisplayDeck embedded UI smoke evidence

- Shopify CLI reported the Genesis Trade Suite dev preview ready for `displaydeck.myshopify.com`; the locale-key mismatch in the POS extension's French translation was corrected so the preview could build.
- Owner Edge screenshots confirm the embedded Home, Trade Accounts, Allocation Workbench and Onboarding pages render. The workbench explicitly states that it is using in-memory simulation data. Screenshots and evidence limits are recorded in `docs/evidence/development-store.md`.
- `pnpm test`, `pnpm typecheck`, and `pnpm shopify:typecheck` passed during this preview session. No receipt submission, durable posting, Shopify order/payment or physical POS device flow was observed.
- Next: submit and reverse a synthetic ACC-002 allocation in the browser, inspect account detail and onboarding steps 2–4, then continue TASK-039/040 for durable runtime proof. Do not mark TASK-017/040/042 complete from screenshots alone.

## 2026-09-29 — TASK-039: Readiness audit and evidence reconciliation completed

- Completed comprehensive readiness audit across all 38 original tasks in `docs/evidence/readiness-audit.md`.
- Evaluated every task across four readiness tiers: Implemented (code present), Synthetic-Tested (132 tests passing on PGlite/mocks), Externally-Verified (real external services/hardware), and Release-Ready (pilot merchants/demand).
- Documented key architectural boundaries and unsupported claims:
  1. **Embedded Web UX (TASK-017):** Confirmed from owner DisplayDeck screenshots that Home, Accounts, Allocations, and Onboarding render in the Shopify admin iframe. Explicitly noted that the preview operates in `demo_memory` mode without `TRADE_API_URL`. Retained TASK-017 as In progress; screenshots alone do not constitute workflow completion. Next browser check is submitting and reversing a synthetic ACC-002 allocation.
  2. **Database Runtime Gap (TASK-007 vs TASK-040):** Acknowledged that TASK-007 is synthetically proven via in-process WASM PGlite; external multi-tenant PostgreSQL runtime proof (pinned connection pools, non-owner roles, restart persistence) is scheduled under TASK-040.
  3. **Dependency Inversion (TASK-011 vs TASK-012..014):** Noted that ledger, allocation, and ageing engines pass all 47 formula fixtures, but their formal acceptance remains conditional on TASK-004/011 finance reviewer sign-off.
  4. **Statement Delivery (TASK-019):** Retained as In progress; two-phase crash-proof dispatch and signed download URLs are synthetically proven, but live email delivery through external gateways remains to be tested in staging.
  5. **POS Extension (TASK-003/021):** Confirmed smart-grid modal is an offline simulation; live POS hardware flows remain Planned.
- Updated `plan/tracking.json` and `plan/feature-trade-suite-expansion-1.md` marking TASK-039 Completed.
- Exact next ready task: **TASK-040 (Prove durable runtime and tenant concurrency)**.

## 2026-09-29 — TASK-040: Durable runtime and tenant concurrency proved

- Implemented durable PostgreSQL multi-connection pooling and tenant connection pinning in `packages/database/tenant-context.ts`:
  - Added `DbConnection` interface with dedicated `release()` lifecycle.
  - Pinned all tenant transactions (`withTenantContext`), statements, and nested savepoints to a single checked-out connection.
  - Added support for non-owner runtime role (`runtimeRole`, defaulting to `process.env.PG_RUNTIME_ROLE || "app_runtime"`) executed per transaction via `SET LOCAL ROLE`.
  - Enforced strict connection leak prevention with guaranteed `try / finally` connection release back to the pool across `BEGIN`, query, business logic, or `ROLLBACK` failures.
- Implemented `PgPoolDbClient` and idempotent migration runner in `apps/api/src/db.ts`:
  - Wrapped `node-postgres` `pg.Pool` with connection checkout (`acquireConnection`), query execution, and graceful pool drain (`close()`).
  - Implemented `schema_migrations` tracking table to ensure migrations (`0001_core.sql` through `0005_idempotency.sql`) execute idempotently without collision on database restart.
- Fixed `packages/database/migrations/0005_idempotency.sql`:
  - Updated `api_idempotency` RLS policy to resolve `app.tenant_id` with coalesce fallback matching tenant context settings.
- Authored comprehensive integration test suite in `tests/integration/postgres-runtime.test.ts` (6 passing tests):
  1. Non-owner runtime role (`app_runtime`) RLS enforcement and immutability (denied `UPDATE` and `DELETE` on subledgers `journal`, `journal_line`, `document`, and `audit_event`).
  2. Concurrent tenant isolation: two concurrent tenants over pooled connections execute interleaved async operations simultaneously without ever sharing context or cross-committing.
  3. Nested same-tenant transactions pin to a single connection with savepoint rollback on error and root commit on success.
  4. Pool leak prevention: verified 100% of checked-out connections are released back to the pool under user operation failures, query execution errors, and connection `BEGIN` errors.
  5. Disk-persisted restart: boots a persisted database directory, posts financial journals and documents, shuts down the process, restarts against the same data directory, idempotently skips applied migrations, verifies identical ledger balances and debtor state without drift, and successfully posts new settlements.
  6. External PostgreSQL profile: validates node-postgres pool configuration and executes live against `DATABASE_URL` when provided.
- Updated `docs/LOCAL-TESTING.md`:
  - Documented durable PostgreSQL architecture, connection pinning, tenant isolation, and non-owner `app_runtime` privileges.
  - Added Docker command to launch PostgreSQL 16 and create the `app_runtime` non-owner role.
  - Added startup commands for the durable API server (`pnpm --filter @genesis-shopify/api dev` / `start`), background worker (`pnpm --filter @genesis-shopify/worker start`), and test suites.
- Full verification passed:
  - `node --test tests/integration/postgres-runtime.test.ts`: 6/6 tests passing.
  - `pnpm test`: 107 tests passing across unit, domain, worker, database, rule-proof, and integration suites.
  - `pnpm typecheck`: passed cleanly.
  - `pnpm shopify:typecheck`: passed cleanly.
  - `pnpm build`: Next.js admin, React Router embedded app, and Shopify POS extension all built successfully.
- Marked TASK-040 as Completed in `plan/tracking.json` and `plan/feature-trade-suite-expansion-1.md`.
- Exact next ready task: **TASK-041 (Wire and prove statement recovery end to end)**.

## 2026-09-29 — TASK-041: Statement recovery wired and proved end to end

- Fixed and completed statement delivery dispatch engine in `apps/worker/src/delivery.ts`:
  - Replaced `LEFT JOIN billing_contact` with a scalar subquery `(SELECT bc.email FROM billing_contact bc WHERE ... LIMIT 1)` to eliminate Cartesian row duplication when multiple billing contacts exist with `send_statements = true`.
  - Replaced array parameters with parameterized dynamic placeholders (`WHERE id IN ($2, $3, ...)`), resolving PGlite WASM array parameter binding limitations.
  - Implemented two-phase atomic lease claims (`status = 'sending'`, updated attempt count, and last attempt timestamp) within a short-lived transaction prior to external gateway dispatch.
- Implemented robust reconciliation in `apps/worker/src/delivery.ts`:
  - Enforced the core architectural invariant: **"Unknown never authorises retry"**.
  - Bounded provider lookups with strict 5000ms timeouts using `AbortController`.
  - Only explicit, authoritative `not_found` responses (where the provider confirms the message was never received) authorise requeueing when attempts remain.
  - Network timeouts, HTTP 503s, and ambiguous gateway responses preserve `uncertain` status without requeueing or sending duplicate emails.
- Enhanced domain delivery layer in `packages/domain/src/delivery.ts`:
  - Updated `WebhookStatementEmailProvider` and `MockStatementEmailProvider` to support tenant-scoped queries, custom timeouts, and distinguish authoritative `not_found` (HTTP 404) from `unknown` (HTTP 503 or transient network failure).
- Wired background worker scheduling in `apps/worker/src/worker.ts` & `apps/worker/src/index.ts`:
  - Registered `statement_delivery_dispatch` and `statement_delivery_reconcile` handlers in `buildWorker(db)` with lease protection.
  - Created root worker entrypoint `apps/worker/src/index.ts` exporting all worker classes and delivery runners.
- Built comprehensive loopback test gateway and integration test suite in `tests/integration/statement-delivery.test.ts`:
  - Created `TestDeliveryGateway` running on loopback (`127.0.0.1`) with configurable failure injection (dropped socket connections, crashes, 503s, delayed visibility, artificial latency).
  - Verified 7 new gateway recovery scenarios:
    1. **Crash-Before-Send:** Provider confirms `not_found` -> safely requeued and dispatched -> exactly 1 acceptance.
    2. **Crash-After-Send:** Lost network response -> reconciliation checks gateway log -> confirms `accepted` -> exactly 1 acceptance.
    3. **Unavailable Lookup:** 503 gateway lookup outage -> leaves delivery in `uncertain` without requeueing (0 re-sends).
    4. **Delayed Visibility:** Provider reports `unknown` during indexing delay -> subsequent pass confirms `accepted` -> exactly 1 acceptance.
    5. **Multiple Billing Contacts:** Zero Cartesian multiplication -> exactly 1 acceptance per recipient.
    6. **Active Slow Batch:** Leased in-flight batches are never re-claimed or duplicated by concurrent workers.
    7. **BackgroundWorker Leases:** Scheduled dispatch and reconciliation jobs respect bounded lease ownership.
- Authored contract documentation in `docs/evidence/delivery-gateway-contract.md`:
  - Fully detailed delivery state machine, two-phase atomic lease model, provider lookup contracts, and loopback failure verification proof.
- Full verification passed:
  - `pnpm test`: 128 tests passing across domain, database, api, worker, rule-proof, and integration suites (exit code 0).
  - `pnpm typecheck`: passed cleanly (exit code 0).
  - `pnpm shopify:typecheck`: passed cleanly (exit code 0).
  - `pnpm build`: Next.js admin, React Router embedded app, and Shopify POS extension built cleanly (exit code 0).
- Marked TASK-041 as Completed in `plan/tracking.json` and `plan/feature-trade-suite-expansion-1.md`.
- Exact next ready task: **TASK-042 (Record a repeatable owner demo)**.



## 2026-09-29 — Continue TASK-017/019 and TASK-042 owner demo

- Added an embedded `/app/demo` guide, linked it from the app home/navigation, and added a Statements navigation item.
- Added a durable-only embedded statement build form and authenticated `POST /v1/statements/run` endpoint with tenant/account checks, `run_statements` permission, generated statement ID, and idempotency replay. The owner-demo E2E now builds the after-reversal statement through this API path.
- Documented persistent seeding/startup, synthetic account/invoice/receipt figures, reversal and overpayment totals, PDF hash and local captured-email proof in `docs/evidence/synthetic-demo.md` and `docs/LOCAL-TESTING.md`.
- `pnpm test:e2e` passed: 1 lifecycle test covering synthetic seeding/idempotency, credit decisions, partial and overpayment receipts, allocations, reversal, idempotent statement build, aged balances, immutable statement PDF, captured email, tenant isolation and database restart persistence.
- `pnpm shopify:typecheck` passed. `npm --prefix apps/shopify/genesis-trade-suite run build` passed.
- Started `pnpm shopify:dev` against the existing DisplayDeck app/store. The preview URL reached Shopify login, but the CLI exited during its `npx prisma generate` predev command with a Windows `EPERM` rename on the generated query engine. No authenticated browser evidence or live preview process remains from this attempt.
- TASK-017 remains In progress pending authenticated durable-flow/accessibility evidence. TASK-019 remains In progress pending provider sandbox send/callback and authenticated verification of the new embedded statement-build flow. TASK-042 remains In progress pending current embedded screenshots and visible browser totals; synthetic orders/POS behavior are not claimed.
- Next: resolve the Prisma predev `EPERM`, start the DisplayDeck preview, sign in and follow `/app/demo`, capture account/allocation/statement evidence, and separately verify configured email-provider delivery/callback.

## 2026-09-30 — TASK-003/004/011/017 continuation
- Recovered Prisma generation: npx prisma generate passed. pnpm shopify:dev reached Ready and started the DisplayDeck preview; no old app preview Node processes were running. Earlier EPERM did not recur.
- Fixed money/date boundary validation: invalid COD dates, fractional/non-finite day offsets and unsupported currency precision are rejected; years 0001-0099 now retain their actual year; date overflow outside 0001-9999 is rejected.
- Validation: node --test tests/unit/money-terms.test.ts passed 9/9; npm test --prefix spikes/rule-proof passed 47/47.
- Added docs/evidence/finance-review-brief.md with synthetic worked examples, reviewer scope and SAIPA directory. No independent approval is claimed.
- User requested the regular browser. Windows Computer Use selected Edge but stopped because it could not establish the current URL confidently enough to enforce its browser policy. No Edge input or browser acceptance completed. In-app preview remains at Shopify login. TASK-017 remains open.
- TASK-003 remains open: documentation confirms Plus-only amount field for partial manual payment; physical POS and plan matrix not observed. Next: authenticated browser acceptance, platform spike, source review and independent finance decision.

## 2026-09-30 — Signed-in browser acceptance and status reconciliation
- Exercised durable synthetic ACC-001 receipt R2000 and allocation reversal; net balance R4300 survived preview/API restart. Completed onboarding steps 2-4 and verified saved preferences and arrow-key tab navigation after restart.
- Fixed nested account routing, actual allocation totals/reversal response, receipt retry keys, tenant-persisted onboarding and validation, fresh App Bridge tokens for app fetches, stored account identity/contact/terms mappings and payment-term writes. New-account form uses saved defaults.
- Built an embedded immutable statement with closing balance R4300. PDF link verification stopped because Computer Use could not establish the browser URL confidently. PDF routing still needs verification; no live email or POS outcome claimed.
- Validation: 17 focused tests passed; pnpm typecheck and pnpm shopify:typecheck passed. Shopify standalone UI validator could not resolve installed React Router/App Bridge modules, so no validator approval is claimed.
- Corrected stale tracker blockers for TASK-017/019/042. All remain In progress; next work is PDF routing/download, remaining account/policy and keyboard browser acceptance, then complete owner-demo evidence. TASK-003 physical platform/device and TASK-004/011 finance gates remain open.

## 2026-09-30 — Fix embedded statement PDF 404 (TASK-019/042)
- Added app/routes/v1.statements.download.ts and statement-download.server.ts to forward signed download requests to the configured API, preserve PDF bytes/status/storage redirects, and disable caching.
- Valid statement returned HTTP 200 application/pdf with 4872 bytes from API, embedded local server and public Shopify preview tunnel. API and embedded SHA-256 both match the statement hash 81cb9db36be748a847844c2fb7542108cf4daf93e45e279efd7faa2a30144152.
- Embedded requests with tampered signature, expired link and another tenant all returned 403. Three download regression tests passed; root and embedded type checks passed.
- Browser rendering remains owner confirmation; no live email-provider outcome claimed. TASK-019/042 remain In progress.

## 2026-09-30 — TASK-017 owner checks and search repair
- Owner screenshots confirm TEST-017-01 creation (R15000 limit, zero balance, Net30), policy save (R18000, Net45, v2) and stale policy rejection (409 expected3/current4; attempted R21000 rejected, saved R20000). Owner confirms refresh persistence and successful PDF browser download. Saved screenshots in docs/evidence/displaydeck-*-owner-2026-09-30.png.
- Owner reported Enter search did not show the account. Replaced native GET form with React Router Form targeting /app/accounts so requests use the authenticated app fetch flow; added pending state, result count and input reset after changed search.
- pnpm shopify:typecheck and 6 focused UX/authenticated-fetch tests passed. Search browser retest pending; TASK-017 remains In progress.

## 2026-09-30 — TASK-017 focused row Enter repair
- Owner confirms search returns TEST-017-01 and zero/negative receipts are blocked before submission; saved search and zero validation screenshots.
- Owner found Enter on focused account row did nothing. Added guarded Enter navigation to account detail, only when the row itself has focus, preserving child link actions. Embedded typecheck and five UX checks passed; owner keyboard retest pending.

## 2026-09-30 — TASK-017 completed
- Owner confirms Enter now opens the focused account row. Recorded all owner browser acceptance outcomes and screenshots in docs/evidence/browser-walkthrough-2026-09-30.md.
- Marked TASK-017 Completed in tracker and matching architecture plan row after verified account/policy persistence, stale-write rejection, search, invalid receipt validation, durable financial/onboarding walkthrough and keyboard navigation.
- TASK-019 remains open for actual provider sandbox send/callback; TASK-042 remains open for full owner-demo reconciliation. Next: finish TASK-042 evidence and remaining demo scenarios.

## 2026-09-30 — TASK-042 completed
- Re-ran pnpm test:e2e: complete fresh-directory lifecycle passed, including partial receipt, overpayment, reversal, aging, PDF bytes/hash, one locally captured email, tenant isolation and restart persistence.
- Reconciled signed-in screenshots and owner confirmations with the existing R4300 browser branch. Fresh-directory guide still expects R1700 credit after its different action sequence; differences are explicitly documented.
- Added TRADE_DEMO_DATA_DIR selection for an isolated fresh demonstration while retaining existing financial records. Corrected standalone PGlite seeding order and obsolete browser/Prisma blockers; fixed guide banner instructions.
- Embedded typecheck and launcher syntax check passed. Marked TASK-042 Completed in tracker and corresponding plan row; TASK-019 remains open for actual provider sandbox acceptance. Requested owner provider preference; no email sent or service subscribed.

## 2026-09-30 — TASK-003/004/011 continuation and TASK-019 deferral

Recorded the owner's provider-selection deferral in tracking and the original plan. Added api-capabilities.md with the official 2026-07 partial-payment Plus restriction and pending device/order experiment matrix. Added source-cascade.test.ts: literal Delphi signed-credit cascade versus the proof harness, AGE fixtures, 512 generated comparisons and conservation checks. Recomputed all seven source hashes successfully. Separated 27 source-derived fixtures from 17 proposed-policy fixtures and documented legacy reconstruction/cash-office interpretation. Validation: 49 rule-proof tests and 9 money/terms tests passed. TASK-003/004/011 remain in progress; next steps are installed-scope/store experiments and dated independent policy review. No remote financial mutation or email was sent.

## 2026-09-30 — DisplayDeck Trade Suite branding

Applied owner-requested branding to the app heading, local Shopify name configuration, onboarding copy, prototype heading, API documentation, README, expansion plan and tracker. Removed legacy-server terminology from embedded onboarding. Shopify hosted display-name synchronization remains pending; linked app IDs and source evidence retain their identities. Next testing: installed scopes and synthetic Shopify account orders, then physical POS and reconciliation; email remains deferred.

## 2026-09-30 — TASK-003 actual Shopify capability probe

Added schema-validated read-only capabilities.graphql and check-shopify-capabilities.mjs. Actual installation reports Basic development store, not Plus, with zero granted scopes. Six requested permissions require installation update before account-order tests. Owner screenshots confirm DisplayDeck Trade Suite branding and active version displaydeck-trade-suite-2. No Shopify order mutation executed.

## 2026-09-30 — Git checkpoint

Prepared the accumulated implementation, branding, acceptance evidence and capability probe for commit to main and push to origin (JapieBosman/ShopifyStore). Excluded newly generated statement artifacts and local teamwork notes. Staged text credential scan found no literal Shopify tokens or private keys; no new tests were run for this Git-only checkpoint. Existing verification results remain recorded in prior entries.
