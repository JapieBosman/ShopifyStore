import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildServer } from "../src/server.ts";
import { createMockSessionToken } from "../src/auth/shopify.ts";
import { MemoryIdempotencyStore } from "../src/idempotency.ts";

const migration0001 = fileURLToPath(
  new URL("../../../packages/database/migrations/0001_core.sql", import.meta.url),
);
const migration0002 = fileURLToPath(
  new URL("../../../packages/database/migrations/0002_posting.sql", import.meta.url),
);
const migration0003 = fileURLToPath(
  new URL("../../../packages/database/migrations/0003_allocation.sql", import.meta.url),
);
const migration0004 = fileURLToPath(
  new URL("../../../packages/database/migrations/0004_reservations.sql", import.meta.url),
);
const migration0005 = fileURLToPath(
  new URL("../../../packages/database/migrations/0005_idempotency.sql", import.meta.url),
);

const API_SECRET = "shpss_test_secret_key_12345";
const CLIENT_ID = "test_client_id_67890";
const SHOP_A = "displaydeck.myshopify.com";
const SHOP_B = "otherstore.myshopify.com";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

async function setupTestDb() {
  const db = await PGlite.create();
  await db.exec(readFileSync(migration0001, "utf8"));
  await db.exec(readFileSync(migration0002, "utf8"));
  await db.exec(readFileSync(migration0003, "utf8"));
  await db.exec(readFileSync(migration0004, "utf8"));
  await db.exec(readFileSync(migration0005, "utf8"));

  // Seed Tenants
  await db.query(
    "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Tenant A', 'ZAR', 'UTC', 'active'), ($2, 'Tenant B', 'USD', 'UTC', 'active')",
    [TENANT_A, TENANT_B],
  );

  // Seed Standard Ledger Accounts
  await db.query("SELECT seed_standard_ledger_accounts($1)", [TENANT_A]);
  await db.query("SELECT seed_standard_ledger_accounts($1)", [TENANT_B]);

  // Seed Installations
  const instARes = await db.query<{ id: string }>(
    `INSERT INTO installation (tenant_id, shop_gid, shop_domain, status, installed_at, token_secret_ref, scopes)
     VALUES ($1, 'gid://shopify/Shop/1', $2, 'active', now(), 'secrets://test/token-a', ARRAY['read_customers'])
     RETURNING id`,
    [TENANT_A, SHOP_A],
  );
  await db.query(
    `INSERT INTO installation (tenant_id, shop_gid, shop_domain, status, installed_at, token_secret_ref, scopes)
     VALUES ($1, 'gid://shopify/Shop/2', $2, 'active', now(), 'secrets://test/token-b', ARRAY['read_customers'])`,
    [TENANT_B, SHOP_B],
  );

  // Seed Locations
  const locARes = await db.query<{ id: string }>(
    "INSERT INTO location (tenant_id, installation_id, shopify_location_gid, name, timezone) VALUES ($1, $2, 'gid://shopify/Location/1', 'Warehouse Main', 'UTC') RETURNING id",
    [TENANT_A, instARes.rows[0]!.id],
  );
  const locationAId = locARes.rows[0]!.id;

  // Seed Actors for Tenant A
  const ownerRes = await db.query<{ id: string }>(
    "INSERT INTO actor (tenant_id, external_subject, display_name, role) VALUES ($1, 'gid://shopify/User/1', 'Alice Owner', 'owner') RETURNING id",
    [TENANT_A],
  );
  const managerRes = await db.query<{ id: string }>(
    "INSERT INTO actor (tenant_id, external_subject, display_name, role) VALUES ($1, 'gid://shopify/User/2', 'Bob Manager', 'manager') RETURNING id",
    [TENANT_A],
  );
  const bookkeeperRes = await db.query<{ id: string }>(
    "INSERT INTO actor (tenant_id, external_subject, display_name, role) VALUES ($1, 'gid://shopify/User/3', 'Charlie Bookkeeper', 'bookkeeper') RETURNING id",
    [TENANT_A],
  );
  const cashierRes = await db.query<{ id: string }>(
    "INSERT INTO actor (tenant_id, external_subject, display_name, role) VALUES ($1, 'gid://shopify/User/4', 'Dan Cashier', 'cashier') RETURNING id",
    [TENANT_A],
  );

  // Seed Payment Term for Tenant A & B
  const termARes = await db.query<{ id: string }>(
    "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
    [TENANT_A],
  );
  const termBRes = await db.query<{ id: string }>(
    "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
    [TENANT_B],
  );

  // Seed Debtor Account for Tenant A
  const debtorARes = await db.query<{ id: string }>(
    `INSERT INTO debtor_account (
       tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
     ) VALUES ($1, 'ACC-A01', 'Builder Supplies Ltd', 'ZAR', $2, 1000.0000, 'active', 'due_date') RETURNING id`,
    [TENANT_A, termARes.rows[0]!.id],
  );

  // Seed Debtor Account for Tenant B
  const debtorBRes = await db.query<{ id: string }>(
    `INSERT INTO debtor_account (
       tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
     ) VALUES ($1, 'ACC-B01', 'US Hardware Corp', 'USD', $2, 5000.0000, 'active', 'due_date') RETURNING id`,
    [TENANT_B, termBRes.rows[0]!.id],
  );

  return {
    db,
    locationAId,
    termAId: termARes.rows[0]!.id,
    termBId: termBRes.rows[0]!.id,
    debtorAId: debtorARes.rows[0]!.id,
    debtorBId: debtorBRes.rows[0]!.id,
    ownerId: ownerRes.rows[0]!.id,
    managerId: managerRes.rows[0]!.id,
    bookkeeperId: bookkeeperRes.rows[0]!.id,
    cashierId: cashierRes.rows[0]!.id,
  };
}

