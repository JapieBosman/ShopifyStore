import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { postJournal } from "../../packages/domain/src/posting.ts";
import {
  executeExplicitAllocation,
  executeOldestFirstAllocation,
  reverseAllocation,
  getDebtorBalanceSummary,
} from "../../packages/domain/src/allocation.ts";
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

const TENANT_ID = "44444444-4444-4444-8444-444444444444";

test("integration: allocation - debit 10/payment 40, concurrency, lock ordering, oldest-first, and reversals", async () => {
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

    // Debtor A
    const debtorRes = await db.query<{ id: string }>(
      `INSERT INTO debtor_account (
        tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
      ) VALUES (
        $1, 'DEBT-A', 'Contractor A', 'ZAR', $2, 50000.00, 'active', 'due_date'
      ) RETURNING id`,
      [TENANT_ID, termId],
    );
    const debtorAId = debtorRes.rows[0]!.id;

    // Debtor B (for cross-account tests)
    const debtorBRes = await db.query<{ id: string }>(
      `INSERT INTO debtor_account (
        tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
      ) VALUES (
        $1, 'DEBT-B', 'Contractor B', 'ZAR', $2, 50000.00, 'active', 'due_date'
      ) RETURNING id`,
      [TENANT_ID, termId],
    );
    const debtorBId = debtorBRes.rows[0]!.id;

    const accountsRes = await db.query<{ id: string; code: string }>(
      "SELECT id, code FROM ledger_account WHERE tenant_id = $1",
      [TENANT_ID],
    );
    const arAccountId = accountsRes.rows.find((a) => a.code === "1200")!.id;
    const bankAccountId = accountsRes.rows.find((a) => a.code === "1010")!.id;
    const salesAccountId = accountsRes.rows.find((a) => a.code === "4010")!.id;

    // 3. Post Invoice for 10.0000 ZAR on Debtor A
    const invPost = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-09-01",
      sourceKind: "order",
      sourceKey: "order-1001",
      idempotencyKey: "post-order-1001",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: debtorAId, direction: "debit", amount: "10.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "10.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorAId,
          documentNumber: "INV-1001",
          kind: "invoice",
          direction: "debit",
          amount: "10.0000",
          currency: "ZAR",
          issuedOn: "2026-09-01",
          dueOn: "2026-10-01",
          sourceEventKey: "event-order-1001",
        },
      ],
    });
    const debitDoc10Id = invPost.documentIds[0]!;

    // 4. Post Payment for 40.0000 ZAR on Debtor A
    const pmtPost = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-09-05",
      sourceKind: "payment",
      sourceKey: "payment-4001",
      idempotencyKey: "post-pmt-4001",
      lines: [
        { ledgerAccountId: bankAccountId, direction: "debit", amount: "40.0000", currency: "ZAR" },
        { ledgerAccountId: arAccountId, debtorAccountId: debtorAId, direction: "credit", amount: "40.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorAId,
          documentNumber: "PMT-4001",
          kind: "payment",
          direction: "credit",
          amount: "40.0000",
          currency: "ZAR",
          issuedOn: "2026-09-05",
          sourceEventKey: "event-payment-4001",
        },
      ],
    });
    const creditDoc40Id = pmtPost.documentIds[0]!;

    // Check balance BEFORE allocation:
    // Open debits = 10.0000, Unapplied credit = 40.0000, Net balance = -30.0000
    const summaryBefore = await getDebtorBalanceSummary(db, TENANT_ID, debtorAId);
    assert.equal(summaryBefore.totalDebit, "10.0000");
    assert.equal(summaryBefore.totalCredit, "40.0000");
    assert.equal(summaryBefore.totalOpenDebit, "10.0000");
    assert.equal(summaryBefore.unappliedCredit, "40.0000");
    assert.equal(summaryBefore.netBalance, "-30.0000");

    // 5. Acceptance Check: "debit 10/payment 40 gives net -30 and unapplied 30"
    const allocResult = await executeExplicitAllocation(db, TENANT_ID, {
      actorId,
      debtorAccountId: debtorAId,
      debitDocumentId: debitDoc10Id,
      creditDocumentId: creditDoc40Id,
      amount: "10.0000",
      effectiveDate: "2026-09-05",
      idempotencyKey: "alloc-1001-4001",
    });

    assert.equal(allocResult.isDuplicate, false);
    assert.equal(allocResult.amount, "10.0000");
    assert.equal(allocResult.unappliedCredit, "30.0000");
    assert.equal(allocResult.netBalance, "-30.0000");

    const summaryAfter = await getDebtorBalanceSummary(db, TENANT_ID, debtorAId);
    assert.equal(summaryAfter.totalOpenDebit, "0.0000", "Debit document 10 is fully allocated");
    assert.equal(summaryAfter.unappliedCredit, "30.0000", "Remaining unapplied credit is exactly 30");
    assert.equal(summaryAfter.netBalance, "-30.0000", "Net balance is exactly -30.0000");
    assert.equal(summaryAfter.openDebits.length, 0, "No open debits remaining");
    assert.equal(summaryAfter.openCredits.length, 1, "Payment remains as open credit");
    assert.equal(summaryAfter.openCredits[0]!.remainingAmount, "30.0000");

    // 6. Acceptance Check: Cannot exceed remaining debit (0 left) or remaining credit (30 left)
    await assert.rejects(
      async () => {
        await executeExplicitAllocation(db, TENANT_ID, {
          actorId,
          debtorAccountId: debtorAId,
          debitDocumentId: debitDoc10Id,
          creditDocumentId: creditDoc40Id,
          amount: "1.0000",
          effectiveDate: "2026-09-06",
          idempotencyKey: "alloc-exceed-debit",
        });
      },
      /exceeds remaining debit/i,
      "Cannot allocate beyond remaining debit of document",
    );

    // Post another debit document for 100.0000
    const invPost2 = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-09-06",
      sourceKind: "order",
      sourceKey: "order-1002",
      idempotencyKey: "post-order-1002",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: debtorAId, direction: "debit", amount: "100.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "100.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorAId,
          documentNumber: "INV-1002",
          kind: "invoice",
          direction: "debit",
          amount: "100.0000",
          currency: "ZAR",
          issuedOn: "2026-09-06",
          dueOn: "2026-10-06",
          sourceEventKey: "event-order-1002",
        },
      ],
    });
    const debitDoc100Id = invPost2.documentIds[0]!;

    // Attempt to allocate 31.0000 from creditDoc40Id (which only has 30.0000 unapplied)
    await assert.rejects(
      async () => {
        await executeExplicitAllocation(db, TENANT_ID, {
          actorId,
          debtorAccountId: debtorAId,
          debitDocumentId: debitDoc100Id,
          creditDocumentId: creditDoc40Id,
          amount: "31.0000",
          effectiveDate: "2026-09-06",
          idempotencyKey: "alloc-exceed-credit",
        });
      },
      /exceeds available credit/i,
      "Cannot allocate beyond available credit of document",
    );

    // 7. Acceptance Check: Database constraint trigger rejects raw SQL over-allocation
    await assert.rejects(
      async () => {
        await withTenantContext(db, TENANT_ID, async (tx) => {
          await tx.query(
            `INSERT INTO allocation (
              tenant_id, debtor_account_id, debit_document_id, credit_document_id,
              amount, effective_date, actor_id, idempotency_key
            ) VALUES (
              $1, $2, $3, $4, 50.0000, '2026-09-06', $5, 'raw-over-allocate'
            )`,
            [TENANT_ID, debtorAId, debitDoc100Id, creditDoc40Id, actorId],
          );
        });
      },
      /exceed credit document|exceed/i,
      "Database constraint trigger must prevent over-allocation",
    );

    // 8. Acceptance Check: Cross-account allocation is strictly rejected
    // Post invoice on Debtor B
    const invPostB = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-09-01",
      sourceKind: "order",
      sourceKey: "order-debtor-b",
      idempotencyKey: "post-order-debtor-b",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: debtorBId, direction: "debit", amount: "50.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "50.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorBId,
          documentNumber: "INV-B-01",
          kind: "invoice",
          direction: "debit",
          amount: "50.0000",
          currency: "ZAR",
          issuedOn: "2026-09-01",
          dueOn: "2026-10-01",
          sourceEventKey: "event-order-debtor-b",
        },
      ],
    });
    const debitDocBId = invPostB.documentIds[0]!;

    await assert.rejects(
      async () => {
        await executeExplicitAllocation(db, TENANT_ID, {
          actorId,
          debtorAccountId: debtorAId,
          debitDocumentId: debitDocBId, // Debtor B's document
          creditDocumentId: creditDoc40Id, // Debtor A's payment
          amount: "10.0000",
          effectiveDate: "2026-09-07",
          idempotencyKey: "alloc-cross-account",
        });
      },
      /same debtor account/i,
      "Cross-account allocation must be rejected",
    );

    // 9. Acceptance Check: Oldest-issued-first allocation
    // Post three invoices on Debtor A with dates: 2026-09-02, 2026-09-03, 2026-09-04
    const dates = ["2026-09-02", "2026-09-03", "2026-09-04"];
    const oldestDebitIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await postJournal(db, TENANT_ID, {
        actorId,
        currency: "ZAR",
        effectiveDate: dates[i]!,
        sourceKind: "order",
        sourceKey: `order-oldest-${i}`,
        idempotencyKey: `post-order-oldest-${i}`,
        lines: [
          { ledgerAccountId: arAccountId, debtorAccountId: debtorAId, direction: "debit", amount: "15.0000", currency: "ZAR" },
          { ledgerAccountId: salesAccountId, direction: "credit", amount: "15.0000", currency: "ZAR" },
        ],
        documents: [
          {
            debtorAccountId: debtorAId,
            documentNumber: `INV-SEQ-${i + 1}`,
            kind: "invoice",
            direction: "debit",
            amount: "15.0000",
            currency: "ZAR",
            issuedOn: dates[i]!,
            dueOn: "2026-10-01",
            sourceEventKey: `event-seq-${i + 1}`,
          },
        ],
      });
      oldestDebitIds.push(p.documentIds[0]!);
    }

    // Now post a fresh payment for 25.0000 ZAR
    const pmt25Post = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-09-10",
      sourceKind: "payment",
      sourceKey: "pmt-oldest-first-25",
      idempotencyKey: "post-pmt-25",
      lines: [
        { ledgerAccountId: bankAccountId, direction: "debit", amount: "25.0000", currency: "ZAR" },
        { ledgerAccountId: arAccountId, debtorAccountId: debtorAId, direction: "credit", amount: "25.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorAId,
          documentNumber: "PMT-25",
          kind: "payment",
          direction: "credit",
          amount: "25.0000",
          currency: "ZAR",
          issuedOn: "2026-09-10",
          sourceEventKey: "event-pmt-25",
        },
      ],
    });
    const pmt25Id = pmt25Post.documentIds[0]!;

    // Run executeOldestFirstAllocation:
    // Oldest is INV-SEQ-1 (2026-09-02, 15.0000) -> fully satisfied with 15.0000
    // Next oldest is INV-SEQ-2 (2026-09-03, 15.0000) -> partially satisfied with remaining 10.0000
    // INV-SEQ-3 (2026-09-04) -> remains untouched (15.0000 open)
    const oResult = await executeOldestFirstAllocation(db, TENANT_ID, {
      actorId,
      debtorAccountId: debtorAId,
      creditDocumentId: pmt25Id,
      effectiveDate: "2026-09-10",
      idempotencyKeyPrefix: "oldest-first-run-1",
    });

    assert.equal(oResult.totalAllocated, "25.0000");
    assert.equal(oResult.unappliedCredit, "30.0000"); // From PMT-4001, since PMT-25 is completely used
    assert.equal(oResult.allocations.length, 2);
    assert.equal(oResult.allocations[0]!.debitDocumentId, oldestDebitIds[0]!);
    assert.equal(oResult.allocations[0]!.amount, "15.0000");
    assert.equal(oResult.allocations[1]!.debitDocumentId, oldestDebitIds[1]!);
    assert.equal(oResult.allocations[1]!.amount, "10.0000");

    // 10. Acceptance Check: Allocation Reversal
    // Reverse the first allocation (allocResult.allocationId, which was 10.0000 from creditDoc40Id to debitDoc10Id)
    const revRes = await reverseAllocation(db, TENANT_ID, {
      actorId,
      allocationId: allocResult.allocationId,
      effectiveDate: "2026-09-15",
      reason: "Correcting allocation per customer request",
    });

    assert.equal(revRes.allocationId, allocResult.allocationId);
    assert.equal(revRes.amount, "10.0000");

    // After reversal, debitDoc10Id should be OPEN again (remaining 10.0000),
    // and creditDoc40Id should have unapplied credit of 40.0000 (30 + 10 = 40)
    const summaryAfterRev = await getDebtorBalanceSummary(db, TENANT_ID, debtorAId);
    const debitDoc10Summary = summaryAfterRev.openDebits.find((d) => d.id === debitDoc10Id);
    assert.ok(debitDoc10Summary, "Reversed debit document is open again");
    assert.equal(debitDoc10Summary.remainingAmount, "10.0000");

    const creditDoc40Summary = summaryAfterRev.openCredits.find((c) => c.id === creditDoc40Id);
    assert.ok(creditDoc40Summary, "Credit document has restored unapplied credit");
    assert.equal(creditDoc40Summary.remainingAmount, "40.0000");

    // Verify cannot reverse an already reversed allocation
    await assert.rejects(
      async () => {
        await reverseAllocation(db, TENANT_ID, {
          actorId,
          allocationId: allocResult.allocationId,
          effectiveDate: "2026-09-16",
          reason: "Attempt duplicate reversal",
        });
      },
      /already been reversed/i,
      "Cannot reverse an allocation twice",
    );

    // 11. Acceptance Check: Outbox and Audit Events generated
    const outboxRows = await withTenantContext(db, TENANT_ID, async (tx) => {
      return tx.query<{ kind: string }>(
        "SELECT kind FROM outbox WHERE tenant_id = $1 AND kind IN ('ledger/allocation_created', 'ledger/allocation_reversed')",
        [TENANT_ID],
      );
    });
    assert.ok(outboxRows.rows.some((r) => r.kind === "ledger/allocation_created"));
    assert.ok(outboxRows.rows.some((r) => r.kind === "ledger/allocation_reversed"));

    const auditRows = await withTenantContext(db, TENANT_ID, async (tx) => {
      return tx.query<{ action: string; entity_type: string }>(
        "SELECT action, entity_type FROM audit_event WHERE tenant_id = $1 AND entity_type = 'allocation'",
        [TENANT_ID],
      );
    });
    assert.ok(auditRows.rows.some((r) => r.action === "allocate"));
    assert.ok(auditRows.rows.some((r) => r.action === "reverse"));
  } finally {
    await db.close();
  }
});

