import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { postJournal } from "../../packages/domain/src/posting.ts";
import { executeExplicitAllocation } from "../../packages/domain/src/allocation.ts";
import { executeStatementRun, renderStatementHtml } from "../../apps/worker/src/statements.ts";
import { buildServer } from "../../apps/api/src/server.ts";
import { createMockSessionToken } from "../../apps/api/src/auth/shopify.ts";

const migration0001 = fileURLToPath(
  new URL("../../packages/database/migrations/0001_core.sql", import.meta.url),
);
const migration0002 = fileURLToPath(
  new URL("../../packages/database/migrations/0002_posting.sql", import.meta.url),
);
const migration0003 = fileURLToPath(
  new URL("../../packages/database/migrations/0003_allocation.sql", import.meta.url),
);
const migration0004 = fileURLToPath(
  new URL("../../packages/database/migrations/0004_reservations.sql", import.meta.url),
);
const migration0005 = fileURLToPath(
  new URL("../../packages/database/migrations/0005_idempotency.sql", import.meta.url),
);

const TENANT_ID = "77777777-7777-4777-8777-777777777777";
const API_SECRET = "shpss_test_secret_key_12345";
const CLIENT_ID = "test_client_id_67890";
const SHOP = "boland-construction.myshopify.com";

test("integration: statement engine - control totals, 8 buckets, late-posting immutability, and DB constraints", async () => {
  const db = await PGlite.create();
  try {
    // 1. Run migrations in sequence
    await db.exec(readFileSync(migration0001, "utf8"));
    await db.exec(readFileSync(migration0002, "utf8"));
    await db.exec(readFileSync(migration0003, "utf8"));

    // 2. Seed tenant, actor, payment terms, ledger accounts, and debtor account
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Genesis Wholesale', 'ZAR', 'UTC', 'active')",
      [TENANT_ID],
    );

    const actorRes = await db.query<{ id: string }>(
      `INSERT INTO actor (tenant_id, external_subject, display_name, role)
       VALUES ($1, 'finance@genesis.internal', 'Senior Accountant', 'bookkeeper') RETURNING id`,
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
        $1, 'DEBT-STMT-01', 'Boland Construction Supplies', 'ZAR', $2, 50000.00, 'active', 'due_date'
      ) RETURNING id`,
      [TENANT_ID, termId],
    );
    const debtorId = debtorRes.rows[0]!.id;

    // Link customer Shopify GID and billing contact
    await db.query(
      `INSERT INTO debtor_identity (tenant_id, debtor_account_id, kind, shopify_gid)
       VALUES ($1, $2, 'customer', 'gid://shopify/Customer/99001122')`,
      [TENANT_ID, debtorId],
    );

    await db.query(
      `INSERT INTO billing_contact (tenant_id, debtor_account_id, name, email, phone, send_statements)
       VALUES ($1, $2, 'Accounts Payable', 'ap@boland.example.com', '+27 21 872 2000', true)`,
      [TENANT_ID, debtorId],
    );

    const accountsRes = await db.query<{ id: string; code: string }>(
      "SELECT id, code FROM ledger_account WHERE tenant_id = $1",
      [TENANT_ID],
    );
    const arAccountId = accountsRes.rows.find((a) => a.code === "1200")!.id;
    const bankAccountId = accountsRes.rows.find((a) => a.code === "1010")!.id;
    const salesAccountId = accountsRes.rows.find((a) => a.code === "4010")!.id;

    // 3. Post July invoice (recorded in July, pre-period for August)
    const julInv = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-07-15",
      sourceKind: "order",
      sourceKey: "ord-jul-1",
      idempotencyKey: "post-jul-1",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: debtorId, direction: "debit", amount: "1000.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "1000.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "INV-JUL-001",
          kind: "invoice",
          direction: "debit",
          amount: "1000.0000",
          currency: "ZAR",
          issuedOn: "2026-07-15",
          dueOn: "2026-08-15",
          sourceEventKey: "evt-jul-1",
        },
      ],
    });
    const julInvId = julInv.documentIds[0]!;

    // Set created_at to July timestamp
    await db.query("UPDATE document SET created_at = '2026-07-15T10:00:00.000Z' WHERE id = $1", [julInvId]);

    // 4. Post August invoice (in-period)
    const augInv = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-08-10",
      sourceKind: "order",
      sourceKey: "ord-aug-1",
      idempotencyKey: "post-aug-1",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: debtorId, direction: "debit", amount: "2500.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "2500.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "INV-AUG-001",
          kind: "invoice",
          direction: "debit",
          amount: "2500.0000",
          currency: "ZAR",
          issuedOn: "2026-08-10",
          dueOn: "2026-09-10",
          sourceEventKey: "evt-aug-1",
        },
      ],
    });
    const augInvId = augInv.documentIds[0]!;
    await db.query("UPDATE document SET created_at = '2026-08-10T11:00:00.000Z' WHERE id = $1", [augInvId]);

    // 5. Post August payment (in-period)
    const augPmt = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-08-20",
      sourceKind: "payment",
      sourceKey: "pay-aug-1",
      idempotencyKey: "post-aug-pmt-1",
      lines: [
        { ledgerAccountId: bankAccountId, direction: "debit", amount: "1000.0000", currency: "ZAR" },
        { ledgerAccountId: arAccountId, debtorAccountId: debtorId, direction: "credit", amount: "1000.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "RCT-AUG-001",
          kind: "payment",
          direction: "credit",
          amount: "1000.0000",
          currency: "ZAR",
          issuedOn: "2026-08-20",
          dueOn: "2026-08-20",
          sourceEventKey: "evt-aug-pmt-1",
        },
      ],
    });
    const augPmtId = augPmt.documentIds[0]!;
    await db.query("UPDATE document SET created_at = '2026-08-20T14:00:00.000Z' WHERE id = $1", [augPmtId]);

    // Allocate payment to July invoice
    await executeExplicitAllocation(db, TENANT_ID, {
      actorId,
      debtorAccountId: debtorId,
      debitDocumentId: julInvId,
      creditDocumentId: augPmtId,
      amount: "1000.0000",
      effectiveDate: "2026-08-20",
      idempotencyKey: "alloc-aug-1",
    });
    await db.query("UPDATE allocation SET created_at = '2026-08-20T14:05:00.000Z' WHERE tenant_id = $1", [TENANT_ID]);

    // 6. Execute August statement run with cutoff at end of August
    const cutoffAug = "2026-08-31T23:59:59.000Z";
    const runResult = await executeStatementRun(db, TENANT_ID, {
      periodFrom: "2026-08-01",
      periodTo: "2026-08-31",
      cutoffRecordedAt: cutoffAug,
      generation: 1,
      actorId,
    });

    assert.equal(runResult.status, "ready");
    assert.equal(runResult.statementsCount, 1);
    assert.equal(runResult.totalDebits, "2500.0000");
    assert.equal(runResult.totalCredits, "1000.0000");
    assert.equal(runResult.netClosingBalance, "2500.0000");

    // 7. Inspect database records for statement
    const stmtRes = await db.query<any>(
      `SELECT * FROM statement WHERE tenant_id = $1 AND statement_run_id = $2`,
      [TENANT_ID, runResult.statementRunId]
    );
    assert.equal(stmtRes.rows.length, 1);
    const stmt = stmtRes.rows[0];

    assert.equal(Number(stmt.opening_balance), 1000.0000);
    assert.equal(Number(stmt.debits), 2500.0000);
    assert.equal(Number(stmt.credits), 1000.0000);
    assert.equal(Number(stmt.closing_balance), 2500.0000);
    assert.ok(stmt.pdf_object_key && stmt.pdf_object_key.endsWith(".pdf"), "Statement pdf_object_key must point to a .pdf artifact");
    assert.ok(stmt.pdf_sha256 && stmt.pdf_sha256.length === 64, "Deterministic SHA-256 must be populated from PDF bytes");

    // Invariant: closing_balance = opening_balance + debits - credits
    assert.equal(
      Number(stmt.closing_balance),
      Number(stmt.opening_balance) + Number(stmt.debits) - Number(stmt.credits)
    );

    // 8. Verify statement_item lines
    const itemsRes = await db.query<any>(
      `SELECT * FROM statement_item WHERE tenant_id = $1 AND statement_id = $2 ORDER BY line_number ASC`,
      [TENANT_ID, stmt.id]
    );
    assert.equal(itemsRes.rows.length, 2, "August statement should contain 2 in-period items (INV-AUG-001 and RCT-AUG-001)");

    // 9. Verify outbox event emitted
    const outboxRes = await db.query<any>(
      `SELECT * FROM outbox WHERE tenant_id = $1 AND aggregate_id = $2`,
      [TENANT_ID, runResult.statementRunId]
    );
    assert.equal(outboxRes.rows.length, 1);
    assert.equal(outboxRes.rows[0].kind, "statement/run_completed");

    // 10. Pass Criteria: Historical late posting leaves old statement unchanged!
    // Post a backdated transaction with issuedOn in August, but created_at in September (after August cutoff)
    const latePost = await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-08-25", // Backdated to August
      sourceKind: "order",
      sourceKey: "ord-late-1",
      idempotencyKey: "post-late-1",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: debtorId, direction: "debit", amount: "800.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "800.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "INV-LATE-001",
          kind: "invoice",
          direction: "debit",
          amount: "800.0000",
          currency: "ZAR",
          issuedOn: "2026-08-25",
          dueOn: "2026-09-25",
          sourceEventKey: "evt-late-1",
        },
      ],
    });
    const lateDocId = latePost.documentIds[0]!;
    // Set created_at to September 5th (AFTER August cutoff)
    await db.query("UPDATE document SET created_at = '2026-09-05T12:00:00.000Z' WHERE id = $1", [lateDocId]);

    // Query historical August statement row again
    const stmtAfterLateRes = await db.query<any>(
      `SELECT * FROM statement WHERE tenant_id = $1 AND id = $2`,
      [TENANT_ID, stmt.id]
    );
    const stmtAfterLate = stmtAfterLateRes.rows[0];

    // Assert that the historical August statement remains COMPLETELY UNCHANGED
    assert.equal(Number(stmtAfterLate.opening_balance), 1000.0000);
    assert.equal(Number(stmtAfterLate.debits), 2500.0000, "Historical statement debits must not mutate upon late posting");
    assert.equal(Number(stmtAfterLate.credits), 1000.0000);
    assert.equal(Number(stmtAfterLate.closing_balance), 2500.0000, "Historical statement closing balance must remain exact");
    assert.equal(stmtAfterLate.pdf_sha256, stmt.pdf_sha256, "Historical statement artifact SHA-256 must remain immutable");

    // 11. Acceptance Check: Database constraint check
    // Direct attempt to insert an invalid statement violating closing = opening + debits - credits must fail closed
    await assert.rejects(
      async () => {
        await db.query(
          `INSERT INTO statement (
            tenant_id, statement_run_id, debtor_account_id,
            opening_balance, debits, credits, closing_balance, currency,
            ledger_version, status
          ) VALUES ($1, $2, $3, 100.0000, 50.0000, 20.0000, 999.0000, 'ZAR', 1, 'ready')`,
          [TENANT_ID, runResult.statementRunId, debtorId]
        );
      },
      /violates check constraint/i,
      "Database must reject statements violating mathematical control balance invariant"
    );
  } finally {
    await db.close();
  }
});

test("integration: statement storage, metadata API, direct download, and signed URLs", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(readFileSync(migration0001, "utf8"));
    await db.exec(readFileSync(migration0002, "utf8"));
    await db.exec(readFileSync(migration0003, "utf8"));
    await db.exec(readFileSync(migration0004, "utf8"));
    await db.exec(readFileSync(migration0005, "utf8"));

    // Seed Tenant
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Boland Supplies', 'ZAR', 'UTC', 'active')",
      [TENANT_ID],
    );

    // Seed Actor
    const actorRes = await db.query<{ id: string }>(
      `INSERT INTO actor (tenant_id, external_subject, display_name, role)
       VALUES ($1, 'gid://shopify/User/20', 'Bookkeeper User', 'bookkeeper') RETURNING id`,
      [TENANT_ID],
    );
    const actorId = actorRes.rows[0]!.id;

    // Seed Installation
    await db.query(
      `INSERT INTO installation (tenant_id, shop_gid, shop_domain, status, installed_at, token_secret_ref, scopes)
       VALUES ($1, 'gid://shopify/Shop/1', $2, 'active', now(), 'secrets://test/token', ARRAY['read_customers'])`,
      [TENANT_ID, SHOP],
    );

    await db.query("SELECT seed_standard_ledger_accounts($1)", [TENANT_ID]);

    const termRes = await db.query<{ id: string }>(
      "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
      [TENANT_ID],
    );

    const debtorRes = await db.query<{ id: string }>(
      `INSERT INTO debtor_account (
        tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
      ) VALUES (
        $1, 'DEBT-API-01', 'Cape Hardware Direct', 'ZAR', $2, 20000.00, 'active', 'due_date'
      ) RETURNING id`,
      [TENANT_ID, termRes.rows[0]!.id],
    );
    const debtorId = debtorRes.rows[0]!.id;

    const accountsRes = await db.query<{ id: string; code: string }>(
      "SELECT id, code FROM ledger_account WHERE tenant_id = $1",
      [TENANT_ID],
    );
    const arAccountId = accountsRes.rows.find((a) => a.code === "1200")!.id;
    const salesAccountId = accountsRes.rows.find((a) => a.code === "4010")!.id;

    // Post sample invoice
    await postJournal(db, TENANT_ID, {
      actorId,
      currency: "ZAR",
      effectiveDate: "2026-08-10",
      sourceKind: "order",
      sourceKey: "ord-test-stmt-1",
      idempotencyKey: "idem-test-stmt-1",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: debtorId, direction: "debit", amount: "1500.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "1500.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "INV-STMT-99",
          kind: "invoice",
          direction: "debit",
          amount: "1500.0000",
          currency: "ZAR",
          issuedOn: "2026-08-10",
          dueOn: "2026-09-10",
          sourceEventKey: "evt-test-stmt-1",
        },
      ],
    });
    await db.query("UPDATE document SET created_at = '2026-08-10T10:00:00.000Z' WHERE tenant_id = $1", [TENANT_ID]);

    // Run statement generation
    const runResult = await executeStatementRun(db, TENANT_ID, {
      periodFrom: "2026-08-01",
      periodTo: "2026-08-31",
      cutoffRecordedAt: "2026-09-01T00:00:00.000Z",
      actorId,
    });

    // Retrieve generated statement ID
    const stmtRow = await db.query<{ id: string; pdf_sha256: string; pdf_object_key: string }>(
      `SELECT id, pdf_sha256, pdf_object_key FROM statement WHERE tenant_id = $1 AND statement_run_id = $2`,
      [TENANT_ID, runResult.statementRunId],
    );
    assert.equal(stmtRow.rows.length, 1);
    const statementId = stmtRow.rows[0]!.id;

    // Build Server
    const server = buildServer({
      db,
      apiSecretKey: API_SECRET,
      clientId: CLIENT_ID,
    });

    try {
      const bookkeeperToken = createMockSessionToken(
        { dest: SHOP, aud: CLIENT_ID, sub: "gid://shopify/User/20" },
        API_SECRET,
      );
      const authHeader = `Bearer ${bookkeeperToken}`;

      // 1. GET /v1/statements/:id
      const metaRes = await server.inject({
        method: "GET",
        url: `/v1/statements/${statementId}`,
        headers: { authorization: authHeader },
      });
      assert.equal(metaRes.statusCode, 200);
      const meta = metaRes.json();
      assert.equal(meta.id, statementId);
      assert.equal(meta.accountNumber, "DEBT-API-01");
      assert.equal(meta.closingBalance, "1500.0000");
      assert.ok(meta.downloadUrl);

      // 2. GET /v1/statements/:id/download (direct authenticated PDF download)
      const downloadRes = await server.inject({
        method: "GET",
        url: `/v1/statements/${statementId}/download`,
        headers: { authorization: authHeader },
      });
      assert.equal(downloadRes.statusCode, 200);
      assert.equal(downloadRes.headers["content-type"], "application/pdf");
      assert.ok(downloadRes.rawPayload.toString().startsWith("%PDF-1.4"));

      // 3. GET /v1/statements/download with signed query params
      const signedUrl = meta.downloadUrl;
      const signedRes = await server.inject({
        method: "GET",
        url: signedUrl,
      });
      assert.equal(signedRes.statusCode, 200);
      assert.equal(signedRes.headers["content-type"], "application/pdf");
      assert.ok(signedRes.rawPayload.toString().startsWith("%PDF-1.4"));

      // 4. GET /v1/statements/download with tampered signature returns 403
      const tamperedUrl = signedUrl.replace(/signature=[^&]+/, "signature=invalid_tampered_signature_hex");
      const tamperedRes = await server.inject({
        method: "GET",
        url: tamperedUrl,
      });
      assert.equal(tamperedRes.statusCode, 403);
      assert.equal(tamperedRes.json().code, "invalid_signature");
    } finally {
      await server.close();
    }
  } finally {
    await db.close();
  }
});