function makeAuthHeader(shop: string, userId: string): string {
  const token = createMockSessionToken({ dest: shop, aud: CLIENT_ID, sub: userId }, API_SECRET);
  return `Bearer ${token}`;
}

test("API contracts: role-based access control enforces strict role boundaries", async () => {
  const fixture = await setupTestDb();
  const server = buildServer({
    db: fixture.db,
    apiSecretKey: API_SECRET,
    clientId: CLIENT_ID,
    idempotencyStore: new MemoryIdempotencyStore(),
  });

  try {
    const cashierAuth = makeAuthHeader(SHOP_A, "gid://shopify/User/4");
    const bookkeeperAuth = makeAuthHeader(SHOP_A, "gid://shopify/User/3");
    const managerAuth = makeAuthHeader(SHOP_A, "gid://shopify/User/2");

    // 1. Cashier attempting to create an account -> 403 Forbidden
    const resCreateAcc = await server.inject({
      method: "POST",
      url: "/v1/accounts",
      headers: {
        authorization: cashierAuth,
        "idempotency-key": "idem-acc-1",
      },
      payload: {
        accountNumber: "ACC-TEST",
        legalName: "Test Account",
        currency: "ZAR",
        paymentTermId: fixture.termAId,
        creditLimit: "500.0000",
      },
    });
    assert.equal(resCreateAcc.statusCode, 403);
    assert.equal(resCreateAcc.json().code, "insufficient_permissions");

    // 2. Cashier attempting to update account policy -> 403 Forbidden
    const resPolicyCashier = await server.inject({
      method: "PATCH",
      url: `/v1/accounts/${fixture.debtorAId}/policy`,
      headers: {
        authorization: cashierAuth,
        "idempotency-key": "idem-policy-1",
      },
      payload: {
        creditLimit: "2000.0000",
        reason: "Cashier wants to raise limit",
      },
    });
    assert.equal(resPolicyCashier.statusCode, 403);

    // 3. Bookkeeper attempting to update account policy -> 403 Forbidden
    const resPolicyBookkeeper = await server.inject({
      method: "PATCH",
      url: `/v1/accounts/${fixture.debtorAId}/policy`,
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "idem-policy-2",
      },
      payload: {
        creditLimit: "2000.0000",
        reason: "Bookkeeper wants to raise limit",
      },
    });
    assert.equal(resPolicyBookkeeper.statusCode, 403);

    // 4. Cashier attempting to post payment/receipt -> 403 Forbidden
    const resPaymentCashier = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: cashierAuth,
        "idempotency-key": "idem-pay-1",
      },
      payload: {
        debtorAccountId: fixture.debtorAId,
        amount: "100.0000",
        currency: "ZAR",
        paymentMethod: "cash",
        paymentMode: "shopify_pos_cash",
        effectiveDate: "2026-09-28",
        reference: "CSH-001",
      },
    });
    assert.equal(resPaymentCashier.statusCode, 403);

    // 5. Cashier attempting to allocate payment -> 403 Forbidden
    const resAllocCashier = await server.inject({
      method: "POST",
      url: "/v1/allocations",
      headers: {
        authorization: cashierAuth,
        "idempotency-key": "idem-alloc-1",
      },
      payload: {
        debtorAccountId: fixture.debtorAId,
        mode: "oldest_first",
        creditDocumentId: fixture.debtorAId,
        effectiveDate: "2026-09-28",
      },
    });
    assert.equal(resAllocCashier.statusCode, 403);

    // 6. Cashier attempting to approve supervisor override -> 403 Forbidden
    const resOverrideCashier = await server.inject({
      method: "POST",
      url: `/v1/credit-reservations/00000000-0000-4000-8000-000000000001/override`,
      headers: {
        authorization: cashierAuth,
        "idempotency-key": "idem-override-1",
      },
      payload: {
        reason: "Cashier overrides",
        approvedAmount: "100.0000",
        cartDigest: "abcd",
      },
    });
    assert.equal(resOverrideCashier.statusCode, 403);

    // 7. Bookkeeper attempting to approve supervisor override -> 403 Forbidden
    const resOverrideBookkeeper = await server.inject({
      method: "POST",
      url: `/v1/credit-reservations/00000000-0000-4000-8000-000000000001/override`,
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "idem-override-2",
      },
      payload: {
        reason: "Bookkeeper overrides",
        approvedAmount: "100.0000",
        cartDigest: "abcd",
      },
    });
    assert.equal(resOverrideBookkeeper.statusCode, 403);
  } finally {
    await server.close();
  }
});

