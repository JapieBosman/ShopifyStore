import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildServer } from "../../apps/api/src/server.ts";
import { createMockSessionToken } from "../../apps/api/src/auth/shopify.ts";
import { PostgresIdempotencyStore, computeRequestHash } from "../../apps/api/src/idempotency.ts";
import { postJournal } from "../../packages/domain/src/posting.ts";

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

const API_SECRET = "shpss_test_secret_key_12345";
const CLIENT_ID = "test_client_id_67890";
const SHOP = "displaydeck.myshopify.com";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";

async function setupIntegrationDb() {
  const db = await PGlite.create();
  await db.exec(readFileSync(migration0001, "utf8"));
  await db.exec(readFileSync(migration0002, "utf8"));
  await db.exec(readFileSync(migration0003, "utf8"));
  await db.exec(readFileSync(migration0004, "utf8"));
  await db.exec(readFileSync(migration0005, "utf8"));

  // Seed Tenant
  await db.query(
    "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Acme Trade Store', 'ZAR', 'UTC', 'active')",
    [TENANT_ID],
  );

  // Seed Standard Ledger Accounts
  await db.query("SELECT seed_standard_ledger_accounts($1)", [TENANT_ID]);

  // Seed Installation
  const instRes = await db.query<{ id: string }>(
    `INSERT INTO installation (tenant_id, shop_gid, shop_domain, status, installed_at, token_secret_ref, scopes)
     VALUES ($1, 'gid://shopify/Shop/1', $2, 'active', now(), 'secrets://test/token', ARRAY['read_customers'])
     RETURNING id`,
    [TENANT_ID, SHOP],
  );
  const installationId = instRes.rows[0]!.id;

  // Seed Location
  const locRes = await db.query<{ id: string }>(
    "INSERT INTO location (tenant_id, installation_id, shopify_location_gid, name, timezone) VALUES ($1, $2, 'gid://shopify/Location/1', 'Downtown Counter', 'UTC') RETURNING id",
    [TENANT_ID, installationId],
  );
  const locationId = locRes.rows[0]!.id;

  // Seed Actors
  const managerRes = await db.query<{ id: string }>(
    "INSERT INTO actor (tenant_id, external_subject, display_name, role) VALUES ($1, 'gid://shopify/User/10', 'Megan Manager', 'manager') RETURNING id",
    [TENANT_ID],
  );
  const bookkeeperRes = await db.query<{ id: string }>(
    "INSERT INTO actor (tenant_id, external_subject, display_name, role) VALUES ($1, 'gid://shopify/User/20', 'Brian Bookkeeper', 'bookkeeper') RETURNING id",
    [TENANT_ID],
  );
  const cashierRes = await db.query<{ id: string }>(
    "INSERT INTO actor (tenant_id, external_subject, display_name, role) VALUES ($1, 'gid://shopify/User/30', 'Chloe Cashier', 'cashier') RETURNING id",
    [TENANT_ID],
  );

  // Seed Payment Term
  const termRes = await db.query<{ id: string }>(
    "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
    [TENANT_ID],
  );

  // Seed Debtor Account with 100 limit
  const debtorRes = await db.query<{ id: string }>(
    `INSERT INTO debtor_account (
       tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
     ) VALUES ($1, 'DEBT-001', 'BuildCo Pty Ltd', 'ZAR', $2, 100.0000, 'active', 'due_date') RETURNING id`,
    [TENANT_ID, termRes.rows[0]!.id],
  );

  return {
    db,
    tenantId: TENANT_ID,
    locationId,
    debtorAccountId: debtorRes.rows[0]!.id,
    managerId: managerRes.rows[0]!.id,
    bookkeeperId: bookkeeperRes.rows[0]!.id,
    cashierId: cashierRes.rows[0]!.id,
  };
}

function authHeader(userId: string): string {
  const token = createMockSessionToken({ dest: SHOP, aud: CLIENT_ID, sub: userId }, API_SECRET);
  return `Bearer ${token}`;
}