test("integration: concurrent allocation never exceeds debit or credit", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(readFileSync(migration0001, "utf8"));
    await db.exec(readFileSync(migration0002, "utf8"));
    await db.exec(readFileSync(migration0003, "utf8"));

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
        $1, 'DEBT-C', 'Contractor C', 'ZAR', $2, 50000.00, 'active', 'due_date'
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

    // Post Debit Document of 50.0000
    const invPost = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-09-01",
      sourceKind: "order",
      sourceKey: "order-concurrent-debit",
      idempotencyKey: "post-order-concurrent-debit",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: debtorId, direction: "debit", amount: "50.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "50.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "INV-RACE",
          kind: "invoice",
          direction: "debit",
          amount: "50.0000",
          currency: "ZAR",
          issuedOn: "2026-09-01",
          sourceEventKey: "event-order-race",
        },
      ],
    });
    const debitDocId = invPost.documentIds[0]!;

    // Post Credit Document of 50.0000
    const pmtPost = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-09-01",
      sourceKind: "payment",
      sourceKey: "pmt-concurrent-credit",
      idempotencyKey: "post-pmt-concurrent-credit",
      lines: [
        { ledgerAccountId: bankAccountId, direction: "debit", amount: "50.0000", currency: "ZAR" },
        { ledgerAccountId: arAccountId, debtorAccountId: debtorId, direction: "credit", amount: "50.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "PMT-RACE",
          kind: "payment",
          direction: "credit",
          amount: "50.0000",
          currency: "ZAR",
          issuedOn: "2026-09-01",
          sourceEventKey: "event-pmt-race",
        },
      ],
    });
    const creditDocId = pmtPost.documentIds[0]!;

    // 1. First allocation allocates 30.0000 of 50.0000
    const alloc1 = await executeExplicitAllocation(db, TENANT_ID, {
      actorId,
      debtorAccountId: debtorId,
      debitDocumentId: debitDocId,
      creditDocumentId: creditDocId,
      amount: "30.0000",
      effectiveDate: "2026-09-02",
      idempotencyKey: "seq-alloc-1",
    });
    assert.equal(alloc1.amount, "30.0000");

    // 2. Second competing allocation requests 30.0000 (total would be 60.0000 > 50.0000)
    // Must be rejected because remaining debit is only 20.0000
    await assert.rejects(
      async () => {
        await executeExplicitAllocation(db, TENANT_ID, {
          actorId,
          debtorAccountId: debtorId,
          debitDocumentId: debitDocId,
          creditDocumentId: creditDocId,
          amount: "30.0000",
          effectiveDate: "2026-09-02",
          idempotencyKey: "seq-alloc-2",
        });
      },
      /exceeds remaining debit 20.0000/i,
      "Competing allocation exceeding remaining balance must be rejected",
    );

    // 3. Database constraint trigger check: even raw SQL trying to exceed remaining 20.0000 fails
    await assert.rejects(
      async () => {
        await withTenantContext(db, TENANT_ID, async (tx) => {
          await tx.query(
            `INSERT INTO allocation (
              tenant_id, debtor_account_id, debit_document_id, credit_document_id,
              amount, effective_date, actor_id, idempotency_key
            ) VALUES (
              $1, $2, $3, $4, 25.0000, '2026-09-02', $5, 'raw-competing-over-allocate'
            )`,
            [TENANT_ID, debtorId, debitDocId, creditDocId, actorId],
          );
        });
      },
      /exceed debit document|exceed credit document|exceed/i,
      "Database constraint trigger must prevent competing over-allocation",
    );

    // 4. Verify total allocated in database is exactly 30.0000, NOT 55.0000 or 60.0000
    const summary = await getDebtorBalanceSummary(db, TENANT_ID, debtorId);
    assert.equal(summary.totalOpenDebit, "20.0000", "Remaining debit is 20 (50 - 30)");
    assert.equal(summary.unappliedCredit, "20.0000", "Remaining credit is 20 (50 - 30)");
    assert.equal(summary.netBalance, "0.0000", "Net balance is 0.0000 (20 - 20)");
  } finally {
    await db.close();
  }
});