test("API contracts: multi-tenant isolation rejects cross-tenant access", async () => {
  const fixture = await setupTestDb();
  const server = buildServer({
    db: fixture.db,
    apiSecretKey: API_SECRET,
    clientId: CLIENT_ID,
    idempotencyStore: new MemoryIdempotencyStore(),
  });

  try {
    // Authenticated as Tenant A (Shop A)
    const tenantAAuth = makeAuthHeader(SHOP_A, "gid://shopify/User/1");

    // Attempting to access Tenant B's debtor account -> 404 Not Found (Row Level Security / tenant filter)
    const res = await server.inject({
      method: "GET",
      url: `/v1/accounts/${fixture.debtorBId}`,
      headers: {
        authorization: tenantAAuth,
      },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().code, "account_not_found");
  } finally {
    await server.close();
  }
});

test("API contracts: currency mismatch rejection across payments and reservations", async () => {
  const fixture = await setupTestDb();
  const server = buildServer({
    db: fixture.db,
    apiSecretKey: API_SECRET,
    clientId: CLIENT_ID,
    idempotencyStore: new MemoryIdempotencyStore(),
  });

  try {
    const bookkeeperAuth = makeAuthHeader(SHOP_A, "gid://shopify/User/3");
    const cashierAuth = makeAuthHeader(SHOP_A, "gid://shopify/User/4");

    // Debtor A is ZAR. Posting a payment in USD -> 422 Unprocessable Entity (currency_mismatch)
    const payRes = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "idem-curr-1",
      },
      payload: {
        debtorAccountId: fixture.debtorAId,
        amount: "50.0000",
        currency: "USD",
        paymentMethod: "bank_transfer",
        paymentMode: "external_receipt",
        effectiveDate: "2026-09-28",
        reference: "EFT-USD-01",
      },
    });
    assert.equal(payRes.statusCode, 422);
    assert.equal(payRes.json().code, "currency_mismatch");

    // Debtor A is ZAR. Requesting credit reservation in EUR -> 422 Unprocessable Entity (currency_mismatch)
    const resvRes = await server.inject({
      method: "POST",
      url: `/v1/accounts/${fixture.debtorAId}/credit-reservations`,
      headers: {
        authorization: cashierAuth,
        "idempotency-key": "idem-curr-2",
      },
      payload: {
        amount: "50.0000",
        currency: "EUR",
        cartDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        locationId: fixture.locationAId,
      },
    });
    assert.equal(resvRes.statusCode, 422);
    assert.equal(resvRes.json().code, "currency_mismatch");
  } finally {
    await server.close();
  }
});