test("integration: allocation API - explicit allocation, idempotency replay, conflict detection, and immutable reversal", async () => {
  const fixture = await setupIntegrationDb();
  const idempotencyStore = new PostgresIdempotencyStore(fixture.db);
  const server = buildServer({
    db: fixture.db,
    apiSecretKey: API_SECRET,
    clientId: CLIENT_ID,
    idempotencyStore,
  });

  try {
    const bookkeeperAuth = authHeader("gid://shopify/User/20");

    // 1. Post an Invoice of 100.0000 (debit document)
    const ledgerAccounts = await fixture.db.query<{ id: string; code: string }>(
      "SELECT id, code FROM ledger_account WHERE tenant_id = $1 AND code IN ('1200', '4010')",
      [fixture.tenantId],
    );
    const arAccount = ledgerAccounts.rows.find((a) => a.code === "1200")!;
    const salesAccount = ledgerAccounts.rows.find((a) => a.code === "4010")!;

    const invoicePosting = await postJournal(fixture.db, fixture.tenantId, {
      actorId: fixture.bookkeeperId,
      currency: "ZAR",
      effectiveDate: "2026-09-28",
      sourceKind: "invoice",
      sourceKey: "INV-1001",
      idempotencyKey: "idem-seed-inv-1",
      lines: [
        {
          ledgerAccountId: arAccount.id,
          debtorAccountId: fixture.debtorAccountId,
          direction: "debit",
          amount: "100.0000",
          currency: "ZAR",
        },
        {
          ledgerAccountId: salesAccount.id,
          direction: "credit",
          amount: "100.0000",
          currency: "ZAR",
        },
      ],
      documents: [
        {
          debtorAccountId: fixture.debtorAccountId,
          documentNumber: "INV-1001",
          kind: "invoice",
          direction: "debit",
          amount: "100.0000",
          currency: "ZAR",
          issuedOn: "2026-09-28",
          sourceEventKey: "inv:1001",
        },
      ],
    });
    const debitDocId = invoicePosting.documentIds[0]!;

    // 2. Post a Payment of 60.0000 via API (credit document)
    const payRes = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "pay-alloc-seed",
      },
      payload: {
        debtorAccountId: fixture.debtorAccountId,
        amount: "60.0000",
        currency: "ZAR",
        paymentMethod: "bank_transfer",
        paymentMode: "external_receipt",
        effectiveDate: "2026-09-28",
        reference: "EFT-6001",
      },
    });
    assert.equal(payRes.statusCode, 201);
    const creditDocId = payRes.json().documentId;

    // 3. Explicitly allocate 40.0000 of the 60.0000 payment against the 100.0000 invoice via API
    const allocPayload = {
      debtorAccountId: fixture.debtorAccountId,
      mode: "explicit",
      debitDocumentId: debitDocId,
      creditDocumentId: creditDocId,
      amount: "40.0000",
      effectiveDate: "2026-09-28",
    };

    const allocRes = await server.inject({
      method: "POST",
      url: "/v1/allocations",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "idem-alloc-40",
      },
      payload: allocPayload,
    });
    assert.equal(allocRes.statusCode, 201);
    const allocBody = allocRes.json();
    assert.equal(allocBody.amount, "40.0000");
    assert.equal(allocBody.unappliedCredit, "20.0000"); // 60 - 40 = 20 remaining
    assert.equal(allocBody.netBalance, "40.0000"); // 60 open debit - 20 unapplied credit = 40 net debt
    const allocationId = allocBody.allocationId;

    // 4. Retry allocation with IDENTICAL key and payload -> returns cached 201 with idempotent-replayed
    const allocReplay = await server.inject({
      method: "POST",
      url: "/v1/allocations",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "idem-alloc-40",
      },
      payload: allocPayload,
    });
    assert.equal(allocReplay.statusCode, 201);
    assert.equal(allocReplay.headers["idempotent-replayed"], "true");
    assert.deepStrictEqual(allocReplay.json(), allocBody);

    // 5. Retry allocation with SAME key but CHANGED amount -> 409 Conflict
    const allocConflict = await server.inject({
      method: "POST",
      url: "/v1/allocations",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "idem-alloc-40",
      },
      payload: {
        ...allocPayload,
        amount: "50.0000",
      },
    });
    assert.equal(allocConflict.statusCode, 409);
    assert.equal(allocConflict.json().code, "idempotency_conflict");

    // 6. Reverse the allocation via POST /v1/allocations/:id/reverse
    const revPayload = {
      reason: "Customer requested payment reassignment",
      effectiveDate: "2026-09-28",
    };

    const revRes = await server.inject({
      method: "POST",
      url: `/v1/allocations/${allocationId}/reverse`,
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "idem-rev-40",
      },
      payload: revPayload,
    });
    assert.equal(revRes.statusCode, 200);
    const revBody = revRes.json();
    assert.equal(revBody.restoredAmount, "40.0000");
    assert.equal(revBody.unappliedCredit, "60.0000"); // restored full 60 credit
    assert.equal(revBody.netBalance, "40.0000");

    // 7. Retry reversal with IDENTICAL key and payload -> returns cached 200
    const revReplay = await server.inject({
      method: "POST",
      url: `/v1/allocations/${allocationId}/reverse`,
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "idem-rev-40",
      },
      payload: revPayload,
    });
    assert.equal(revReplay.statusCode, 200);
    assert.equal(revReplay.headers["idempotent-replayed"], "true");
    assert.deepStrictEqual(revReplay.json(), revBody);

    // 8. Attempting a second reversal with a NEW key -> 409 Conflict (already_reversed)
    const revDuplicate = await server.inject({
      method: "POST",
      url: `/v1/allocations/${allocationId}/reverse`,
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "idem-rev-40-new",
      },
      payload: {
        reason: "Second reversal attempt",
        effectiveDate: "2026-09-28",
      },
    });
    assert.equal(revDuplicate.statusCode, 409);
    assert.equal(revDuplicate.json().code, "already_reversed");
  } finally {
    await server.close();
  }
});

