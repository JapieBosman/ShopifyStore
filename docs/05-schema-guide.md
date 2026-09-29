# PostgreSQL schema guide
The [reference SQL](../schema/trade-accounts.sql) defines 44 tables, columns, types, foreign keys, uniqueness/check constraints, lookup indexes and tenant RLS. It is a greenfield schema with no Genesis table/column contract. It is a **design reference**, not a completed production migration.

## Model map
| Area | Tables |
|---|---|
| Installation | tenant, installation, subscription, location, actor |
| Debtors | payment_term, debtor_account, debtor_identity, billing_contact, account_address, tax_evidence, accounting_period |
| Ledger | ledger_account, journal, journal_line, document, document_line, allocation, allocation_reversal |
| Approval | credit_reservation, supervisor_override |
| Ageing | aging_snapshot, aging_bucket |
| Statements | statement_run, statement, statement_item, statement_delivery |
| Cash office | register, register_shift, tender_type, tender_movement, denomination, cash_count, cash_count_line, shift_reconciliation |
| Shopify/cache | variant_cache, variant_barcode, inventory_cache |
| Reliability | webhook_inbox, outbox, sync_cursor, audit_event |
| Optional future generic CSV import | import_batch, import_item |

## Relational choices
Tenant-local entities use UUID primary keys and UNIQUE(tenant_id,id). Every local relationship includes tenant_id in its foreign key, preventing a valid object ID from another tenant being attached. Indexes start with tenant_id. Global shop uniqueness is a control-plane safeguard.

3NF governs operational source data. Statement snapshots, cached Shopify objects and ageing snapshots are intentionally denormalised projections. Snapshot JSON is limited to immutable document facts (addresses, terms, tax details) or envelopes/audit; it is not the primary debtor or accounting schema.

Every debtor has one currency and explicit terms. A debt document carries its issuance-time terms snapshot and fixed due date. Updating account terms does not change existing due dates without a recorded correction. Documents never combine currencies. A one-to-many journal/document relationship permits separate cash and discount documents in one posting bundle.

Eight bucket rows (0–7) preserve Genesis reporting depth; a UI can combine buckets 4–7 into 120+ without discarding them. Snapshots are disposable and versioned; account authorisation reads durable postings plus reservations. Unallocated money is derived, not an independently editable column. Example: payment amount - active allocated amount. Store snapshot totals only as rebuildable projections.

## Mandatory production invariants not expressible as row CHECK constraints
Implement database procedures plus restricted privileges in packages/database/migrations/0002_posting.sql. Do not copy Genesis triggers or hidden business logic. Procedures provide explicit transaction boundaries; domain policy remains testable code. Runtime roles cannot bypass procedures to change financial rows.

1. post_journal(bundle): lock account(s) in UUID order; require at least two valid lines; SUM(debit)=SUM(credit) per journal; validate account/document/journal currency, direction and totals; assign journal/documents/lines; increment debtor ledger_version; enqueue outbox and audit atomically. A shared journal can contain several debtor documents but every document's AR leg must reconcile.
2. allocate_credit(command): lock debtor, then document IDs in stable order; verify same account/currency and opposite directions; calculate active allocations excluding dated reversals; prevent sum exceeding either document; persist allocation and audit. Effective date cannot predate either document. Reject allocation to reversed obligations.
3. reverse_allocation(command): one full reversal per allocation; partial undo uses full reversal plus new smaller allocation. Reverse effective date >= original allocation date.
4. reverse_posting(command): original journal remains immutable; reconcile/reverse allocations first; create balanced reversal document and linked original journal; do not merely set a “cancelled” status.
5. reserve_credit(command) / consume_credit(command): lock debtor; enforce version/status/cart and exposure; reservation conversion + posting is one transaction. Ensure override actor authority, matching currency, amount and expiry. Uncertain reservations stay in exposure.
6. close_shift(command): lock register/shift; block new postings after count submission; validate all denomination currencies, approved count belongs to the same shift and refund tender matches original unless authorised exception. Submitted count contents become immutable.
7. statement finalisation: require eight buckets, same account/currency across items, matching control totals and immutable cutoffs. A statement artifact may be regenerated with the same bytes/hash or replaced only as a new generation.