test("API contracts: idempotency enforces reuse on identical payload and 409 conflict on modified payload", async () => {
  const fixture = await setupTestDb();
  const idempotencyStore = new MemoryIdempotencyStore();
  const server = buildServer({
    db: fixture.db,
    apiSecretKey: API_SECRET,
    clientId: CLIENT_ID,
    idempotencyStore,
  });

  try {
    const bookkeeperAuth = makeAuthHeader(SHOP_A, "gid://shopify/User/3");

    // 1. Missing Idempotency-Key -> 400 Bad Request
    const resMissing = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: bookkeeperAuth,
      },
      payload: {
        debtorAccountId: fixture.debtorAId,
        amount: "200.0000",
        currency: "ZAR",
        paymentMethod: "bank_transfer",
        paymentMode: "external_receipt",
        effectiveDate: "2026-09-28",
        reference: "EFT-IDEM-01",
      },
    });
    assert.equal(resMissing.statusCode, 400);
    assert.equal(resMissing.json().code, "missing_idempotency_key");

    // 2. Initial POST with Idempotency-Key -> 201 Created
    const payload = {
      debtorAccountId: fixture.debtorAId,
      amount: "200.0000",
      currency: "ZAR",
      paymentMethod: "bank_transfer",
      paymentMode: "external_receipt",
      effectiveDate: "2026-09-28",
      reference: "EFT-IDEM-01",
    };

    const resInitial = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "key-test-idem-99",
      },
      payload,
    });
    assert.equal(resInitial.statusCode, 201);
    const initialBody = resInitial.json();
    assert.equal(initialBody.amount, "200.0000");
    assert.equal(initialBody.paymentMode, "external_receipt");

    // 3. Retry with EXACT SAME key and payload -> returns cached 201 with idempotent-replayed: true
    const resReplay = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "key-test-idem-99",
      },
      payload,
    });
    assert.equal(resReplay.statusCode, 201);
    assert.equal(resReplay.headers["idempotent-replayed"], "true");
    assert.deepStrictEqual(resReplay.json(), initialBody);

    // 4. Retry with SAME key but CHANGED payload (different amount) -> 409 Conflict (idempotency_conflict)
    const resConflict = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "key-test-idem-99",
      },
      payload: {
        ...payload,
        amount: "300.0000", // changed amount!
      },
    });
    assert.equal(resConflict.statusCode, 409);
    assert.equal(resConflict.json().code, "idempotency_conflict");
  } finally {
    await server.close();
  }
});

test("API contracts: visible payment mode is validated and echoed in responses", async () => {
  const fixture = await setupTestDb();
  const server = buildServer({
    db: fixture.db,
    apiSecretKey: API_SECRET,
    clientId: CLIENT_ID,
    idempotencyStore: new MemoryIdempotencyStore(),
  });

  try {
    const bookkeeperAuth = makeAuthHeader(SHOP_A, "gid://shopify/User/3");

    // 1. Invalid payment mode -> 400 Bad Request
    const resInvalid = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "idem-mode-invalid",
      },
      payload: {
        debtorAccountId: fixture.debtorAId,
        amount: "150.0000",
        currency: "ZAR",
        paymentMethod: "bank_transfer",
        paymentMode: "invalid_mystery_mode",
        effectiveDate: "2026-09-28",
        reference: "EFT-MODE-BAD",
      },
    });
    assert.equal(resInvalid.statusCode, 400);
    assert.equal(resInvalid.json().code, "invalid_payment_mode");

    // 2. Valid payment modes: external_receipt, shopify_manual, shopify_pos_cash
    const modes = ["external_receipt", "shopify_manual", "shopify_pos_cash"] as const;
    for (const mode of modes) {
      const res = await server.inject({
        method: "POST",
        url: "/v1/payments",
        headers: {
          authorization: bookkeeperAuth,
          "idempotency-key": `idem-mode-${mode}`,
        },
        payload: {
          debtorAccountId: fixture.debtorAId,
          amount: "50.0000",
          currency: "ZAR",
          paymentMethod: mode === "shopify_pos_cash" ? "cash" : "bank_transfer",
          paymentMode: mode,
          effectiveDate: "2026-09-28",
          reference: `REF-${mode}`,
        },
      });
      assert.equal(res.statusCode, 201);
      assert.equal(res.json().paymentMode, mode);
    }
  } finally {
    await server.close();
  }
});