test("integration: credit reservation lifecycle - limit referral, manager override, and submission confirmation", async () => {
  const fixture = await setupIntegrationDb();
  const idempotencyStore = new PostgresIdempotencyStore(fixture.db);
  const server = buildServer({
    db: fixture.db,
    apiSecretKey: API_SECRET,
    clientId: CLIENT_ID,
    idempotencyStore,
  });

  try {
    const cashierAuth = authHeader("gid://shopify/User/30");
    const managerAuth = authHeader("gid://shopify/User/10");

    const cartDigest = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    // 1. Debtor limit is 100. Requesting 150 -> 422 Unprocessable Entity (credit_declined, requires_override)
    const declineRes = await server.inject({
      method: "POST",
      url: `/v1/accounts/${fixture.debtorAccountId}/credit-reservations`,
      headers: {
        authorization: cashierAuth,
        "idempotency-key": "resv-overlimit-1",
      },
      payload: {
        amount: "150.0000",
        currency: "ZAR",
        cartDigest,
        locationId: fixture.locationId,
      },
    });
    assert.equal(declineRes.statusCode, 422);
    assert.equal(declineRes.json().code, "credit_declined");

    // Look up the created unapproved reservation in DB
    const resvRow = await fixture.db.query<{ id: string }>(
      "SELECT id FROM credit_reservation WHERE tenant_id = $1 AND idempotency_key = 'resv-overlimit-1'",
      [fixture.tenantId],
    );
    assert.equal(resvRow.rows.length, 1);
    const reservationId = resvRow.rows[0]!.id;

    // 2. Manager records supervisor override for the 150 basket
    const overrideRes = await server.inject({
      method: "POST",
      url: `/v1/credit-reservations/${reservationId}/override`,
      headers: {
        authorization: managerAuth,
        "idempotency-key": "override-150-1",
      },
      payload: {
        reason: "VIP customer credit limit exception granted",
        approvedAmount: "150.0000",
        cartDigest,
      },
    });
    assert.equal(overrideRes.statusCode, 200);
    assert.equal(overrideRes.json().approved, true);

    // 3. Cashier confirms submission with matching cart digest -> 200 OK (submitting)
    const confirmRes = await server.inject({
      method: "POST",
      url: `/v1/credit-reservations/${reservationId}/confirm`,
      headers: {
        authorization: cashierAuth,
        "idempotency-key": "confirm-150-1",
      },
      payload: {
        cartDigest,
      },
    });
    assert.equal(confirmRes.statusCode, 200);
    assert.equal(confirmRes.json().status, "submitting");

    // 4. Cart digest tampering attempt on confirm fails closed with 422
    const confirmTampered = await server.inject({
      method: "POST",
      url: `/v1/credit-reservations/${reservationId}/confirm`,
      headers: {
        authorization: cashierAuth,
        "idempotency-key": "confirm-tampered",
      },
      payload: {
        cartDigest: "modified_cart_digest_99999999999999999999999999999999999999999999",
      },
    });
    assert.equal(confirmTampered.statusCode, 422);
  } finally {
    await server.close();
  }
});

