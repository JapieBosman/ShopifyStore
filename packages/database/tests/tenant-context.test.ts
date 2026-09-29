import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { withTenantContext, validateTenantId, TenantRepository } from "../tenant-context.ts";

const migrationFile = fileURLToPath(
  new URL("../migrations/0001_core.sql", import.meta.url),
);

test("0001_core.sql applies cleanly on fresh PostgreSQL and configures RLS and roles", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(readFileSync(migrationFile, "utf8"));

    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    assert.equal(tables.rows.length, 31);

    const policies = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_policies WHERE schemaname = 'public'",
    );
    assert.equal(policies.rows.length, 31);

    const roles = await db.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname = 'app_runtime'",
    );
    assert.equal(roles.rows.length, 1);
  } finally {
    await db.close();
  }
});

test("no-context denial: app_runtime role sees zero rows when app.tenant_id is not set", async () => {
  const db = await PGlite.create();
  const tenant1 = "11111111-1111-4111-8111-111111111111";
  try {
    await db.exec(readFileSync(migrationFile, "utf8"));
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Shop One', 'ZAR', 'Africa/Johannesburg', 'active')",
      [tenant1],
    );

    // Switch to non-owner app_runtime role without setting tenant context
    await db.exec("BEGIN; SET LOCAL ROLE app_runtime;");
    const withoutContext = await db.query("SELECT id FROM tenant");
    assert.equal(withoutContext.rows.length, 0);

    const termWithoutContext = await db.query("SELECT id FROM payment_term");
    assert.equal(termWithoutContext.rows.length, 0);
    await db.exec("COMMIT");
  } finally {
    await db.close();
  }
});

test("two-tenant FK and RLS isolation under app_runtime role", async () => {
  const db = await PGlite.create();
  const tenantA = "11111111-1111-4111-8111-111111111111";
  const tenantB = "22222222-2222-4222-8222-222222222222";
  const termA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const termB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  try {
    await db.exec(readFileSync(migrationFile, "utf8"));

    // Insert data for both tenants as migration owner
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Tenant A', 'ZAR', 'Africa/Johannesburg', 'active'), ($2, 'Tenant B', 'USD', 'UTC', 'active')",
      [tenantA, tenantB],
    );
    await db.query(
      "INSERT INTO payment_term (id, tenant_id, code, kind, days) VALUES ($1, $2, 'NET30', 'net_days', 30), ($3, $4, 'NET60', 'net_days', 60)",
      [termA, tenantA, termB, tenantB],
    );

    // Query as app_runtime for Tenant A
    await db.exec("BEGIN; SET LOCAL ROLE app_runtime;");
    await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
    const termsA = await db.query<{ id: string; code: string }>("SELECT id, code FROM payment_term");
    assert.equal(termsA.rows.length, 1);
    assert.equal(termsA.rows[0]?.id, termA);
    assert.equal(termsA.rows[0]?.code, "NET30");

    // Switching context to Tenant B within transaction
    await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
    const termsB = await db.query<{ id: string; code: string }>("SELECT id, code FROM payment_term");
    assert.equal(termsB.rows.length, 1);
    assert.equal(termsB.rows[0]?.id, termB);
    assert.equal(termsB.rows[0]?.code, "NET60");
    await db.exec("COMMIT");

    // Composite foreign key prevents cross-tenant linkage
    await assert.rejects(
      db.query(
        "INSERT INTO debtor_account (tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis) VALUES ($1, 'ACC-01', 'Cross-shop error', 'ZAR', $2, 500, 'active', 'due_date')",
        [tenantA, termB], // Tenant A trying to use Tenant B's term
      ),
      /foreign key constraint/,
    );
  } finally {
    await db.close();
  }
});

test("DELETE is revoked on immutable subledgers for app_runtime role", async () => {
  const db = await PGlite.create();
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const actorId = "33333333-3333-4333-8333-333333333333";
  const journalId = "44444444-4444-4444-8444-444444444444";
  try {
    await db.exec(readFileSync(migrationFile, "utf8"));
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Tenant A', 'ZAR', 'Africa/Johannesburg', 'active')",
      [tenantId],
    );
    await db.query(
      "INSERT INTO actor (id, tenant_id, external_subject, display_name, role) VALUES ($1, $2, 'usr_1', 'Cashier', 'cashier')",
      [actorId, tenantId],
    );
    await db.query(
      "INSERT INTO journal (id, tenant_id, currency, effective_date, posted_at, actor_id, source_kind, source_key, idempotency_key) VALUES ($1, $2, 'ZAR', '2026-09-28', now(), $3, 'test', 'k1', 'idem-1')",
      [journalId, tenantId, actorId],
    );

    // Attempting DELETE as app_runtime must be denied
    await db.exec("BEGIN; SET LOCAL ROLE app_runtime;");
    await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await assert.rejects(
      db.query("DELETE FROM journal WHERE id = $1", [journalId]),
      /permission denied for table journal/,
    );
    await db.exec("ROLLBACK");
  } finally {
    await db.close();
  }
});

