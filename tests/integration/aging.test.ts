import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { postJournal } from "../../packages/domain/src/posting.ts";
import { executeExplicitAllocation } from "../../packages/domain/src/allocation.ts";
import {
  calculateAging,
  buildAgingSnapshot,
  getLatestAgingSnapshot,
  isAgingSnapshotFresh,
  assertAgingSnapshotFresh,
  BUCKETS,
} from "../../packages/domain/src/aging.ts";
import { AgingWorker } from "../../apps/worker/src/aging.ts";
import { withTenantContext } from "../../packages/database/tenant-context.ts";

const migration0001 = fileURLToPath(
  new URL("../../packages/database/migrations/0001_core.sql", import.meta.url),
);
const migration0002 = fileURLToPath(
  new URL("../../packages/database/migrations/0002_posting.sql", import.meta.url),
);
const migration0003 = fileURLToPath(
  new URL("../../packages/database/migrations/0003_allocation.sql", import.meta.url),
);

const TENANT_ID = "55555555-5555-5555-8555-555555555555";

test("integration: aging - eight buckets, ledger equality, credit signs, and stale snapshot rejection", async () => {
  const db = await PGlite.create();
  try {
    // 1. Run migrations in sequence
    await db.exec(readFileSync(migration0001, "utf8"));
    await db.exec(readFileSync(migration0002, "utf8"));
    await db.exec(readFileSync(migration0003, "utf8"));

    // 2. Seed tenant, actor, payment terms, accounts
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Acme Store', 'ZAR', 'UTC', 'active')",
      [TENANT_ID],
    );

    const actorRes = await db.query<{ id: string }>(
      `INSERT INTO actor (tenant_id, external_subject, display_name, role)
       VALUES ($1, 'bookkeeper@acme.internal', 'Test Bookkeeper', 'bookkeeper') RETURNING id`,
      [TENANT_ID],
    );
    const actorId = actorRes.rows[0]!.id;

    await db.query("SELECT seed_standard_ledger_accounts($1)", [TENANT_ID]);

    const termRes = await db.query<{ id: string }>(
      "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
      [TENANT_ID],
    );
    const termId = termRes.rows[0]!.id;

    const debtorRes = await db.query<{ id: string }>(
      `INSERT INTO debtor_account (
        tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
      ) VALUES (
        $1, 'DEBT-AGING', 'Contractor Aging', 'ZAR', $2, 100000.00, 'active', 'due_date'
      ) RETURNING id`,
      [TENANT_ID, termId],
    );
    const debtorId = debtorRes.rows[0]!.id;

    const accountsRes = await db.query<{ id: string; code: string }>(
      "SELECT id, code FROM ledger_account WHERE tenant_id = $1",
      [TENANT_ID],
    );
    const arAccountId = accountsRes.rows.find((a) => a.code === "1200")!.id;
    const bankAccountId = accountsRes.rows.find((a) => a.code === "1010")!.id;
    const salesAccountId = accountsRes.rows.find((a) => a.code === "4010")!.id;

    // 3. Acceptance Check: In-memory calculation and credit signs pass
    const pureAging = calculateAging({
      basis: "due_date",
      asOfDate: "2026-09-28",
      asOfPeriodOrdinal: 9,
      openItems: [],
      unappliedCredit: "40.0000",
    });
    assert.equal(pureAging.openDebits, "0.0000");
    assert.equal(pureAging.unappliedCredit, "40.0000");
    assert.equal(pureAging.netBalance, "-40.0000", "Credit signs: zero debt with credit produces negative net balance");

    // 4. Post three invoices on different dates
    // Invoice 1: 100.0000 ZAR, issued 2026-06-01, due 2026-07-01 (overdue 89 days on 2026-09-28) -> lands in d090
    const inv1 = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-06-01",
      sourceKind: "order",
      sourceKey: "order-inv-1",
      idempotencyKey: "post-inv-1",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: debtorId, direction: "debit", amount: "100.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "100.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "INV-001",
          kind: "invoice",
          direction: "debit",
          amount: "100.0000",
          currency: "ZAR",
          issuedOn: "2026-06-01",
          dueOn: "2026-07-01",
          sourceEventKey: "event-inv-1",
        },
      ],
    });
    const inv1Id = inv1.documentIds[0]!;

    // Invoice 2: 200.0000 ZAR, issued 2026-08-01, due 2026-08-31 (overdue 28 days on 2026-09-28) -> lands in d030
    await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-08-01",
      sourceKind: "order",
      sourceKey: "order-inv-2",
      idempotencyKey: "post-inv-2",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: debtorId, direction: "debit", amount: "200.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "200.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "INV-002",
          kind: "invoice",
          direction: "debit",
          amount: "200.0000",
          currency: "ZAR",
          issuedOn: "2026-08-01",
          dueOn: "2026-08-31",
          sourceEventKey: "event-inv-2",
        },
      ],
    });

    // Invoice 3: 300.0000 ZAR, issued 2026-09-15, due 2026-10-15 (future due date on 2026-09-28) -> lands in current
    await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-09-15",
      sourceKind: "order",
      sourceKey: "order-inv-3",
      idempotencyKey: "post-inv-3",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: debtorId, direction: "debit", amount: "300.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "300.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "INV-003",
          kind: "invoice",
          direction: "debit",
          amount: "300.0000",
          currency: "ZAR",
          issuedOn: "2026-09-15",
          dueOn: "2026-10-15",
          sourceEventKey: "event-inv-3",
        },
      ],
    });

    // 5. Post Payment of 50.0000 ZAR (unapplied)
    const pmtPost = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-09-20",
      sourceKind: "payment",
      sourceKey: "payment-pmt-50",
      idempotencyKey: "post-pmt-50",
      lines: [
        { ledgerAccountId: bankAccountId, direction: "debit", amount: "50.0000", currency: "ZAR" },
        { ledgerAccountId: arAccountId, debtorAccountId: debtorId, direction: "credit", amount: "50.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "PMT-50",
          kind: "payment",
          direction: "credit",
          amount: "50.0000",
          currency: "ZAR",
          issuedOn: "2026-09-20",
          sourceEventKey: "event-pmt-50",
        },
      ],
    });
    const pmt50Id = pmtPost.documentIds[0]!;

    // 6. Build Aging Snapshot as of 2026-09-28
    const snapshot = await buildAgingSnapshot(db, TENANT_ID, {
      debtorAccountId: debtorId,
      asOfDate: "2026-09-28",
    });

    assert.equal(snapshot.buckets.current, "300.0000", "INV-003 is in current bucket");
    assert.equal(snapshot.buckets.d030, "200.0000", "INV-002 is in d030 bucket");
    assert.equal(snapshot.buckets.d090, "100.0000", "INV-001 is in d090 bucket");
    assert.equal(snapshot.buckets.d060, "0.0000");
    assert.equal(snapshot.buckets.d120, "0.0000");
    assert.equal(snapshot.buckets.d150, "0.0000");
    assert.equal(snapshot.buckets.d180, "0.0000");
    assert.equal(snapshot.buckets.over, "0.0000");

    assert.equal(snapshot.openDebits, "600.0000");
    assert.equal(snapshot.unappliedCredit, "50.0000");
    assert.equal(snapshot.netBalance, "550.0000");

    // 7. Acceptance Check: sum(open debt) - unapplied equals ledger AR balance
    const ledgerArCheck = await withTenantContext(db, TENANT_ID, async (tx) => {
      const res = await tx.query<{ net_ar: string | number }>(
        `SELECT (coalesce(sum(debit), 0) - coalesce(sum(credit), 0)) as net_ar
         FROM journal_line
         WHERE tenant_id = $1 AND debtor_account_id = $2 AND ledger_account_id = $3`,
        [TENANT_ID, debtorId, arAccountId],
      );
      return Number(res.rows[0]!.net_ar);
    });

    const openDebtNumber = Number(snapshot.openDebits);
    const unappliedCreditNumber = Number(snapshot.unappliedCredit);
    const snapshotNet = openDebtNumber - unappliedCreditNumber;

    assert.equal(snapshotNet, ledgerArCheck, "sum(open debt) - unapplied credit equals ledger AR balance");
    assert.equal(snapshotNet, 550, "Net AR balance is 550.0000");

    // 8. Acceptance Check: Stale snapshot rejection for authorization
    const worker = new AgingWorker();
    const freshnessBefore = await worker.verifySnapshotFreshness(db, TENANT_ID, debtorId);
    assert.equal(freshnessBefore.isFresh, true, "Snapshot is fresh before any new ledger events");

    // Allocate 50.0000 from payment PMT-50 to Invoice 1 (INV-001)
    // This increments debtor_account.ledger_version from 4 to 5
    await executeExplicitAllocation(db, TENANT_ID, {
      actorId,
      debtorAccountId: debtorId,
      debitDocumentId: inv1Id,
      creditDocumentId: pmt50Id,
      amount: "50.0000",
      effectiveDate: "2026-09-25",
      idempotencyKey: "alloc-inv1-pmt50",
    });

    // Check freshness: now snapshot ledger_version (4) < debtor ledger_version (5)
    const freshnessAfter = await worker.verifySnapshotFreshness(db, TENANT_ID, debtorId);
    assert.equal(freshnessAfter.isFresh, false, "Snapshot is detected as STALE after allocation changes ledger version");
    assert.equal(freshnessAfter.currentVersion, 5);
    assert.equal(freshnessAfter.snapshotVersion, 4);

    // Assert that attempting to authorize on stale snapshot throws
    assert.throws(
      () => assertAgingSnapshotFresh(freshnessAfter.snapshotVersion!, freshnessAfter.currentVersion),
      /stale aging snapshot/i,
      "Stale snapshot cannot be used for credit authorization",
    );

    // Refreshing snapshot creates new version matching ledger_version 5
    const refreshedSnapshot = await buildAgingSnapshot(db, TENANT_ID, {
      debtorAccountId: debtorId,
      asOfDate: "2026-09-28",
    });

    assert.equal(refreshedSnapshot.ledgerVersion, 5);
    // After allocating 50 from INV-001, d090 bucket decreases from 100 to 50
    assert.equal(refreshedSnapshot.buckets.d090, "50.0000");
    // PMT-50 is now fully applied, so unapplied credit is 0.0000
    assert.equal(refreshedSnapshot.unappliedCredit, "0.0000");
    // Open debits is now 550.0000 (50 + 200 + 300)
    assert.equal(refreshedSnapshot.openDebits, "550.0000");
    // Net balance is still 550.0000
    assert.equal(refreshedSnapshot.netBalance, "550.0000");

    const freshnessRefreshed = await worker.verifySnapshotFreshness(db, TENANT_ID, debtorId);
    assert.equal(freshnessRefreshed.isFresh, true, "Refreshed snapshot is fresh");

    // 9. Worker batch test: refresh all active debtors
    const batchSummary = await worker.refreshTenantAgingSnapshots(db, TENANT_ID, "2026-09-28");
    assert.equal(batchSummary.processedCount, 1);
    assert.equal(batchSummary.results[0]!.debtorAccountId, debtorId);
  } finally {
    await db.close();
  }
});