test("integration: PostgresIdempotencyStore prevents duplicate concurrent financial mutations", async () => {
  const fixture = await setupIntegrationDb();
  const idempotencyStore = new PostgresIdempotencyStore(fixture.db);
  const server = buildServer({
    db: fixture.db,
    apiSecretKey: API_SECRET,
    clientId: CLIENT_ID,
    idempotencyStore,
  });

  try {
    const bookkeeperAuth = authHeader("gid://shopify/User/20");

    // Launch two concurrent payment requests with the exact same Idempotency-Key
    const paymentPayload = {
      debtorAccountId: fixture.debtorAccountId,
      amount: "250.0000",
      currency: "ZAR",
      paymentMethod: "bank_transfer",
      effectiveDate: "2026-09-28",
      reference: "EFT-CONCURRENT-001",
      paymentMode: "external_receipt",
      memo: "Concurrent idempotency test",
    };

    const [res1, res2] = await Promise.all([
      server.inject({
        method: "POST",
        url: "/v1/payments",
        headers: {
          authorization: bookkeeperAuth,
          "idempotency-key": "concurrent-pay-key-1",
        },
        payload: paymentPayload,
      }),
      server.inject({
        method: "POST",
        url: "/v1/payments",
        headers: {
          authorization: bookkeeperAuth,
          "idempotency-key": "concurrent-pay-key-1",
        },
        payload: paymentPayload,
      }),
    ]);

    // Exactly one must succeed with 201, while the concurrent competitor is either returned cached (201) or 409 conflict
    const statuses = [res1.statusCode, res2.statusCode];
    assert.ok(statuses.includes(201), "At least one request must succeed with 201");
    assert.ok(
      statuses.every((s) => s === 201 || s === 409),
      `Expected status codes to be 201 or 409, got: ${statuses.join(", ")}`,
    );

    // Verify only ONE journal and ONE document was created in the database
    const journalsRes = await fixture.db.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM journal WHERE tenant_id = $1 AND idempotency_key = 'concurrent-pay-key-1'",
      [fixture.tenantId],
    );
    assert.equal(journalsRes.rows[0]!.count, "1", "Only exactly one journal must be posted despite concurrent requests");

    // Verify api_idempotency table in Postgres holds a completed record
    const idemRes = await fixture.db.query<{ status: string; status_code: number }>(
      "SELECT status, status_code FROM api_idempotency WHERE tenant_id = $1 AND idempotency_key = 'concurrent-pay-key-1'",
      [fixture.tenantId],
    );
    assert.equal(idemRes.rows.length, 1);
    assert.equal(idemRes.rows[0]!.status, "completed");
    assert.equal(idemRes.rows[0]!.status_code, 201);
  } finally {
    await server.close();
  }
});