test("API contracts: full end-to-end flow - create account, policy update, payment, and account balance query", async () => {
  const fixture = await setupTestDb();
  const server = buildServer({
    db: fixture.db,
    apiSecretKey: API_SECRET,
    clientId: CLIENT_ID,
    idempotencyStore: new MemoryIdempotencyStore(),
  });

  try {
    const bookkeeperAuth = makeAuthHeader(SHOP_A, "gid://shopify/User/3");
    const managerAuth = makeAuthHeader(SHOP_A, "gid://shopify/User/2");
    const cashierAuth = makeAuthHeader(SHOP_A, "gid://shopify/User/4");

    // 1. Create a new debtor account via API
    const createRes = await server.inject({
      method: "POST",
      url: "/v1/accounts",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "create-acc-e2e",
      },
      payload: {
        accountNumber: "ACC-E2E-01",
        legalName: "Apex Building Co",
        tradeName: "Apex",
        currency: "ZAR",
        paymentTermId: fixture.termAId,
        creditLimit: "10000.0000",
        status: "active",
      },
    });
    assert.equal(createRes.statusCode, 201);
    const newAcc = createRes.json().account;
    assert.equal(newAcc.account_number, "ACC-E2E-01");
    assert.equal(newAcc.credit_limit, "10000.0000");

    // 2. Manager updates policy via API
    const patchRes = await server.inject({
      method: "PATCH",
      url: `/v1/accounts/${newAcc.id}/policy`,
      headers: {
        authorization: managerAuth,
        "idempotency-key": "patch-policy-e2e",
      },
      payload: {
        creditLimit: "15000.0000",
        reason: "Annual credit limit increase approved",
      },
    });
    assert.equal(patchRes.statusCode, 200);
    assert.equal(patchRes.json().account.credit_limit, "15000.0000");
    assert.equal(patchRes.json().account.policy_version, 2);

    // 3. Post a payment of 500 via API
    const payRes = await server.inject({
      method: "POST",
      url: "/v1/payments",
      headers: {
        authorization: bookkeeperAuth,
        "idempotency-key": "pay-e2e",
      },
      payload: {
        debtorAccountId: newAcc.id,
        amount: "500.0000",
        currency: "ZAR",
        paymentMethod: "bank_transfer",
        paymentMode: "external_receipt",
        effectiveDate: "2026-09-28",
        reference: "EFT-E2E-99",
      },
    });
    assert.equal(payRes.statusCode, 201);
    assert.equal(payRes.json().unappliedCredit, "500.0000");
    assert.equal(payRes.json().netBalance, "-500.0000");

    // 4. Query account details via GET /v1/accounts/:id
    const getRes = await server.inject({
      method: "GET",
      url: `/v1/accounts/${newAcc.id}`,
      headers: {
        authorization: cashierAuth,
      },
    });
    assert.equal(getRes.statusCode, 200);
    const body = getRes.json();
    assert.equal(body.account.account_number, "ACC-E2E-01");
    assert.equal(body.balance.unappliedCredit, "500.0000");
    assert.equal(body.balance.netBalance, "-500.0000");
    assert.equal(body.credit.creditLimit, "15000.0000");
  } finally {
    await server.close();
  }
});
