import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import { initApiDatabase } from "../../apps/api/src/db.ts";
import { buildServer } from "../../apps/api/src/server.ts";
import { createMockSessionToken } from "../../apps/api/src/auth/shopify.ts";
import {
  MockStatementEmailProvider,
  setStatementEmailProvider,
} from "../../packages/domain/src/delivery.ts";
import {
  createCreditReservation,
  computeCartDigest,
} from "../../packages/domain/src/credit.ts";
import { buildAgingSnapshot } from "../../packages/domain/src/aging.ts";
import { getDebtorBalanceSummary } from "../../packages/domain/src/allocation.ts";
import { seedSyntheticDemo } from "../../scripts/seed-synthetic-demo.ts";

const API_SECRET = "shpss_test_secret_key_12345";
const CLIENT_ID = "test_client_id_67890";
const PRIMARY_SHOP = "displaydeck.myshopify.com";
const SECONDARY_SHOP = "apex-building.myshopify.com";
const TENANT_A_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_B_ID = "44444444-4444-4444-8444-444444444444";

describe("E2E Demo Spec: Genesis Trade Suite Repeatable Owner Scenario (TASK-042)", () => {
  it("executes complete synthetic trade lifecycle, validates financial fidelity, and survives database reboot with zero drift", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-e2e-demo-"));
    const mockEmail = new MockStatementEmailProvider();
    setStatementEmailProvider(mockEmail);

    let debtorAId: string;
    let debtorHoldId: string;
    let debtorClosedId: string;
    let inv1Id: string;
    let inv2Id: string;
    let inv3Id: string;
    let statementId: string;
    let originalPdfSha256: string;

    try {
      // =========================================================================
      // PHASE 1: Active Execution against Initial Database Instance (db1)
      // =========================================================================
      const db1 = await initApiDatabase({
        dataDir: tempDir,
        seedDemo: false,
      });

      const server1 = buildServer({
        db: db1,
        apiSecretKey: API_SECRET,
        clientId: CLIENT_ID,
      });

      const bookkeeperToken = createMockSessionToken(
        { dest: PRIMARY_SHOP, aud: CLIENT_ID, sub: "gid://shopify/User/20" },
        API_SECRET,
      );
      const authHeader = `Bearer ${bookkeeperToken}`;

      const tenantBToken = createMockSessionToken(
        { dest: SECONDARY_SHOP, aud: CLIENT_ID, sub: "gid://shopify/User/100" },
        API_SECRET,
      );

      try {
        // -----------------------------------------------------------------------
        // Step 1: Execute Synthetic Seeder & Verify Multi-Tenant Bootstrap
        // -----------------------------------------------------------------------
        const seedResult = await seedSyntheticDemo(db1, {
          tenantAId: TENANT_A_ID,
          tenantBId: TENANT_B_ID,
          primaryShop: PRIMARY_SHOP,
          secondaryShop: SECONDARY_SHOP,
        });

        assert.ok(seedResult.success, "Seeding must complete successfully");
        assert.equal(seedResult.alreadySeeded, false, "Initial seed run must report alreadySeeded: false");

        debtorAId = seedResult.accounts.ubuntuHardware.id;
        debtorHoldId = seedResult.accounts.highveldIndustrial.id;
        debtorClosedId = seedResult.accounts.durbanMarine.id;
        inv1Id = seedResult.documents.inv1001.id;
        inv2Id = seedResult.documents.inv1002.id;
        inv3Id = seedResult.documents.inv2001.id;

        // Idempotency check: Running seeder again creates zero duplicate records
        const repeatSeed = await seedSyntheticDemo(db1, {
          tenantAId: TENANT_A_ID,
          tenantBId: TENANT_B_ID,
          primaryShop: PRIMARY_SHOP,
          secondaryShop: SECONDARY_SHOP,
        });
        assert.equal(repeatSeed.alreadySeeded, true, "Seeder must detect existing fixtures idempotently");

        // -----------------------------------------------------------------------
        // Step 2: Baseline Balances & 8-Bucket Aging Assertions
        // -----------------------------------------------------------------------
        const initialSummary = await getDebtorBalanceSummary(db1, TENANT_A_ID, debtorAId);
        assert.equal(initialSummary.totalOpenDebit, "6300.0000");
        assert.equal(initialSummary.unappliedCredit, "0.0000");
        assert.equal(initialSummary.netBalance, "6300.0000");

        // General Ledger AR Account (1200) Check across all accounts on Tenant A:
        // ACC-001 (6300) + ACC-002 (-2500) + ACC-003 (11500) = 15300
        const initialArCheck = await db1.query<{ balance: string }>(
          `SELECT coalesce(sum(jl.debit - jl.credit), 0) as balance
           FROM journal_line jl
           JOIN ledger_account la ON la.id = jl.ledger_account_id AND la.tenant_id = jl.tenant_id
           WHERE jl.tenant_id = $1 AND la.code = '1200'`,
          [TENANT_A_ID],
        );
        assert.equal(parseFloat(initialArCheck.rows[0]!.balance), 15300);

        const aging = await buildAgingSnapshot(db1, TENANT_A_ID, {
          debtorAccountId: debtorAId,
          asOfDate: "2026-09-29",
          basis: "due_date",
        });
        assert.equal(aging.buckets.d060, "2000.0000", "INV-2026-001 remainder (3200 - 1200 alloc) is in d060");
        assert.equal(aging.buckets.d030, "1500.0000", "INV-2026-002 is in d030");
        assert.equal(aging.buckets.current, "2800.0000", "INV-2026-003 is in current");
        assert.equal(aging.netBalance, "6300.0000", "Aging net balance matches ledger");

        // -----------------------------------------------------------------------
        // Step 3: Credit Checks (Approved vs Hold vs Limit Exceeded vs Closed)
        // -----------------------------------------------------------------------
        const locRes = await db1.query<{ id: string }>(
          "SELECT id FROM location WHERE tenant_id = $1 LIMIT 1",
          [TENANT_A_ID],
        );
        const locationId = locRes.rows[0]!.id;

        // 3A: Active account within limit (1,200 against 18,700 available) -> Approved
        const appRes = await createCreditReservation(db1, TENANT_A_ID, {
          actorId: seedResult.actors.cashierId,
          debtorAccountId: debtorAId,
          locationId,
          amount: "1200.0000",
          currency: "ZAR",
          cartDigest: computeCartDigest("cart-e2e-approved"),
          idempotencyKey: "e2e-resv-approved",
        });
        assert.equal(appRes.approved, true);
        assert.equal(appRes.status, "reserved");
        assert.equal(appRes.availableAfter, "17500.0000");

        // 3B: On-hold account (ACC-003) -> Blocked
        const holdRes = await createCreditReservation(db1, TENANT_A_ID, {
          actorId: seedResult.actors.cashierId,
          debtorAccountId: debtorHoldId,
          locationId,
          amount: "1000.0000",
          currency: "ZAR",
          cartDigest: computeCartDigest("cart-e2e-hold"),
          idempotencyKey: "e2e-resv-hold",
        });
        assert.equal(holdRes.approved, false);
        assert.equal(holdRes.status, "blocked");

        // 3C: Active account exceeding limit (25,000 against 17,500 available) -> Requires override
        const limitRes = await createCreditReservation(db1, TENANT_A_ID, {
          actorId: seedResult.actors.cashierId,
          debtorAccountId: debtorAId,
          locationId,
          amount: "25000.0000",
          currency: "ZAR",
          cartDigest: computeCartDigest("cart-e2e-exceed"),
          idempotencyKey: "e2e-resv-exceed",
        });
        assert.equal(limitRes.approved, false);
        assert.equal(limitRes.status, "requires_override");
        assert.equal(limitRes.shortfall, "7500.0000");

        // 3D: Closed account (ACC-004) -> Blocked
        const closedRes = await createCreditReservation(db1, TENANT_A_ID, {
          actorId: seedResult.actors.cashierId,
          debtorAccountId: debtorClosedId,
          locationId,
          amount: "500.0000",
          currency: "ZAR",
          cartDigest: computeCartDigest("cart-e2e-closed"),
          idempotencyKey: "e2e-resv-closed",
        });
        assert.equal(closedRes.approved, false);
        assert.equal(closedRes.status, "blocked");

        // -----------------------------------------------------------------------
        // Step 4: Payment Receipt Posting (Partial Payment via API)
        // -----------------------------------------------------------------------
        const payRes1 = await server1.inject({
          method: "POST",
          url: "/v1/payments",
          headers: {
            authorization: authHeader,
            "idempotency-key": "e2e-idem-pay-01",
          },
          payload: {
            debtorAccountId: debtorAId,
            amount: "2000.00",
            currency: "ZAR",
            paymentMethod: "bank_transfer",
            paymentMode: "external_receipt",
            effectiveDate: "2026-09-29",
            reference: "EFT-DEMO-01",
            memo: "Partial settlement for INV-2026-001 remainder",
            autoAllocate: false,
          },
        });
        assert.equal(payRes1.statusCode, 201);
        const payData1 = JSON.parse(payRes1.body);
        const rct1DocId = payData1.documentId;
        assert.ok(rct1DocId);

        // -----------------------------------------------------------------------
        // Step 5: FIFO Oldest-First Allocation & Overpayment Handling
        // -----------------------------------------------------------------------
        // Allocate RCT 1 (2,000 ZAR) oldest-first:
        // Fully pays the remaining 2,000 of INV-2026-001
        const allocRes1 = await server1.inject({
          method: "POST",
          url: "/v1/allocations",
          headers: {
            authorization: authHeader,
            "idempotency-key": "e2e-idem-alloc-01",
          },
          payload: {
            debtorAccountId: debtorAId,
            mode: "oldest_first",
            creditDocumentId: rct1DocId,
            effectiveDate: "2026-09-29",
          },
        });
        assert.equal(allocRes1.statusCode, 201);

        // Post overpayment RCT 2 (6,000 ZAR)
        const payRes2 = await server1.inject({
          method: "POST",
          url: "/v1/payments",
          headers: {
            authorization: authHeader,
            "idempotency-key": "e2e-idem-pay-02",
          },
          payload: {
            debtorAccountId: debtorAId,
            amount: "6000.00",
            currency: "ZAR",
            paymentMethod: "bank_transfer",
            paymentMode: "external_receipt",
            effectiveDate: "2026-09-29",
            reference: "EFT-DEMO-02",
            memo: "Second payment satisfying open invoices with unapplied cash remainder",
            autoAllocate: false,
          },
        });
        assert.equal(payRes2.statusCode, 201);
        const rct2DocId = JSON.parse(payRes2.body).documentId;

        // Allocate RCT 2 oldest-first:
        // Satisfies INV-2026-002 (1,500) and INV-2026-003 (2,800), total 4,300.
        // Leaves 1,700 ZAR unapplied cash remainder!
        const allocRes2 = await server1.inject({
          method: "POST",
          url: "/v1/allocations",
          headers: {
            authorization: authHeader,
            "idempotency-key": "e2e-idem-alloc-02",
          },
          payload: {
            debtorAccountId: debtorAId,
            mode: "oldest_first",
            creditDocumentId: rct2DocId,
            effectiveDate: "2026-09-29",
          },
        });
        assert.equal(allocRes2.statusCode, 201);
        const allocData2 = JSON.parse(allocRes2.body);

        // Locate allocation for INV-2026-003
        const inv3Alloc = allocData2.allocations.find((a: any) => a.debitDocumentId === inv3Id);
        assert.ok(inv3Alloc, "INV-2026-003 allocation must be recorded");
        const inv3AllocId = inv3Alloc.allocationId || inv3Alloc.id;

        const overpaymentSummary = await getDebtorBalanceSummary(db1, TENANT_A_ID, debtorAId);
        assert.equal(overpaymentSummary.totalOpenDebit, "0.0000");
        assert.equal(overpaymentSummary.unappliedCredit, "1700.0000");
        assert.equal(overpaymentSummary.netBalance, "-1700.0000");

        // -----------------------------------------------------------------------
        // Step 6: Immutable Reversal & Open Balance Restoration
        // -----------------------------------------------------------------------
        const revRes = await server1.inject({
          method: "POST",
          url: `/v1/allocations/${inv3AllocId}/reverse`,
          headers: {
            authorization: authHeader,
            "idempotency-key": "e2e-idem-rev-01",
          },
          payload: {
            reason: "Allocation adjustment per customer audit",
            effectiveDate: "2026-09-29",
          },
        });
        assert.equal(revRes.statusCode, 200);

        const revSummary = await getDebtorBalanceSummary(db1, TENANT_A_ID, debtorAId);
        assert.equal(revSummary.totalOpenDebit, "2800.0000", "INV-2026-003 is open again with 2,800");
        assert.equal(revSummary.unappliedCredit, "4500.0000", "RCT-DEMO-02 has 4,500 unapplied (1,700 + 2,800 restored)");
        assert.equal(revSummary.netBalance, "-1700.0000", "Net balance is preserved at -1,700");

        // Duplicate reversal rejected with 409 Conflict
        const dupRev = await server1.inject({
          method: "POST",
          url: `/v1/allocations/${inv3AllocId}/reverse`,
          headers: {
            authorization: authHeader,
            "idempotency-key": "e2e-idem-rev-dup",
          },
          payload: {
            reason: "Attempt duplicate reversal",
            effectiveDate: "2026-09-29",
          },
        });
        assert.equal(dupRev.statusCode, 409);

        // -----------------------------------------------------------------------
        // Step 7: Statement Generation, Binary PDF Existence & SHA-256 Validation
        // -----------------------------------------------------------------------
        const runRes = await server1.inject({
          method: "POST",
          url: "/v1/statements/run",
          headers: {
            authorization: authHeader,
            "idempotency-key": "e2e-idem-statement-run-01",
          },
          payload: {
            debtorAccountId: debtorAId,
            periodFrom: "2026-09-01",
            periodTo: "2026-09-30",
          },
        });
        assert.equal(runRes.statusCode, 201);
        const runResult = JSON.parse(runRes.body);
        assert.ok(runResult.statementId);

        const repeatedRunRes = await server1.inject({
          method: "POST",
          url: "/v1/statements/run",
          headers: {
            authorization: authHeader,
            "idempotency-key": "e2e-idem-statement-run-01",
          },
          payload: {
            debtorAccountId: debtorAId,
            periodFrom: "2026-09-01",
            periodTo: "2026-09-30",
          },
        });
        assert.equal(repeatedRunRes.statusCode, 201);
        assert.equal(repeatedRunRes.headers["idempotent-replayed"], "true");
        assert.equal(JSON.parse(repeatedRunRes.body).statementId, runResult.statementId);

        const stmtRow = await db1.query<{ id: string; pdf_sha256: string; closing_balance: string }>(
          "SELECT id, pdf_sha256, closing_balance FROM statement WHERE tenant_id = $1 AND statement_run_id = $2 AND debtor_account_id = $3",
          [TENANT_A_ID, runResult.statementRunId, debtorAId],
        );
        assert.equal(stmtRow.rows.length, 1);
        statementId = stmtRow.rows[0]!.id;
        originalPdfSha256 = stmtRow.rows[0]!.pdf_sha256;
        assert.equal(originalPdfSha256.length, 64);
        assert.equal(parseFloat(stmtRow.rows[0]!.closing_balance), -1700);

        const pdfDownloadRes = await server1.inject({
          method: "GET",
          url: `/v1/statements/${statementId}/download`,
          headers: { authorization: authHeader },
        });
        assert.equal(pdfDownloadRes.statusCode, 200);
        assert.equal(pdfDownloadRes.headers["content-type"], "application/pdf");
        assert.ok(pdfDownloadRes.rawPayload.toString().startsWith("%PDF-1.4"));

        const computedSha256 = crypto
          .createHash("sha256")
          .update(pdfDownloadRes.rawPayload)
          .digest("hex");
        assert.equal(computedSha256, originalPdfSha256, "Binary PDF SHA-256 must match exactly");

        // -----------------------------------------------------------------------
        // Step 8: Email Capture Check & Multi-Tenant Isolation
        // -----------------------------------------------------------------------
        mockEmail.clearSent();
        setStatementEmailProvider(mockEmail);
        const deliverRes = await server1.inject({
          method: "POST",
          url: `/v1/statements/${statementId}/deliver`,
          headers: {
            authorization: authHeader,
            "idempotency-key": "e2e-idem-deliver-02",
          },
          payload: {
            recipientEmail: "accounts@ubuntuhardware.co.za",
            immediate: true,
          },
        });
        assert.equal(deliverRes.statusCode, 200);
        assert.equal(mockEmail.sentEmails.length, 1);
        assert.equal(mockEmail.sentEmails[0]!.recipientEmail, "accounts@ubuntuhardware.co.za");
        assert.equal(mockEmail.sentEmails[0]!.closingBalance, "-1700.0000");

        // Multi-tenant isolation: Tenant B cannot access Tenant A statement
        const crossTenantRes = await server1.inject({
          method: "GET",
          url: `/v1/statements/${statementId}`,
          headers: { authorization: `Bearer ${tenantBToken}` },
        });
        assert.equal(crossTenantRes.statusCode, 404, "Tenant B cannot view Tenant A statements");

        // -----------------------------------------------------------------------
        // Step 9: Pre-Shutdown Snapshot & Clean Close
        // -----------------------------------------------------------------------
        const preShutdownArRes = await db1.query<{ balance: string }>(
          `SELECT coalesce(sum(jl.debit - jl.credit), 0) as balance
           FROM journal_line jl
           JOIN ledger_account la ON la.id = jl.ledger_account_id AND la.tenant_id = jl.tenant_id
           WHERE jl.tenant_id = $1 AND la.code = '1200'`,
          [TENANT_A_ID],
        );
        const preShutdownArBalance = parseFloat(preShutdownArRes.rows[0]!.balance);
      } finally {
        await server1.close();
        await db1.close?.();
      }

      // =========================================================================
      // PHASE 2: Database Restart & Zero-Drift Persistence Verification (db2)
      // =========================================================================
      const db2 = await initApiDatabase({
        dataDir: tempDir,
        seedDemo: false,
      });

      const server2 = buildServer({
        db: db2,
        apiSecretKey: API_SECRET,
        clientId: CLIENT_ID,
      });

      try {
        // Step 10 & 11: Verify schema migrations survived reboot cleanly
        const migrationCheck = await db2.query<{ version: string }>("SELECT version FROM schema_migrations");
        assert.ok(migrationCheck.rows.length >= 5);

        // Step 12: Verify AR ledger balance is EXACTLY preserved without drift
        // Initial 15300 - 2000 (EFT1) - 6000 (EFT2) = 7300
        const afterRebootAr = await db2.query<{ balance: string }>(
          `SELECT coalesce(sum(jl.debit - jl.credit), 0) as balance
           FROM journal_line jl
           JOIN ledger_account la ON la.id = jl.ledger_account_id AND la.tenant_id = jl.tenant_id
           WHERE jl.tenant_id = $1 AND la.code = '1200'`,
          [TENANT_A_ID],
        );
        assert.equal(
          parseFloat(afterRebootAr.rows[0]!.balance),
          7300,
          "AR ledger balance must survive process reboot with exact zero financial drift",
        );

        // Verify Debtor account balances survived
        const debtorCheck = await getDebtorBalanceSummary(db2, TENANT_A_ID, debtorAId);
        assert.equal(debtorCheck.totalOpenDebit, "2800.0000");
        assert.equal(debtorCheck.unappliedCredit, "4500.0000");
        assert.equal(debtorCheck.netBalance, "-1700.0000");

        // Verify Credit Hold account persisted
        const holdCheck = await db2.query<{ status: string; hold_reason: string }>(
          "SELECT status, hold_reason FROM debtor_account WHERE tenant_id = $1 AND id = $2",
          [TENANT_A_ID, debtorHoldId],
        );
        assert.equal(holdCheck.rows[0]!.status, "hold");

        // Verify Statement & PDF SHA-256 survived reboot
        const stmtCheck = await db2.query<{ pdf_sha256: string }>(
          "SELECT pdf_sha256 FROM statement WHERE tenant_id = $1 AND id = $2",
          [TENANT_A_ID, statementId],
        );
        assert.equal(stmtCheck.rows[0]!.pdf_sha256, originalPdfSha256);

        // Verify Delivery status survived reboot
        const deliveryCheck = await db2.query<{ status: string }>(
          "SELECT status FROM statement_delivery WHERE tenant_id = $1 AND statement_id = $2",
          [TENANT_A_ID, statementId],
        );
        assert.equal(deliveryCheck.rows[0]!.status, "accepted");

        // Step 13: Verify Idempotent Seeder Re-Execution against Rebooted DB
        const rebootSeed = await seedSyntheticDemo(db2, {
          tenantAId: TENANT_A_ID,
          tenantBId: TENANT_B_ID,
          primaryShop: PRIMARY_SHOP,
          secondaryShop: SECONDARY_SHOP,
        });
        assert.equal(rebootSeed.alreadySeeded, true, "Seeder must remain idempotent after reboot");

        // Step 14: Post-Reboot Mutation check: Post final settlement journal
        const finalPay = await server2.inject({
          method: "POST",
          url: "/v1/payments",
          headers: {
            authorization: `Bearer ${createMockSessionToken(
              { dest: PRIMARY_SHOP, aud: CLIENT_ID, sub: "gid://shopify/User/20" },
              API_SECRET,
            )}`,
            "idempotency-key": "e2e-idem-pay-reboot",
          },
          payload: {
            debtorAccountId: debtorAId,
            amount: "1000.00",
            currency: "ZAR",
            paymentMethod: "cash",
            paymentMode: "external_receipt",
            effectiveDate: "2026-09-29",
            reference: "CASH-REBOOT-01",
            memo: "Cash payment settling final account credit balance",
            autoAllocate: false,
          },
        });
        assert.equal(finalPay.statusCode, 201);

        const finalArCheck = await db2.query<{ balance: string }>(
          `SELECT coalesce(sum(jl.debit - jl.credit), 0) as balance
           FROM journal_line jl
           JOIN ledger_account la ON la.id = jl.ledger_account_id AND la.tenant_id = jl.tenant_id
           WHERE jl.tenant_id = $1 AND la.code = '1200'`,
          [TENANT_A_ID],
        );
        assert.equal(parseFloat(finalArCheck.rows[0]!.balance), 6300);
      } finally {
        await server2.close();
        await db2.close?.();
      }
    } finally {
      // Step 15: Clean Resource Teardown
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