test("integration: idempotency crash recovery recovers from uncompleted in_progress record after journal commit", async () => {
  const fixture = await setupIntegrationDb();
  const idempotencyStore = new PostgresIdempotencyStore(fixture.db);
  const server = buildServer({
    db: fixture.db,
    apiSecretKey: API_SECRET,
    clientId: CLIENT_ID,
    idempotencyStore,
  });
  const bookkeeperAuth = authHeader("gid://shopify/User/20");

  try {
    const key = "crash-recover-key-999";
    const paymentPayload = {
      debtorAccountId: fixture.debtorAccountId,
      amount: "180.0000",
      currency: "ZAR",
      paymentMethod: "bank_transfer",
      effectiveDate: "2026-09-28",
      reference: "EFT-CRASH-001",
      paymentMode: "external_receipt",
      memo: "Crash recovery test payment",
    };

    const reqHash = computeRequestHash(paymentPayload);

    // 1. Simulate crash scenario:
    // Insert in_progress record into api_idempotency
    await fixture.db.query(
      `INSERT INTO api_idempotency (tenant_id, idempotency_key, request_hash, status, created_at)
       VALUES ($1, $2, $3, 'in_progress', now())`,
      [fixture.tenantId, key, reqHash],
    );

    // Post journal using domain service (simulating postJournal committed before server crashed)
    const ledgerAccounts = await fixture.db.query<{ id: string; code: string }>(
      "SELECT id, code FROM ledger_account WHERE tenant_id = $1 AND code IN ('1010', '1200')",
      [fixture.tenantId],
    );
    const bankAccount = ledgerAccounts.rows.find((a) => a.code === "1010")!.id;
    const arAccount = ledgerAccounts.rows.find((a) => a.code === "1200")!.id;

    await postJournal(fixture.db, fixture.tenantId, {
      actorId: fixture.bookkeeperId,
      currency: "ZAR",
      effectiveDate: "2026-09-28",
      sourceKind: "payment",
      sourceKey: "EFT-CRASH-001",
      idempotencyKey: key,
      memo: "Pre-crash committed payment",
      lines: [
        { ledgerAccountId: bankAccount, direction: "debit", amount: "180.0000", currency: "ZAR" },
        { ledgerAccountId: arAccount, debtorAccountId: fixture.debtorAccountId, direction: "credit", amount: "180.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: fixture.debtorAccountId,
          documentNumber: "RCT-CRASH-001",
          kind: "payment",
          direction: "credit",
          amount: "180.0000",
          currency: "ZAR",
          issuedOn: "2026-09-28",
          dueOn: "2026-09-28",
          sourceEventKey: "evt-crash-001",
        },
      ],
    });

    // 2. Client retries request with the exact same Idempotency-Key
    const retryRes = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": key,
      },
      payload: paymentPayload,
    });

    // 3. Verify crash recovery:
    // Should NOT fail with 409 locked; should recover, complete record, and replay cached 201
    assert.equal(retryRes.statusCode, 201, "Must recover and return 201 response");
    assert.equal(retryRes.headers["idempotent-replayed"], "true", "Must be marked as idempotent replayed");

    // Verify exactly 1 journal exists (no duplicate posting!)
    const countRes = await fixture.db.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM journal WHERE tenant_id = $1 AND idempotency_key = $2",
      [fixture.tenantId, key],
    );
    assert.equal(countRes.rows[0]!.count, "1", "Must not duplicate journal on crash recovery retry");

    // Verify api_idempotency status is now 'completed'
    const idemRes = await fixture.db.query<{ status: string; status_code: number }>(
      "SELECT status, status_code FROM api_idempotency WHERE tenant_id = $1 AND idempotency_key = $2",
      [fixture.tenantId, key],
    );
    assert.equal(idemRes.rows[0]!.status, "completed");
    assert.equal(idemRes.rows[0]!.status_code, 201);
  } finally {
    await server.close();
  }
});

