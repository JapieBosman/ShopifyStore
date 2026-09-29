import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { postJournal } from "../../packages/domain/src/posting.ts";
import { executeStatementRun } from "../../apps/worker/src/statements.ts";
import { buildServer } from "../../apps/api/src/server.ts";
import { createMockSessionToken } from "../../apps/api/src/auth/shopify.ts";
import {
  MockStatementEmailProvider,
  setStatementEmailProvider,
} from "../../packages/domain/src/delivery.ts";
import {
  enqueueStatementDelivery,
  processQueuedDeliveries,
  reconcileUncertainDeliveries,
  getStatementDeliveries,
} from "../../apps/worker/src/delivery.ts";

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

const TENANT_A_ID = "77777777-7777-4777-8777-777777777777";
const TENANT_B_ID = "88888888-8888-4888-8888-888888888888";
const API_SECRET = "shpss_test_secret_key_12345";
const CLIENT_ID = "test_client_id_67890";
const SHOP_A = "boland-construction.myshopify.com";
const SHOP_B = "cape-hardware.myshopify.com";

test("integration: statement delivery - preview, send, idempotency, deferred SMS, RBAC, and callbacks", async () => {
  const db = await PGlite.create();
  const mockEmail = new MockStatementEmailProvider();
  setStatementEmailProvider(mockEmail);

  try {
    // 1. Run migrations in sequence
    await db.exec(readFileSync(migration0001, "utf8"));
    await db.exec(readFileSync(migration0002, "utf8"));
    await db.exec(readFileSync(migration0003, "utf8"));
    await db.exec(readFileSync(migration0004, "utf8"));
    await db.exec(readFileSync(migration0005, "utf8"));

    // 2. Seed Tenant A & Tenant B
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Tenant A', 'ZAR', 'UTC', 'active')",
      [TENANT_A_ID],
    );
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Tenant B', 'ZAR', 'UTC', 'active')",
      [TENANT_B_ID],
    );

    // Seed actors with matching shopify user subjects
    const actorARes = await db.query<{ id: string }>(
      `INSERT INTO actor (tenant_id, external_subject, display_name, role)
       VALUES ($1, 'gid://shopify/User/bookkeeper-1', 'Senior Bookkeeper', 'bookkeeper') RETURNING id`,
      [TENANT_A_ID],
    );
    const actorAId = actorARes.rows[0]!.id;

    await db.query(
      `INSERT INTO actor (tenant_id, external_subject, display_name, role)
       VALUES ($1, 'gid://shopify/User/cashier-1', 'Junior Cashier', 'cashier')`,
      [TENANT_A_ID],
    );

    await db.query(
      `INSERT INTO actor (tenant_id, external_subject, display_name, role)
       VALUES ($1, 'gid://shopify/User/manager-b', 'Store Manager', 'manager')`,
      [TENANT_B_ID],
    );

    // Seed Installations for both shops
    await db.query(
      `INSERT INTO installation (tenant_id, shop_gid, shop_domain, status, installed_at, token_secret_ref, scopes)
       VALUES ($1, 'gid://shopify/Shop/1', $2, 'active', now(), 'secrets://test/token1', ARRAY['read_customers'])`,
      [TENANT_A_ID, SHOP_A],
    );
    await db.query(
      `INSERT INTO installation (tenant_id, shop_gid, shop_domain, status, installed_at, token_secret_ref, scopes)
       VALUES ($1, 'gid://shopify/Shop/2', $2, 'active', now(), 'secrets://test/token2', ARRAY['read_customers'])`,
      [TENANT_B_ID, SHOP_B],
    );

    await db.query("SELECT seed_standard_ledger_accounts($1)", [TENANT_A_ID]);
    await db.query("SELECT seed_standard_ledger_accounts($1)", [TENANT_B_ID]);

    const termRes = await db.query<{ id: string }>(
      "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
      [TENANT_A_ID],
    );
    const termId = termRes.rows[0]!.id;

    // Seed debtor account
    const debtorRes = await db.query<{ id: string }>(
      `INSERT INTO debtor_account (
        tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
      ) VALUES (
        $1, 'DEBT-DELIVERY-01', 'Premier Building Supplies', 'ZAR', $2, 60000.00, 'active', 'due_date'
      ) RETURNING id`,
      [TENANT_A_ID, termId],
    );
    const debtorId = debtorRes.rows[0]!.id;
    const accountsRes = await db.query<{ id: string; code: string }>(
      "SELECT id, code FROM ledger_account WHERE tenant_id = $1",
      [TENANT_A_ID],
    );
    const arAccountId = accountsRes.rows.find((a) => a.code === "1200")!.id;
    const salesAccountId = accountsRes.rows.find((a) => a.code === "4010")!.id;

    // Post sample invoice
    await postJournal(db, TENANT_A_ID, {
      actorId: actorAId,
      currency: "ZAR",
      effectiveDate: "2026-08-10",
      sourceKind: "order",
      sourceKey: "ord-delivery-1",
      idempotencyKey: "post-delivery-1",
      lines: [
        {
          ledgerAccountId: arAccountId,
          debtorAccountId: debtorId,
          direction: "debit",
          amount: "12500.0000",
          currency: "ZAR",
        },
        {
          ledgerAccountId: salesAccountId,
          direction: "credit",
          amount: "12500.0000",
          currency: "ZAR",
        },
      ],
      documents: [
        {
          debtorAccountId: debtorId,
          documentNumber: "INV-AUG-001",
          kind: "invoice",
          direction: "debit",
          amount: "12500.0000",
          currency: "ZAR",
          issuedOn: "2026-08-10",
          dueOn: "2026-09-09",
          sourceEventKey: "evt-aug-1",
        },
      ],
    });
    await db.query("UPDATE document SET created_at = '2026-08-10T10:00:00.000Z' WHERE tenant_id = $1", [TENANT_A_ID]);

    // Generate Statement Run
    const runResult = await executeStatementRun(db, TENANT_A_ID, {
      periodFrom: "2026-08-01",
      periodTo: "2026-08-31",
      cutoffRecordedAt: new Date(Date.now() + 60000).toISOString(),
      actorId: actorAId,
    });

    const stmtRes = await db.query<{ id: string; pdf_object_key: string }>(
      `SELECT id, pdf_object_key FROM statement WHERE tenant_id = $1 AND statement_run_id = $2`,
      [TENANT_A_ID, runResult.statementRunId],
    );
    assert.equal(stmtRes.rows.length, 1);
    const statementId = stmtRes.rows[0]!.id;
    assert.ok(stmtRes.rows[0]!.pdf_object_key);

    // Boot API server
    const server = buildServer({
      db,
      apiSecretKey: API_SECRET,
      clientId: CLIENT_ID,
    });

    // -------------------------------------------------------------
    // Test 1: RBAC - Cashier cannot trigger statement delivery
    // -------------------------------------------------------------
    const cashierToken = createMockSessionToken(
      { dest: SHOP_A, aud: CLIENT_ID, sub: "gid://shopify/User/cashier-1" },
      API_SECRET,
    );

    const cashierRes = await server.inject({
      method: "POST",
      url: `/v1/statements/${statementId}/deliver`,
      headers: {
        authorization: `Bearer ${cashierToken}`,
        "idempotency-key": "idem-cashier-attempt",
      },
      payload: {
        recipientEmail: "accounts@premier.co.za",
      },
    });
    assert.equal(cashierRes.statusCode, 403, "Cashier role must be rejected with 403");

    // -------------------------------------------------------------
    // Test 2: Missing Idempotency-Key is rejected with 400
    // -------------------------------------------------------------
    const bookkeeperToken = createMockSessionToken(
      { dest: SHOP_A, aud: CLIENT_ID, sub: "gid://shopify/User/bookkeeper-1" },
      API_SECRET,
    );

    const noIdemRes = await server.inject({
      method: "POST",
      url: `/v1/statements/${statementId}/deliver`,
      headers: {
        authorization: `Bearer ${bookkeeperToken}`,
      },
      payload: {
        recipientEmail: "accounts@premier.co.za",
      },
    });
    assert.equal(noIdemRes.statusCode, 400);
    assert.equal(JSON.parse(noIdemRes.body).code, "missing_idempotency_key");

    // -------------------------------------------------------------
    // Test 3: SMS delivery is explicitly deferred in v1 (422)
    // -------------------------------------------------------------
    const smsRes = await server.inject({
      method: "POST",
      url: `/v1/statements/${statementId}/deliver`,
      headers: {
        authorization: `Bearer ${bookkeeperToken}`,
        "idempotency-key": "idem-sms-attempt",
      },
      payload: {
        recipientEmail: "accounts@premier.co.za",
        channel: "sms",
      },
    });
    assert.equal(smsRes.statusCode, 422);
    assert.equal(JSON.parse(smsRes.body).code, "sms_delivery_deferred");

    // -------------------------------------------------------------
    // Test 4: Invalid email format or CRLF injection rejected (422)
    // -------------------------------------------------------------
    const badEmailRes = await server.inject({
      method: "POST",
      url: `/v1/statements/${statementId}/deliver`,
      headers: {
        authorization: `Bearer ${bookkeeperToken}`,
        "idempotency-key": "idem-bad-email",
      },
      payload: {
        recipientEmail: "victim@domain.com\r\nBcc: evil@hacker.com",
      },
    });
    assert.equal(badEmailRes.statusCode, 422);
    assert.equal(JSON.parse(badEmailRes.body).code, "invalid_recipient_email");

    // -------------------------------------------------------------
    // Test 5: Successful statement delivery dispatch (Immediate)
    // -------------------------------------------------------------
    mockEmail.clearSent();
    const idemKey = "idem-delivery-001";

    const deliverRes = await server.inject({
      method: "POST",
      url: `/v1/statements/${statementId}/deliver`,
      headers: {
        authorization: `Bearer ${bookkeeperToken}`,
        "idempotency-key": idemKey,
      },
      payload: {
        recipientEmail: "finance@premier-supplies.co.za",
        immediate: true,
      },
    });

    assert.equal(deliverRes.statusCode, 200, deliverRes.body);
    const delData = JSON.parse(deliverRes.body);
    assert.equal(delData.statementId, statementId);
    assert.equal(delData.channel, "email");
    assert.equal(delData.status, "accepted");
    assert.ok(delData.providerMessageId);
    assert.ok(delData.recipientSecretRef.startsWith("enc:v1:"));
    assert.ok(delData.recipientSecretRef.includes("f***e@premier-supplies.co.za#"));
    assert.equal(delData.attemptCount, 1);

    // Verify mock email was sent with pre-signed download URL bound to tenant
    assert.equal(mockEmail.sentEmails.length, 1);
    const sent = mockEmail.sentEmails[0]!;
    assert.equal(sent.recipientEmail, "finance@premier-supplies.co.za");
    assert.equal(sent.closingBalance, "12500.0000");
    assert.ok(sent.downloadUrl.includes("/v1/statements/download?key="));
    assert.ok(sent.downloadUrl.includes("signature="));
    assert.ok(sent.downloadUrl.includes(`tenant=${TENANT_A_ID}`));

    // -------------------------------------------------------------
    // Test 6: Idempotency Replay - Same key returns existing record without second send
    // -------------------------------------------------------------
    const replayRes = await server.inject({
      method: "POST",
      url: `/v1/statements/${statementId}/deliver`,
      headers: {
        authorization: `Bearer ${bookkeeperToken}`,
        "idempotency-key": idemKey,
      },
      payload: {
        recipientEmail: "finance@premier-supplies.co.za",
      },
    });

    assert.equal(replayRes.statusCode, 200);
    const replayData = JSON.parse(replayRes.body);
    assert.equal(replayData.id, delData.id);
    assert.equal(replayData.providerMessageId, delData.providerMessageId);
    assert.equal(mockEmail.sentEmails.length, 1, "Must NOT dispatch a second email on idempotent replay");

    // -------------------------------------------------------------
    // Test 7: GET /v1/statements/:id/deliveries returns audit history
    // -------------------------------------------------------------
    const listRes = await server.inject({
      method: "GET",
      url: `/v1/statements/${statementId}/deliveries`,
      headers: {
        authorization: `Bearer ${bookkeeperToken}`,
      },
    });
    assert.equal(listRes.statusCode, 200);
    const listData = JSON.parse(listRes.body);
    assert.equal(listData.deliveries.length, 1);
    assert.equal(listData.deliveries[0].id, delData.id);
    assert.equal(listData.deliveries[0].status, "accepted");

    // -------------------------------------------------------------
    // Test 8: Webhook Status Callback updates delivery status to 'delivered'
    // -------------------------------------------------------------
    const callbackRes = await server.inject({
      method: "POST",
      url: "/v1/deliveries/callback",
      headers: {
        "x-delivery-callback-token": "genesis-delivery-callback-token",
      },
      payload: {
        tenantId: TENANT_A_ID,
        providerMessageId: delData.providerMessageId,
        status: "delivered",
        timestamp: new Date().toISOString(),
      },
    });
    assert.equal(callbackRes.statusCode, 200);

    const afterCallbackDeliveries = await getStatementDeliveries(db, TENANT_A_ID, statementId);
    assert.equal(afterCallbackDeliveries[0]!.status, "delivered");

    // -------------------------------------------------------------
    // Test 9: Webhook Status Callback with 'bounced' marks delivery bounced
    // -------------------------------------------------------------
    const bounceCallbackRes = await server.inject({
      method: "POST",
      url: "/v1/deliveries/callback",
      headers: {
        "x-delivery-callback-token": "genesis-delivery-callback-token",
      },
      payload: {
        tenantId: TENANT_A_ID,
        providerMessageId: delData.providerMessageId,
        status: "bounced",
        reason: "Mailbox full / quota exceeded",
      },
    });
    assert.equal(bounceCallbackRes.statusCode, 200);

    const afterBounceDeliveries = await getStatementDeliveries(db, TENANT_A_ID, statementId);
    assert.equal(afterBounceDeliveries[0]!.status, "bounced");

    // -------------------------------------------------------------
    // Test 10: Multi-tenant Isolation - Tenant B cannot deliver or view Tenant A statements
    // -------------------------------------------------------------
    const tenantBToken = createMockSessionToken(
      { dest: SHOP_B, aud: CLIENT_ID, sub: "gid://shopify/User/manager-b" },
      API_SECRET,
    );

    const crossDeliverRes = await server.inject({
      method: "POST",
      url: `/v1/statements/${statementId}/deliver`,
      headers: {
        authorization: `Bearer ${tenantBToken}`,
        "idempotency-key": "idem-cross-tenant",
      },
      payload: {
        recipientEmail: "accounts@tenant-b.com",
      },
    });
    assert.equal(crossDeliverRes.statusCode, 404, "Cross-tenant statement delivery must be 404 not found");

    const crossListRes = await server.inject({
      method: "GET",
      url: `/v1/statements/${statementId}/deliveries`,
      headers: {
        authorization: `Bearer ${tenantBToken}`,
      },
    });
    assert.equal(crossListRes.statusCode, 200);
    assert.equal(JSON.parse(crossListRes.body).deliveries.length, 0, "Cross-tenant deliveries must return 0 rows");

    // -------------------------------------------------------------
    // Test 11: Worker Uncertain Handling & Reconciliation (No Blind Re-Send)
    // -------------------------------------------------------------
    mockEmail.clearSent();
    mockEmail.setSimulatedOutcome("uncertain", "Simulated provider gateway timeout");

    const uncertainRecord = await enqueueStatementDelivery(db, TENANT_A_ID, {
      statementId,
      channel: "email",
      recipientEmail: "uncertain.delivery@domain.co.za",
      idempotencyKey: "idem-uncertain-01",
    });
    assert.equal(uncertainRecord.status, "queued");

    // First worker pass: provider timeout marks status as uncertain
    const workerRes1 = await processQueuedDeliveries(db, TENANT_A_ID, { limit: 1 });
    assert.equal(workerRes1.processed, 1);
    assert.equal(workerRes1.uncertain, 1);
    assert.equal(workerRes1.deliveries[0]!.status, "uncertain");
    assert.equal(mockEmail.sentEmails.length, 1);
    assert.equal(
      mockEmail.sentEmails[0]!.recipientEmail,
      "uncertain.delivery@domain.co.za",
      "Worker must dispatch to the decrypted requested recipient address",
    );

    // Second worker pass: processQueuedDeliveries MUST NOT blindly re-send uncertain items!
    const workerRes2 = await processQueuedDeliveries(db, TENANT_A_ID, { limit: 1 });
    assert.equal(workerRes2.processed, 0, "processQueuedDeliveries must NOT re-dispatch uncertain deliveries");
    assert.equal(mockEmail.sentEmails.length, 1, "Must NOT dispatch a second email while uncertain");

    // Reconcile uncertain delivery by querying the provider
    const reconRes = await reconcileUncertainDeliveries(db, TENANT_A_ID);
    assert.equal(reconRes.reconciled, 1);
    assert.equal(reconRes.confirmedAccepted, 1);
    assert.equal(mockEmail.sentEmails.length, 1, "Must NEVER dispatch second email during reconciliation");

    const finalDeliveries = await getStatementDeliveries(db, TENANT_A_ID, statementId);
    const delRec = finalDeliveries.find((d) => d.id === uncertainRecord.id)!;
    assert.equal(delRec.status, "accepted");

    // -------------------------------------------------------------
    // Test 12: Offline Worker Decrypts Recipient Secret Ref (No Placeholder Fallback)
    // -------------------------------------------------------------
    mockEmail.clearSent();
    mockEmail.setSimulatedOutcome("accepted");

    const offlineRecord = await enqueueStatementDelivery(db, TENANT_A_ID, {
      statementId,
      channel: "email",
      recipientEmail: "offline.worker@premier-hardware.co.za",
      idempotencyKey: "idem-offline-worker-01",
    });
    assert.equal(offlineRecord.status, "queued");

    // Background worker runs WITHOUT recipientEmailOverride option
    const offlineWorkerRes = await processQueuedDeliveries(db, TENANT_A_ID, { limit: 1 });
    assert.equal(offlineWorkerRes.processed, 1);
    assert.equal(offlineWorkerRes.succeeded, 1);
    assert.equal(mockEmail.sentEmails.length, 1);
    assert.equal(
      mockEmail.sentEmails[0]!.recipientEmail,
      "offline.worker@premier-hardware.co.za",
      "Scheduled background worker must send to authentic decrypted recipient, NEVER placeholder",
    );

    // -------------------------------------------------------------
    // Test 13: Tenant-Bound Signed Download URLs & Cross-Tenant Attack Rejection
    // -------------------------------------------------------------
    const signedDownloadUrl = mockEmail.sentEmails[0]!.downloadUrl;
    assert.ok(signedDownloadUrl.includes(`tenant=${TENANT_A_ID}`));

    // Valid download succeeds
    const validDlRes = await server.inject({
      method: "GET",
      url: signedDownloadUrl,
    });
    assert.equal(validDlRes.statusCode, 200);
    assert.equal(validDlRes.headers["content-type"], "application/pdf");

    // Cross-tenant attack: swap tenant param to Tenant B
    const crossTenantUrl = signedDownloadUrl.replace(`tenant=${TENANT_A_ID}`, `tenant=${TENANT_B_ID}`);
    const crossTenantRes = await server.inject({
      method: "GET",
      url: crossTenantUrl,
    });
    assert.equal(crossTenantRes.statusCode, 403);
    assert.equal(crossTenantRes.json().code, "tenant_path_mismatch");

    // Directory traversal attack: malicious key parameter
    const traversalUrl = `/v1/statements/download?key=../../etc/passwd&expires=9999999999&signature=fake&tenant=${TENANT_A_ID}`;
    const traversalRes = await server.inject({
      method: "GET",
      url: traversalUrl,
    });
    // -------------------------------------------------------------
    // Test 14: Crash Recovery After Remote Send (Stuck in 'sending')
    // -------------------------------------------------------------
    // Simulate: worker claimed item, updated DB to 'sending', called provider (which accepted),
    // but the node process crashed before DB could be updated to 'accepted'.
    const crashAfterRecord = await enqueueStatementDelivery(db, TENANT_A_ID, {
      statementId,
      channel: "email",
      recipientEmail: "crash.recovery@premier.co.za",
      idempotencyKey: "idem-crash-after-01",
    });

    // Worker claims it into 'sending'
    await db.query(
      `UPDATE statement_delivery
       SET status = 'sending',
           attempt_count = attempt_count + 1,
           last_attempt_at = now() - interval '2 minutes'
       WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A_ID, crashAfterRecord.id],
    );

    // Provider accepted and recorded the message
    await mockEmail.sendStatementEmail({
      tenantId: TENANT_A_ID,
      deliveryId: crashAfterRecord.id,
      statementId,
      idempotencyKey: "idem-crash-after-01",
      recipientEmail: "crash.recovery@premier.co.za",
      recipientName: "Crash Recovery",
      accountNumber: "ACC-01",
      statementNumber: "STMT-CRASH-01",
      periodEnd: "2026-08-31",
      closingBalance: "12500.0000",
      currency: "ZAR",
      downloadUrl: signedDownloadUrl,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });

    const sentCountBefore = mockEmail.sentEmails.length;

    // processQueuedDeliveries must NOT touch it (status is 'sending', not 'queued')
    const normalWorkerPass = await processQueuedDeliveries(db, TENANT_A_ID, { limit: 1 });
    assert.equal(normalWorkerPass.processed, 0, "processQueuedDeliveries must never pick up 'sending' deliveries");
    assert.equal(mockEmail.sentEmails.length, sentCountBefore, "Must not re-send");

    // reconcileUncertainDeliveries detects the stale 'sending' delivery, checks provider, and marks accepted
    const crashReconRes = await reconcileUncertainDeliveries(db, TENANT_A_ID, { staleSendingThresholdMs: 0 });
    assert.equal(crashReconRes.reconciled, 1);
    assert.equal(crashReconRes.confirmedAccepted, 1);
    assert.equal(mockEmail.sentEmails.length, sentCountBefore, "Must NEVER dispatch second email on crash recovery");

    const afterCrashDeliveries = await getStatementDeliveries(db, TENANT_A_ID, statementId);
    const recoveredRec = afterCrashDeliveries.find((d) => d.id === crashAfterRecord.id)!;
    assert.equal(recoveredRec.status, "accepted");

    // -------------------------------------------------------------
    // Test 15: Crash Recovery Before Remote Send (Provider Never Received Message)
    // -------------------------------------------------------------
    const crashBeforeRecord = await enqueueStatementDelivery(db, TENANT_A_ID, {
      statementId,
      channel: "email",
      recipientEmail: "crash.before@premier.co.za",
      idempotencyKey: "idem-crash-before-01",
    });

    // Simulate crash before send: status is 'sending', but provider has NO record
    await db.query(
      `UPDATE statement_delivery
       SET status = 'sending',
           attempt_count = attempt_count + 1,
           last_attempt_at = now() - interval '2 minutes'
       WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A_ID, crashBeforeRecord.id],
    );

    // Reconcile: since provider has no record, safely resets to 'queued'
    const crashBeforeRecon = await reconcileUncertainDeliveries(db, TENANT_A_ID, { staleSendingThresholdMs: 0 });
    assert.equal(crashBeforeRecon.requeued, 1);

    const requeuedRec = (await getStatementDeliveries(db, TENANT_A_ID, statementId)).find(
      (d) => d.id === crashBeforeRecord.id,
    )!;
    assert.equal(requeuedRec.status, "queued");

    // Now standard worker can safely process and send it once
    const safeWorkerPass = await processQueuedDeliveries(db, TENANT_A_ID, { limit: 1 });
    assert.equal(safeWorkerPass.processed, 1);
    assert.equal(safeWorkerPass.succeeded, 1);

    const lookupUnavailable = new MockStatementEmailProvider();
    lookupUnavailable.queryDeliveryStatus = async () => null;
    setStatementEmailProvider(lookupUnavailable);
    const unverifiedRecord = await enqueueStatementDelivery(db, TENANT_A_ID, {
      statementId,
      channel: "email",
      recipientEmail: "unverified@premier.co.za",
      idempotencyKey: "idem-unverified-lookup-01",
    });
    await db.query(
      `UPDATE statement_delivery
       SET status = 'sending', attempt_count = 1, last_attempt_at = now() - interval '2 minutes'
       WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A_ID, unverifiedRecord.id],
    );

    const unverifiedRecon = await reconcileUncertainDeliveries(db, TENANT_A_ID, {
      staleSendingThresholdMs: 0,
    });
    assert.equal(unverifiedRecon.requeued, 0, "An unavailable provider lookup must not permit a resend");
    assert.equal(unverifiedRecon.stillUncertain, 1);
    assert.equal(lookupUnavailable.sentEmails.length, 0);
    const unverifiedDelivery = (await getStatementDeliveries(db, TENANT_A_ID, statementId)).find(
      (delivery) => delivery.id === unverifiedRecord.id,
    );
    assert.equal(unverifiedDelivery?.status, "uncertain");
  } finally {
    await db.close();
  }
});
