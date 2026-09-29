import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  postJournal,
  reversePosting,
  validatePostingBundle,
  type PostingBundle,
} from "../../packages/domain/src/posting.ts";
import { withTenantContext } from "../../packages/database/tenant-context.ts";

const migration0001 = fileURLToPath(
  new URL("../../packages/database/migrations/0001_core.sql", import.meta.url),
);
const migration0002 = fileURLToPath(
  new URL("../../packages/database/migrations/0002_posting.sql", import.meta.url),
);

const TENANT_ID = "33333333-3333-4333-8333-333333333333";

test("integration: balanced posting, immutability, duplicate safety, and reversal balance to zero", async () => {
  const db = await PGlite.create();
  try {
    // 1. Run migrations in order
    await db.exec(readFileSync(migration0001, "utf8"));
    await db.exec(readFileSync(migration0002, "utf8"));

    // 2. Seed tenant, actor, payment terms, and standard ledger accounts
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

    const debtorRes = await db.query<{ id: string; ledger_version: string | number }>(
      `INSERT INTO debtor_account (
        tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
      ) VALUES (
        $1, 'DEBT-001', 'Contractor One', 'ZAR', $2, 20000.00, 'active', 'due_date'
      ) RETURNING id, ledger_version`,
      [TENANT_ID, termId],
    );
    const debtorId = debtorRes.rows[0]!.id;
    assert.equal(Number(debtorRes.rows[0]!.ledger_version), 0);

    const accountsRes = await db.query<{ id: string; code: string }>(
      "SELECT id, code FROM ledger_account WHERE tenant_id = $1",
      [TENANT_ID],
    );
    const arAccountId = accountsRes.rows.find((a) => a.code === "1200")!.id;
    const salesAccountId = accountsRes.rows.find((a) => a.code === "4010")!.id;

    // 3. Acceptance Check: Unbalanced, empty, or mixed-currency postings fail
    // Empty lines (< 2 lines)
    assert.throws(
      () =>
        validatePostingBundle({
          actorId,
          currency: "ZAR",
          effectiveDate: "2026-09-28",
          sourceKind: "test",
          sourceKey: "bad-1",
          idempotencyKey: "idem-bad-1",
          lines: [{ ledgerAccountId: arAccountId, direction: "debit", amount: "100.00", currency: "ZAR" }],
        }),
      /at least 2 lines/,
    );

    // Unbalanced posting (100.00 debit vs 99.99 credit)
    assert.throws(
      () =>
        validatePostingBundle({
          actorId,
          currency: "ZAR",
          effectiveDate: "2026-09-28",
          sourceKind: "test",
          sourceKey: "bad-2",
          idempotencyKey: "idem-bad-2",
          lines: [
            { ledgerAccountId: arAccountId, direction: "debit", amount: "100.00", currency: "ZAR" },
            { ledgerAccountId: salesAccountId, direction: "credit", amount: "99.99", currency: "ZAR" },
          ],
        }),
      /Unbalanced journal posting/,
    );

    // Mixed currencies (ZAR and USD in same posting)
    assert.throws(
      () =>
        validatePostingBundle({
          actorId,
          currency: "ZAR",
          effectiveDate: "2026-09-28",
          sourceKind: "test",
          sourceKey: "bad-3",
          idempotencyKey: "idem-bad-3",
          lines: [
            { ledgerAccountId: arAccountId, direction: "debit", amount: "100.00", currency: "ZAR" },
            { ledgerAccountId: salesAccountId, direction: "credit", amount: "100.00", currency: "USD" },
          ],
        }),
      /Mixed-currency transaction rejected/,
    );

    // Database-level trigger test: attempt raw SQL insert of unbalanced journal
    await assert.rejects(
      async () => {
        await withTenantContext(db, TENANT_ID, async (tx) => {
          const jRes = await tx.query<{ id: string }>(
            `INSERT INTO journal (tenant_id, currency, effective_date, posted_at, actor_id, source_kind, source_key, idempotency_key)
             VALUES ($1, 'ZAR', '2026-09-28', now(), $2, 'test', 'raw-unbalanced', 'idem-raw-unbalanced') RETURNING id`,
            [TENANT_ID, actorId],
          );
          // Insert 1 line only (violating >= 2 lines and balanced debit/credit)
          await tx.query(
            `INSERT INTO journal_line (tenant_id, journal_id, line_number, ledger_account_id, debit, credit)
             VALUES ($1, $2, 1, $3, 100.00, 0)`,
            [TENANT_ID, jRes.rows[0]!.id, arAccountId],
          );
        });
      },
      /unbalanced|must have at least 2 lines/i,
      "Database deferred constraint trigger must reject unbalanced journal",
    );

    // 4. Acceptance Check: Valid Posting
    const validBundle: PostingBundle = {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-09-28",
      sourceKind: "order",
      sourceKey: "gid://shopify/Order/888001",
      idempotencyKey: "idem-order-888001",
      memo: "Invoice for order #1001",
      lines: [
        {
          ledgerAccountId: arAccountId,
          debtorAccountId: debtorId,
          direction: "debit",
          amount: "1500.0000",
          currency: "ZAR",
          memo: "Accounts Receivable debit",
        },
        {
          ledgerAccountId: salesAccountId,
          direction: "credit",
          amount: "1500.0000",
          currency: "ZAR",
          memo: "Sales Clearing credit",
        },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "INV-888001",
          kind: "invoice",
          direction: "debit",
          amount: "1500.0000",
          currency: "ZAR",
          issuedOn: "2026-09-28",
          dueOn: "2026-10-28",
          shopifyOrderGid: "gid://shopify/Order/888001",
          sourceEventKey: "order:gid://shopify/Order/888001",
          lines: [
            {
              description: "Drywall Screws 50mm",
              quantity: "10.0000",
              unitPrice: "150.0000",
              netAmount: "1500.0000",
              taxAmount: "0.0000",
              grossAmount: "1500.0000",
            },
          ],
        },
      ],
    };

    const postResult = await postJournal(db, TENANT_ID, validBundle);
    assert.equal(postResult.isDuplicate, false);
    assert.equal(postResult.totalAmount, "1500.0000");
    assert.equal(postResult.currency, "ZAR");
    assert.equal(postResult.documentIds.length, 1);

    // Verify debtor account version incremented to 1
    const debtorAfterPost = await withTenantContext(db, TENANT_ID, async (tx) => {
      return tx.query<{ ledger_version: string | number }>(
        "SELECT ledger_version FROM debtor_account WHERE tenant_id = $1 AND id = $2",
        [TENANT_ID, debtorId],
      );
    });
    assert.equal(Number(debtorAfterPost.rows[0]!.ledger_version), 1);

    // Verify outbox entry created
    const outboxAfterPost = await withTenantContext(db, TENANT_ID, async (tx) => {
      return tx.query<{ kind: string; payload: Record<string, unknown> }>(
        "SELECT kind, payload FROM outbox WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
        [TENANT_ID],
      );
    });
    assert.equal(outboxAfterPost.rows[0]!.kind, "ledger/journal_posted");

    // 5. Acceptance Check: Duplicate source is safe
    // Post the same bundle again
    const dupResult = await postJournal(db, TENANT_ID, validBundle);
    assert.equal(dupResult.isDuplicate, true);
    assert.equal(dupResult.journalId, postResult.journalId);
    assert.deepEqual(dupResult.documentIds, postResult.documentIds);

    // Verify total journal and document counts did NOT change
    const counts = await withTenantContext(db, TENANT_ID, async (tx) => {
      const jCount = await tx.query<{ count: string | number }>(
        "SELECT count(*) as count FROM journal WHERE tenant_id = $1",
        [TENANT_ID],
      );
      const dCount = await tx.query<{ count: string | number }>(
        "SELECT count(*) as count FROM document WHERE tenant_id = $1",
        [TENANT_ID],
      );
      const debtorV = await tx.query<{ ledger_version: string | number }>(
        "SELECT ledger_version FROM debtor_account WHERE tenant_id = $1 AND id = $2",
        [TENANT_ID, debtorId],
      );
      return {
        journals: Number(jCount.rows[0]!.count),
        documents: Number(dCount.rows[0]!.count),
        version: Number(debtorV.rows[0]!.ledger_version),
      };
    });
    assert.equal(counts.journals, 1, "Duplicate post must not create duplicate journal");
    assert.equal(counts.documents, 1, "Duplicate post must not create duplicate document");
    assert.equal(counts.version, 1, "Debtor ledger version must not double increment");

    // 6. Acceptance Check: Reversal leaves original intact and balances zero
    const revResult = await reversePosting(db, TENANT_ID, {
      actorId,
      originalJournalId: postResult.journalId,
      idempotencyKey: "idem-reversal-888001",
      effectiveDate: "2026-09-29",
      memo: "Customer return / cancellation",
    });

    assert.equal(revResult.isDuplicate, false);
    assert.equal(revResult.originalJournalId, postResult.journalId);
    assert.equal(revResult.reversalDocumentIds.length, 1);

    // Verify original journal is intact
    const originalJournalRows = await withTenantContext(db, TENANT_ID, async (tx) => {
      return tx.query<{ id: string; reverses_journal_id: string | null }>(
        "SELECT id, reverses_journal_id FROM journal WHERE tenant_id = $1 AND id = $2",
        [TENANT_ID, postResult.journalId],
      );
    });
    assert.equal(originalJournalRows.rows.length, 1);
    assert.equal(originalJournalRows.rows[0]!.reverses_journal_id, null, "Original journal remains unmodified");

    // Verify reversal journal links reverses_journal_id
    const reversalJournalRows = await withTenantContext(db, TENANT_ID, async (tx) => {
      return tx.query<{ id: string; reverses_journal_id: string }>(
        "SELECT id, reverses_journal_id FROM journal WHERE tenant_id = $1 AND id = $2",
        [TENANT_ID, revResult.reversalJournalId],
      );
    });
    assert.equal(reversalJournalRows.rows[0]!.reverses_journal_id, postResult.journalId);

    // Verify net balance across original + reversal is exactly ZERO
    const balanceCheck = await withTenantContext(db, TENANT_ID, async (tx) => {
      const res = await tx.query<{
        total_debit: string | number;
        total_credit: string | number;
      }>(
        `SELECT 
           coalesce(sum(debit), 0) as total_debit,
           coalesce(sum(credit), 0) as total_credit
         FROM journal_line
         WHERE tenant_id = $1 AND ledger_account_id = $2`,
        [TENANT_ID, arAccountId],
      );
      return res.rows[0]!;
    });
    assert.equal(Number(balanceCheck.total_debit), 1500);
    assert.equal(Number(balanceCheck.total_credit), 1500);
    const netArBalance = Number(balanceCheck.total_debit) - Number(balanceCheck.total_credit);
    assert.equal(netArBalance, 0, "Original plus reversal balances to exactly ZERO");

    // Verify debtor account version incremented to 2
    const debtorAfterRev = await withTenantContext(db, TENANT_ID, async (tx) => {
      return tx.query<{ ledger_version: string | number }>(
        "SELECT ledger_version FROM debtor_account WHERE tenant_id = $1 AND id = $2",
        [TENANT_ID, debtorId],
      );
    });
    assert.equal(Number(debtorAfterRev.rows[0]!.ledger_version), 2);

    // Verify cannot reverse an already-reversed journal
    await assert.rejects(
      async () => {
        await reversePosting(db, TENANT_ID, {
          actorId,
          originalJournalId: postResult.journalId,
          idempotencyKey: "idem-reversal-attempt-2",
          effectiveDate: "2026-09-30",
        });
      },
      /already been reversed/,
      "Cannot reverse an already reversed journal",
    );

    // Verify cannot reverse a reversal journal
    await assert.rejects(
      async () => {
        await reversePosting(db, TENANT_ID, {
          actorId,
          originalJournalId: revResult.reversalJournalId,
          idempotencyKey: "idem-reversal-of-reversal",
          effectiveDate: "2026-09-30",
        });
      },
      /already a reversal/,
      "Cannot reverse a reversal journal",
    );
  } finally {
    await db.close();
  }
});