SQL CHECK constraints cannot validate aggregate journal balance or allocation totals alone. A raw insert can violate those invariants in this design reference; do not ship it without the above procedure/grant tests.

## Access and retention
Runtime roles: api_runtime and worker_runtime without superuser/BYPASSRLS/ownership; migration owner separate. REVOKE public schema create and function execution defaults; explicitly grant service access and execute only approved procedures. No UPDATE/DELETE on journals, journal lines, posted documents, allocations, submitted counts or audit events to runtime roles. Controlled compliance erasure uses a separate audited retention procedure, not normal worker delete grants.

SET LOCAL app.tenant_id comes from verified authentication inside every database transaction, including worker jobs. RLS is not protection against a compromised server that can freely choose tenant context; auth derivation and SQL injection prevention remain essential. Control-plane shop routing has a dedicated tightly scoped lookup/provisioning path before tenant context exists. Test no-context, wrong-context, pooled-connection reuse and cross-tenant FK failures.

Installation tokens are secret-manager references; use encrypted credential blobs only if the deployment cannot use per-shop secret references and document the envelope-key rotation design. Contacts and certificate artifacts are sensitive; redact logs and restrict statement links. Webhook payloads have short configurable retention (initial target 30 days); permanent business source keys survive payload deletion. Financial retention period is decided for the launch jurisdiction, not guessed.

## Initial seeds and implementation scope
Seed ledger codes AR, CASH_CLEARING, SALES_CLEARING, DISCOUNT, WRITEOFF, REFUND_CLEARING, OPENING_EQUITY and INTEREST. Seed COD, NET7, NET30, NET60 and NET90; due date is issued_on + days for net terms, end-of-issue-month + days for EOM. Seed tender types cash/card/bank_transfer/account/other; account is never is_cash=true.

Do not seed rates or automatically charge interest. Interest is disabled until formula/rate basis/day-count/rounding/eligibility and applicable merchant authorisation are approved; posting then uses explicit interest documents with unique period/source keys.

Tables for cash office, product cache and import are future reference scope. They need not all be migrated at initial MVP launch. No import screen or Genesis migration is a Phase 1 dependency. Generic opening-balance import can be delivered later if needed; opening balances and Shopify backfill must not duplicate receivables.

Pricing and workshop expansion require separate reviewed migrations, rather than adding wide optional columns to debtor_account. Proposed later entities: price_list, price_list_assignment, price_rule, quantity_break, price_decision; job_card, job_line, job_status_event. Their detailed schemas are deliberately outside the six required schema areas and are tasks in the later roadmap.

## Worked financial acceptance examples
| Case | Expected result |
|---|---|
| Invoice 10, receipt 40, allocated 10 | Open debt 0; unapplied credit 30; net balance -30 |
| Over=100, 180=50, current=20; receipt 120 | Over=0; 180=30; current=20; net 50 |
| Two simultaneous baskets 80 against available credit 100 | One reservation succeeds, other fails; never exposure 160 |
| Invoice 100 paid 40; invoice credit note 20 | Net debt 40; allocation history remains explainable; no cash refund unless explicitly issued |
| Invoice 100, fully paid, then credit note 25 | Customer credit 25; refund of 25 removes credit and reduces correct tender |
| January statement finalised; January-dated adjustment posted in February | Original statement unchanged; regenerated version or February correction disclosed |
| Webhook and poll report same receipt | Exactly one payment source key and journal |
| Cash/card split return | Each refund movement follows original tender; cashup unaffected by card portion |

## Validation status
This package contains schema design, not a running PostgreSQL deployment. Structural checks cover table coverage, FK targets and RLS presence. Production acceptance requires executing migrations against PostgreSQL, testing procedures/grants/concurrency and checking query plans under realistic data volume. Never mark those tasks complete from this design review alone.

