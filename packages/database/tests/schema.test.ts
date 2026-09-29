import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const schemaFile = fileURLToPath(
  new URL("../../../schema/trade-accounts.sql", import.meta.url),
);

test("reference schema runs in PostgreSQL and isolates tenants", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(readFileSync(schemaFile, "utf8"));
    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    assert.equal(tables.rows.length, 44);

    const policies = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_policies WHERE schemaname = 'public'",
    );
    assert.equal(policies.rows.length, 44);
  } finally {
    await db.close();
  }
});

test("tenant context and composite foreign keys prevent cross-shop reads and links", async () => {
  const db = await PGlite.create();
  const firstTenant = "11111111-1111-4111-8111-111111111111";
  const secondTenant = "22222222-2222-4222-8222-222222222222";
  const secondTerm = "33333333-3333-4333-8333-333333333333";
  try {
    await db.exec(readFileSync(schemaFile, "utf8"));
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'First', 'ZAR', 'Africa/Johannesburg', 'active'), ($2, 'Second', 'ZAR', 'Africa/Johannesburg', 'active')",
      [firstTenant, secondTenant],
    );
    await db.query(
      "INSERT INTO payment_term (id, tenant_id, code, kind, days) VALUES ($1, $2, 'NET30', 'net_days', 30)",
      [secondTerm, secondTenant],
    );
    await db.exec(
      "CREATE ROLE app_runtime; GRANT USAGE ON SCHEMA public TO app_runtime; GRANT SELECT ON tenant, payment_term TO app_runtime;",
    );

    await db.exec("BEGIN; SET LOCAL ROLE app_runtime;");
    const withoutContext = await db.query("SELECT id FROM tenant");
    assert.equal(withoutContext.rows.length, 0);
    await db.query("SELECT set_config('app.tenant_id', $1, true)", [firstTenant]);
    const firstVisible = await db.query<{ id: string }>("SELECT id FROM tenant");
    assert.deepStrictEqual(firstVisible.rows, [{ id: firstTenant }]);
    const otherTerm = await db.query("SELECT id FROM payment_term");
    assert.equal(otherTerm.rows.length, 0);
    await db.exec("COMMIT");

    await db.query("SELECT set_config('app.tenant_id', $1, false)", [firstTenant]);
    await assert.rejects(
      db.query(
        "INSERT INTO debtor_account (tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis) VALUES ($1, 'X', 'Wrong link', 'ZAR', $2, 100, 'active', 'due_date')",
        [firstTenant, secondTerm],
      ),
      /foreign key constraint/,
    );
  } finally {
    await db.close();
  }
});