test("withTenantContext helper sets transaction-local context, executes, and rolls back on failure", async () => {
  const db = await PGlite.create();
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const termId = "55555555-5555-4555-8555-555555555555";
  try {
    await db.exec(readFileSync(migrationFile, "utf8"));
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Tenant A', 'ZAR', 'Africa/Johannesburg', 'active')",
      [tenantId],
    );

    // Successful execution with repository
    const result = await withTenantContext(db, tenantId, async (scopedDb) => {
      await scopedDb.query(
        "INSERT INTO payment_term (id, tenant_id, code, kind, days) VALUES ($1, $2, 'COD', 'cod', 0)",
        [termId, tenantId],
      );
      const repo = new TenantRepository(scopedDb, tenantId);
      return await repo.listPaymentTerms();
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.code, "COD");

    // Failure triggers rollback
    await assert.rejects(
      withTenantContext(db, tenantId, async (scopedDb) => {
        await scopedDb.query(
          "INSERT INTO payment_term (id, tenant_id, code, kind, days) VALUES ($1, $2, 'NET90', 'net_days', 90)",
          ["66666666-6666-4666-8666-666666666666", tenantId],
        );
        throw new Error("Simulated business error");
      }),
      /Simulated business error/,
    );

    // NET90 should have been rolled back
    const terms = await withTenantContext(db, tenantId, async (scopedDb) => {
      const repo = new TenantRepository(scopedDb, tenantId);
      return await repo.listPaymentTerms();
    });
    assert.equal(terms.length, 1);
    assert.equal(terms[0]?.code, "COD");
  } finally {
    await db.close();
  }
});

test("validateTenantId enforces UUID format", () => {
  assert.equal(validateTenantId("11111111-1111-4111-8111-111111111111"), "11111111-1111-4111-8111-111111111111");
  assert.throws(() => validateTenantId("not-a-uuid"), /Invalid tenant ID/);
  assert.throws(() => validateTenantId(""), /Invalid tenant ID/);
});

test("withTenantContext pins transactions to dedicated connections and releases them cleanly", async () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  let acquireCount = 0;
  let releaseCount = 0;
  const executedStatements: string[] = [];

  class MockConnection {
    public id = Math.random();
    public released = false;

    async query(sql: string, params?: unknown[]) {
      executedStatements.push(`query:${sql}`);
      return { rows: [] };
    }

    async exec(sql: string) {
      executedStatements.push(`exec:${sql}`);
    }

    release() {
      this.released = true;
      releaseCount++;
    }
  }

  const activeConnections: MockConnection[] = [];

  const mockPoolClient = {
    async query() {
      throw new Error("Pool query should not be called directly during transaction");
    },
    async exec() {
      throw new Error("Pool exec should not be called directly during transaction");
    },
    async acquireConnection() {
      acquireCount++;
      const conn = new MockConnection();
      activeConnections.push(conn);
      return conn;
    },
  };

  // Run transaction with nested savepoint
  const result = await withTenantContext(mockPoolClient, tenantId, async (tx1) => {
    await tx1.query("SELECT 1");

    // Nested call on tx1
    return await withTenantContext(tx1, tenantId, async (tx2) => {
      await tx2.query("SELECT 2");
      return "success";
    });
  });

  assert.equal(result, "success");
  assert.equal(acquireCount, 1, "Should acquire exactly 1 dedicated connection for root + nested calls");
  assert.equal(releaseCount, 1, "Should release connection exactly once when root transaction commits");
  assert.equal(activeConnections[0]?.released, true);

  // Check statement ordering on that connection
  assert.deepEqual(executedStatements, [
    "exec:BEGIN",
    "query:SELECT set_config('app.tenant_id', $1, true)",
    "query:SELECT 1",
    "exec:SAVEPOINT sp_2",
    "query:SELECT set_config('app.tenant_id', $1, true)",
    "query:SELECT 2",
    "exec:RELEASE SAVEPOINT sp_2",
    "exec:COMMIT",
  ]);
});

test("withTenantContext concurrent requests receive isolated connections without depth collision", async () => {
  const tenantA = "11111111-1111-4111-8111-111111111111";
  const tenantB = "22222222-2222-4222-8222-222222222222";

  class MockConn {
    public history: string[] = [];
    public released = false;
    async query(sql: string) { this.history.push(`query:${sql}`); return { rows: [] }; }
    async exec(sql: string) { this.history.push(`exec:${sql}`); }
    release() { this.released = true; }
  }

  const conns: MockConn[] = [];
  const mockPool = {
    async query() { return { rows: [] }; },
    async exec() {},
    async acquireConnection() {
      const c = new MockConn();
      conns.push(c);
      return c;
    },
  };

  // Run two concurrent transactions simultaneously
  const [resA, resB] = await Promise.all([
    withTenantContext(mockPool, tenantA, async (txA) => {
      await new Promise((r) => setTimeout(r, 10));
      await txA.query("SELECT 'A'");
      return "A_DONE";
    }),
    withTenantContext(mockPool, tenantB, async (txB) => {
      await new Promise((r) => setTimeout(r, 5));
      await txB.query("SELECT 'B'");
      return "B_DONE";
    }),
  ]);

  assert.equal(resA, "A_DONE");
  assert.equal(resB, "B_DONE");
  assert.equal(conns.length, 2, "Concurrent requests must acquire 2 distinct connections");
  assert.equal(conns[0]?.released, true);
  assert.equal(conns[1]?.released, true);

  // Both should start with BEGIN (depth 1), never SAVEPOINT sp_2
  assert.equal(conns[0]?.history[0], "exec:BEGIN");
  assert.equal(conns[1]?.history[0], "exec:BEGIN");
});