test("integration: idempotency lease expiration (>30s) and concurrency renewal semantics", async () => {
  const fixture = await setupIntegrationDb();
  const idempotencyStore = new PostgresIdempotencyStore(fixture.db);
  const server = buildServer({
    db: fixture.db,
    apiSecretKey: API_SECRET,
    clientId: CLIENT_ID,
    idempotencyStore,
  });
  const bookkeeperAuth = authHeader("gid://shopify/User/20");

  try {
    const expiredUncommittedKey = "key-expired-uncommitted-001";
    const paymentPayload = {
      debtorAccountId: fixture.debtorAccountId,
      amount: "95.0000",
      currency: "ZAR",
      paymentMethod: "bank_transfer",
      effectiveDate: "2026-09-28",
      reference: "EFT-EXPIRED-001",
      paymentMode: "external_receipt",
      memo: "Lease expiration renewal test",
    };

    const reqHash = computeRequestHash(paymentPayload);

    // 1. Case 1: In-flight lease (<30s) without committed transaction blocks concurrent request with 409
    await fixture.db.query(
      `INSERT INTO api_idempotency (tenant_id, idempotency_key, request_hash, status, created_at)
       VALUES ($1, $2, $3, 'in_progress', now())`,
      [fixture.tenantId, expiredUncommittedKey, reqHash],
    );

    const activeConflictRes = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": expiredUncommittedKey,
      },
      payload: paymentPayload,
    });
    assert.equal(activeConflictRes.statusCode, 409, "Active in-flight lease must reject concurrent attempts with 409");
    assert.equal(activeConflictRes.json().code, "concurrent_mutation_in_progress");

    // 2. Case 2: Expired lease (>30s) where worker crashed BEFORE posting any financial journal
    // Age the created_at timestamp back by 45 seconds
    const agedTimestamp = new Date(Date.now() - 45 * 1000).toISOString();
    await fixture.db.query(
      `UPDATE api_idempotency
       SET created_at = $1
       WHERE tenant_id = $2 AND idempotency_key = $3`,
      [agedTimestamp, fixture.tenantId, expiredUncommittedKey],
    );

    // Ensure no journal exists yet
    const preCount = await fixture.db.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM journal WHERE tenant_id = $1 AND idempotency_key = $2",
      [fixture.tenantId, expiredUncommittedKey],
    );
    assert.equal(preCount.rows[0]!.count, "0");

    // Retry should atomically acquire/renew expired lease, execute transaction, and return 201 Created
    const renewedRes = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": expiredUncommittedKey,
      },
      payload: paymentPayload,
    });
    assert.equal(renewedRes.statusCode, 201, "Expired uncommitted lease must be renewed and succeed with 201");
    assert.equal(renewedRes.headers["idempotent-replayed"], undefined, "Fresh execution should not be marked replayed");

    // Verify journal was committed exactly once
    const postCount = await fixture.db.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM journal WHERE tenant_id = $1 AND idempotency_key = $2",
      [fixture.tenantId, expiredUncommittedKey],
    );
    assert.equal(postCount.rows[0]!.count, "1");

    // Verify status transitioned to completed
    const completedRes = await fixture.db.query<{ status: string; status_code: number }>(
      "SELECT status, status_code FROM api_idempotency WHERE tenant_id = $1 AND idempotency_key = $2",
      [fixture.tenantId, expiredUncommittedKey],
    );
    assert.equal(completedRes.rows[0]!.status, "completed");
    assert.equal(completedRes.rows[0]!.status_code, 201);

    // Subsequent call replays cached 201
    const replayRes = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": expiredUncommittedKey,
      },
      payload: paymentPayload,
    });
    assert.equal(replayRes.statusCode, 201);
    assert.equal(replayRes.headers["idempotent-replayed"], "true");
  } finally {
    await server.close();
  }
});


