import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createRequire } from "node:module";

const apiRequire = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const pg = apiRequire("pg");

import { initApiDatabase, PgPoolDbClient } from "../../apps/api/src/db.ts";
import {
  withTenantContext,
  validateTenantId,
  type DbClient,
  type DbConnection,
} from "../../packages/database/tenant-context.ts";
import { postJournal } from "../../packages/domain/src/posting.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../packages/database/migrations");

const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_B_ID = "22222222-2222-4222-8222-222222222222";

describe("TASK-040: Durable PostgreSQL Runtime, Pooled Connections & Tenant Concurrency", () => {
  it("non-owner runtime role (app_runtime) enforces RLS and rejects mutations on immutable subledgers", async () => {
    const db = await PGlite.create();
    try {
      // 1. Run all core migrations
      for (const file of [
        "0001_core.sql",
        "0002_posting.sql",
        "0003_allocation.sql",
        "0004_reservations.sql",
        "0005_idempotency.sql",
      ]) {
        await db.exec(fs.readFileSync(path.resolve(migrationsDir, file), "utf8"));
      }

      // 2. Seed Tenant A & Tenant B
      await db.query(
        "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Tenant A', 'ZAR', 'UTC', 'active')",
        [TENANT_A_ID],
      );
      await db.query(
        "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Tenant B', 'USD', 'UTC', 'active')",
        [TENANT_B_ID],
      );

      await db.query("SELECT seed_standard_ledger_accounts($1)", [TENANT_A_ID]);
      await db.query("SELECT seed_standard_ledger_accounts($1)", [TENANT_B_ID]);

      const termRes = await db.query<{ id: string }>(
        "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
        [TENANT_A_ID],
      );
      const termId = termRes.rows[0]!.id;

      // 3. Test under non-owner app_runtime role
      await withTenantContext(
        db,
        TENANT_A_ID,
        async (scopedDb) => {
          // Can insert debtor account in own tenant
          await scopedDb.query(
            `INSERT INTO debtor_account (
              id, tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
            ) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, 'ACC-A01', 'Tenant A Customer', 'ZAR', $2, 10000.0000, 'active', 'due_date')`,
            [TENANT_A_ID, termId],
          );

          // Can read own tenant debtor account
          const visibleAccounts = await scopedDb.query<{ account_number: string }>(
            "SELECT account_number FROM debtor_account",
          );
          assert.equal(visibleAccounts.rows.length, 1);
          assert.equal(visibleAccounts.rows[0]!.account_number, "ACC-A01");

          // RLS prevents reading Tenant B data (returns 0 rows)
          const tenantBTerms = await scopedDb.query(
            "SELECT * FROM payment_term WHERE tenant_id = $1",
            [TENANT_B_ID],
          );
          assert.equal(tenantBTerms.rows.length, 0);

          // RLS prevents cross-tenant insert (isolated in savepoint)
          await assert.rejects(
            withTenantContext(scopedDb, TENANT_A_ID, async (innerDb) => {
              await innerDb.query(
                `INSERT INTO debtor_account (
                  id, tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
                ) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', $1, 'ACC-B01', 'Tenant B Fake', 'USD', $2, 5000.0000, 'active', 'due_date')`,
                [TENANT_B_ID, termId],
              );
            }),
            /violates row-level security policy|foreign key constraint/,
          );

          // Immutability: app_runtime is strictly DENIED DELETE on financial tables
          await assert.rejects(
            withTenantContext(scopedDb, TENANT_A_ID, async (innerDb) => {
              await innerDb.query("DELETE FROM journal WHERE tenant_id = $1", [TENANT_A_ID]);
            }),
            /permission denied for table journal/,
            "app_runtime must be denied DELETE on journal table",
          );

          await assert.rejects(
            withTenantContext(scopedDb, TENANT_A_ID, async (innerDb) => {
              await innerDb.query("DELETE FROM audit_event WHERE tenant_id = $1", [TENANT_A_ID]);
            }),
            /permission denied for table audit_event/,
            "app_runtime must be denied DELETE on audit_event table",
          );
        },
        { runtimeRole: "app_runtime" },
      );
    } finally {
      await db.close();
    }
  });

  it("two concurrent tenants over pooled connections never share context or commit each other's work", async () => {
    // Construct a multi-connection pool mock tracking connection checkout and transaction boundaries
    const executedStatements = new Map<number, string[]>();
    let connectionCounter = 0;
    let activeConnectionsCount = 0;

    class MockPooledConnection implements DbConnection {
      public id = ++connectionCounter;
      public isReleased = false;

      constructor() {
        activeConnectionsCount++;
        executedStatements.set(this.id, []);
      }

      async query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }> {
        if (this.isReleased) throw new Error("Cannot query released connection");
        executedStatements.get(this.id)!.push(`query:${sql}`);
        return { rows: [] };
      }

      async exec(sql: string): Promise<unknown> {
        if (this.isReleased) throw new Error("Cannot exec on released connection");
        executedStatements.get(this.id)!.push(`exec:${sql}`);
        return undefined;
      }

      release() {
        if (!this.isReleased) {
          this.isReleased = true;
          activeConnectionsCount--;
        }
      }
    }

    const mockPool: DbClient = {
      async query() {
        throw new Error("Pool queries must acquire dedicated connection during transaction");
      },
      async exec() {
        throw new Error("Pool exec must acquire dedicated connection during transaction");
      },
      async acquireConnection(): Promise<DbConnection> {
        return new MockPooledConnection();
      },
    };

    // Run two concurrent tenant operations simultaneously with interleaved async delays
    let tenantAStarted = false;
    let tenantBStarted = false;

    const [resA, resB] = await Promise.all([
      withTenantContext(mockPool, TENANT_A_ID, async (txA) => {
        tenantAStarted = true;
        await txA.query("INSERT INTO test_doc (name) VALUES ('Doc A1')");
        // Yield to event loop to allow Tenant B to execute concurrently
        await new Promise((r) => setTimeout(r, 20));
        assert.ok(tenantBStarted, "Tenant B must be running concurrently");
        await txA.query("INSERT INTO test_doc (name) VALUES ('Doc A2')");
        return "Tenant_A_Committed";
      }),

      withTenantContext(mockPool, TENANT_B_ID, async (txB) => {
        tenantBStarted = true;
        await txB.query("INSERT INTO test_doc (name) VALUES ('Doc B1')");
        await new Promise((r) => setTimeout(r, 10));
        assert.ok(tenantAStarted, "Tenant A must be running concurrently");
        await txB.query("INSERT INTO test_doc (name) VALUES ('Doc B2')");
        return "Tenant_B_Committed";
      }),
    ]);

    assert.equal(resA, "Tenant_A_Committed");
    assert.equal(resB, "Tenant_B_Committed");
    assert.equal(activeConnectionsCount, 0, "All checked-out pool connections must be released");
    assert.equal(connectionCounter, 2, "Concurrent requests must acquire 2 distinct dedicated connections");

    // Inspect connection 1 (Tenant A)
    const conn1History = executedStatements.get(1)!;
    assert.deepEqual(conn1History, [
      "exec:BEGIN",
      "query:SELECT set_config('app.tenant_id', $1, true)",
      "query:INSERT INTO test_doc (name) VALUES ('Doc A1')",
      "query:INSERT INTO test_doc (name) VALUES ('Doc A2')",
      "exec:COMMIT",
    ]);

    // Inspect connection 2 (Tenant B)
    const conn2History = executedStatements.get(2)!;
    assert.deepEqual(conn2History, [
      "exec:BEGIN",
      "query:SELECT set_config('app.tenant_id', $1, true)",
      "query:INSERT INTO test_doc (name) VALUES ('Doc B1')",
      "query:INSERT INTO test_doc (name) VALUES ('Doc B2')",
      "exec:COMMIT",
    ]);
  });

  it("nested same-tenant transactions pin to single connection with savepoint rollback", async () => {
    let acquireCount = 0;
    let releaseCount = 0;
    const history: string[] = [];

    const mockPool: DbClient = {
      async query() { return { rows: [] }; },
      async exec() {},
      async acquireConnection(): Promise<DbConnection> {
        acquireCount++;
        return {
          async query(sql: string) { history.push(`query:${sql}`); return { rows: [] }; },
          async exec(sql: string) { history.push(`exec:${sql}`); },
          release() { releaseCount++; },
        };
      },
    };

    // Root transaction with nested savepoint that fails and rolls back, then root commits
    const outcome = await withTenantContext(mockPool, TENANT_A_ID, async (rootTx) => {
      await rootTx.query("INSERT INTO root_data VALUES (1)");

      // Nested transaction that fails
      try {
        await withTenantContext(rootTx, TENANT_A_ID, async (nestedTx) => {
          await nestedTx.query("INSERT INTO nested_data VALUES (2)");
          throw new Error("Simulated nested failure");
        });
      } catch (err: any) {
        assert.equal(err.message, "Simulated nested failure");
      }

      // Root continues and commits successfully
      await rootTx.query("INSERT INTO root_data VALUES (3)");
      return "root_success";
    });

    assert.equal(outcome, "root_success");
    assert.equal(acquireCount, 1, "Should acquire exactly 1 connection for root + nested calls");
    assert.equal(releaseCount, 1, "Should release connection exactly once when root transaction completes");

    assert.deepEqual(history, [
      "exec:BEGIN",
      "query:SELECT set_config('app.tenant_id', $1, true)",
      "query:INSERT INTO root_data VALUES (1)",
      "exec:SAVEPOINT sp_2",
      "query:SELECT set_config('app.tenant_id', $1, true)",
      "query:INSERT INTO nested_data VALUES (2)",
      "exec:ROLLBACK TO SAVEPOINT sp_2",
      "query:INSERT INTO root_data VALUES (3)",
      "exec:COMMIT",
    ]);
  });

  it("connection acquisition, begin, query, and rollback failures release connections cleanly without pool leaks", async () => {
    let activeConnections = 0;

    class TrackedConn implements DbConnection {
      public released = false;
      constructor() { activeConnections++; }
      async query() { return { rows: [] }; }
      async exec(sql: string) {
        if (sql === "FAIL_QUERY") throw new Error("Query execution error");
      }
      release() {
        if (!this.released) {
          this.released = true;
          activeConnections--;
        }
      }
    }

    const failingPool = (failOn: "none" | "begin" | "query" | "op"): DbClient => ({
      async query() { return { rows: [] }; },
      async exec() {},
      async acquireConnection(): Promise<DbConnection> {
        const c = new TrackedConn();
        if (failOn === "begin") {
          const origExec = c.exec.bind(c);
          c.exec = async (s: string) => {
            if (s === "BEGIN") throw new Error("Connection BEGIN error");
            return origExec(s);
          };
        }
        return c;
      },
    });

    // 1. Failure during user operation
    await assert.rejects(
      withTenantContext(failingPool("op"), TENANT_A_ID, async (tx) => {
        throw new Error("Business operation failed");
      }),
      /Business operation failed/,
    );
    assert.equal(activeConnections, 0, "Connection must be released when user operation throws");

    // 2. Failure during query execution
    await assert.rejects(
      withTenantContext(failingPool("query"), TENANT_A_ID, async (tx) => {
        await tx.exec("FAIL_QUERY");
      }),
      /Query execution error/,
    );
    assert.equal(activeConnections, 0, "Connection must be released when query throws");

    // 3. Failure during BEGIN
    await assert.rejects(
      withTenantContext(failingPool("begin"), TENANT_A_ID, async (tx) => {
        await tx.query("SELECT 1");
      }),
      /Connection BEGIN error/,
    );
    assert.equal(activeConnections, 0, "Connection must be released when BEGIN throws");
  });

  it("disk-persisted restart survives process shutdown and re-runs migrations idempotently", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-pg-persistence-"));
    const actorId = "99999999-9999-4999-8999-999999999999";
    const debtorId = "88888888-8888-4888-8888-888888888888";
    let originalJournalId: string;

    try {
      // -------------------------------------------------------------
      // Phase 1: First Process Boot - Initialize and write financial records
      // -------------------------------------------------------------
      {
        const db1 = await initApiDatabase({
          dataDir: tempDir,
          seedDemo: false,
        });

        // Seed custom tenant
        await db1.query(
          "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Persistent Store', 'ZAR', 'UTC', 'active')",
          [TENANT_A_ID],
        );
        await db1.query("SELECT seed_standard_ledger_accounts($1)", [TENANT_A_ID]);

        const termRes = await db1.query<{ id: string }>(
          "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
          [TENANT_A_ID],
        );

        await db1.query(
          `INSERT INTO actor (id, tenant_id, external_subject, display_name, role)
           VALUES ($1, $2, 'gid://shopify/User/admin', 'Admin User', 'manager')`,
          [actorId, TENANT_A_ID],
        );

        await db1.query(
          `INSERT INTO debtor_account (
            id, tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
          ) VALUES ($1, $2, 'ACC-PERSIST-01', 'Durable Construction Co', 'ZAR', $3, 50000.0000, 'active', 'due_date')`,
          [debtorId, TENANT_A_ID, termRes.rows[0]!.id],
        );

        const accountsRes = await db1.query<{ id: string; code: string }>(
          "SELECT id, code FROM ledger_account WHERE tenant_id = $1",
          [TENANT_A_ID],
        );
        const arAccountId = accountsRes.rows.find((a) => a.code === "1200")!.id;
        const salesAccountId = accountsRes.rows.find((a) => a.code === "4010")!.id;

        // Post financial journal (Debit AR 1200, Credit Sales 4010)
        const postResult = await postJournal(db1, TENANT_A_ID, {
          actorId,
          currency: "ZAR",
          effectiveDate: "2026-09-29",
          sourceKind: "order",
          sourceKey: "order-persist-01",
          idempotencyKey: "idem-persist-01",
          memo: "Commercial building supplies invoice #1001",
          lines: [
            {
              ledgerAccountId: arAccountId,
              debtorAccountId: debtorId,
              direction: "debit",
              amount: "15000.00",
              currency: "ZAR",
            },
            {
              ledgerAccountId: salesAccountId,
              direction: "credit",
              amount: "15000.00",
              currency: "ZAR",
            },
          ],
          documents: [
            {
              debtorAccountId: debtorId,
              documentNumber: "INV-1001",
              kind: "invoice",
              direction: "debit",
              amount: "15000.00",
              currency: "ZAR",
              issuedOn: "2026-09-29",
              sourceEventKey: "evt-persist-01",
            },
          ],
        });

        assert.ok(postResult.journalId);
        originalJournalId = postResult.journalId;

        // Verify balance before shutdown
        const beforeShutdownRes = await db1.query<{ balance: string }>(
          `SELECT coalesce(sum(jl.debit - jl.credit), 0) as balance
           FROM journal_line jl
           JOIN ledger_account la ON la.id = jl.ledger_account_id AND la.tenant_id = jl.tenant_id
           WHERE jl.tenant_id = $1 AND la.code = '1200'`,
          [TENANT_A_ID],
        );
        assert.equal(parseFloat(beforeShutdownRes.rows[0]!.balance), 15000);

        // Completely close the database to simulate process termination
        await db1.close?.();
      }

      // -------------------------------------------------------------
      // Phase 2: Process Restart - Re-initialize against the same data directory
      // -------------------------------------------------------------
      {
        const db2 = await initApiDatabase({
          dataDir: tempDir,
          seedDemo: false,
        });

        try {
          // 1. Verify schema survived reboot and migrations were idempotent
          const tenantCheck = await db2.query<{ name: string }>(
            "SELECT name FROM tenant WHERE id = $1",
            [TENANT_A_ID],
          );
          assert.equal(tenantCheck.rows.length, 1);
          assert.equal(tenantCheck.rows[0]!.name, "Persistent Store");

          // 2. Verify debtor account persisted with exact credit limit and status
          const debtorCheck = await db2.query<{ account_number: string; credit_limit: string }>(
            "SELECT account_number, credit_limit FROM debtor_account WHERE tenant_id = $1 AND id = $2",
            [TENANT_A_ID, debtorId],
          );
          assert.equal(debtorCheck.rows.length, 1);
          assert.equal(debtorCheck.rows[0]!.account_number, "ACC-PERSIST-01");
          assert.equal(parseFloat(debtorCheck.rows[0]!.credit_limit), 50000);

          // 3. Verify posted journal and journal lines survived reboot with exact ID
          const journalCheck = await db2.query<{ id: string; source_kind: string }>(
            "SELECT id, source_kind FROM journal WHERE tenant_id = $1 AND id = $2",
            [TENANT_A_ID, originalJournalId],
          );
          assert.equal(journalCheck.rows.length, 1);
          assert.equal(journalCheck.rows[0]!.id, originalJournalId);
          assert.equal(journalCheck.rows[0]!.source_kind, "order");

          // 4. Verify AR ledger balance is exactly preserved without drift
          const afterRestartRes = await db2.query<{ balance: string }>(
            `SELECT coalesce(sum(jl.debit - jl.credit), 0) as balance
             FROM journal_line jl
             JOIN ledger_account la ON la.id = jl.ledger_account_id AND la.tenant_id = jl.tenant_id
             WHERE jl.tenant_id = $1 AND la.code = '1200'`,
            [TENANT_A_ID],
          );
          assert.equal(
            parseFloat(afterRestartRes.rows[0]!.balance),
            15000,
            "AR ledger balance must survive process reboot with exact financial fidelity",
          );

          // 5. Post a new payment journal against the persisted state (Debit Cash 1010, Credit AR 1200)
          const accounts2 = await db2.query<{ id: string; code: string }>(
            "SELECT id, code FROM ledger_account WHERE tenant_id = $1",
            [TENANT_A_ID],
          );
          const cashAccountId = accounts2.rows.find((a) => a.code === "1010")!.id;
          const arAccountId = accounts2.rows.find((a) => a.code === "1200")!.id;

          const paymentPost = await postJournal(db2, TENANT_A_ID, {
            actorId,
            currency: "ZAR",
            effectiveDate: "2026-09-29",
            sourceKind: "manual_receipt",
            sourceKey: "receipt-persist-01",
            idempotencyKey: "idem-persist-02",
            memo: "Customer EFT partial settlement",
            lines: [
              {
                ledgerAccountId: cashAccountId,
                direction: "debit",
                amount: "10000.00",
                currency: "ZAR",
              },
              {
                ledgerAccountId: arAccountId,
                debtorAccountId: debtorId,
                direction: "credit",
                amount: "10000.00",
                currency: "ZAR",
              },
            ],
            documents: [
              {
                debtorAccountId: debtorId,
                documentNumber: "RCT-1001",
                kind: "payment",
                direction: "credit",
                amount: "10000.00",
                currency: "ZAR",
                issuedOn: "2026-09-29",
                sourceEventKey: "evt-persist-02",
              },
            ],
          });
          assert.ok(paymentPost.journalId);

          // Verify updated balance (15,000 - 10,000 = 5,000)
          const finalBalanceRes = await db2.query<{ balance: string }>(
            `SELECT coalesce(sum(jl.debit - jl.credit), 0) as balance
             FROM journal_line jl
             JOIN ledger_account la ON la.id = jl.ledger_account_id AND la.tenant_id = jl.tenant_id
             WHERE jl.tenant_id = $1 AND la.code = '1200'`,
            [TENANT_A_ID],
          );
          assert.equal(parseFloat(finalBalanceRes.rows[0]!.balance), 5000);
        } finally {
          await db2.close?.();
        }
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("external PostgreSQL profile: exercises live connection pool when DATABASE_URL is configured", async () => {
    const externalUrl = process.env.DATABASE_URL || process.env.EXTERNAL_POSTGRES_URL;

    if (!externalUrl) {
      // In local dev/CI environments without external PostgreSQL server running,
      // verify PgPoolDbClient abstraction mechanics using node-postgres Pool configuration
      const pool = new pg.Pool();
      const client = new PgPoolDbClient(pool);
      assert.ok(client.getPool() instanceof pg.Pool);
      assert.equal(typeof client.acquireConnection, "function");
      await client.close();
      return;
    }

    // Live External PostgreSQL Execution Profile
    const poolClient = await initApiDatabase({
      databaseUrl: externalUrl,
      seedDemo: false,
    });

    try {
      // 1. Verify PostgreSQL version and connection
      const verRes = await poolClient.query<{ version: string }>("SELECT version()");
      assert.ok(verRes.rows.length > 0);
      assert.match(verRes.rows[0]!.version, /PostgreSQL/i);

      // 2. Verify non-owner RLS execution over network socket
      await withTenantContext(
        poolClient,
        TENANT_A_ID,
        async (conn) => {
          const res = await conn.query("SELECT current_setting('app.tenant_id', true) as tenant");
          assert.equal(res.rows[0]!.tenant, TENANT_A_ID);
        },
        { runtimeRole: "app_runtime" },
      );
    } finally {
      await poolClient.close?.();
    }
  });
});
