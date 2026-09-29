import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { DbClient, DbConnection } from "../../../packages/database/tenant-context.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DEFAULT_TENANT_ID = process.env.TEST_TENANT_ID || "33333333-3333-4333-8333-333333333333";
export const DEFAULT_SHOP = process.env.SHOPIFY_SHOP_DOMAIN || "displaydeck.myshopify.com";

class PgPoolDbClient implements DbClient {
  constructor(private pool: pg.Pool) {}

  async query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }> {
    const res = await this.pool.query(sql, params as any[]);
    return { rows: res.rows as R[] };
  }

  async exec(sql: string): Promise<unknown> {
    return await this.pool.query(sql);
  }

  async acquireConnection(): Promise<DbConnection> {
    const client = await this.pool.connect();
    const conn: DbConnection = {
      async query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }> {
        const res = await client.query(sql, params as any[]);
        return { rows: res.rows as R[] };
      },
      async exec(sql: string): Promise<unknown> {
        return await client.query(sql);
      },
      release() {
        client.release();
      },
    };
    return conn;
  }
}

/**
 * Initializes a PostgreSQL client (via real PostgreSQL connection or PGlite fallback),
 * applies database migrations, and conditionally seeds development fixtures.
 */
export async function initApiDatabase(options: { dataDir?: string; databaseUrl?: string } = {}): Promise<DbClient> {
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL;
  let db: DbClient;

  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    db = new PgPoolDbClient(pool);
  } else {
    const dbPath = options.dataDir || process.env.PG_DATA_DIR || undefined;
    db = await PGlite.create(dbPath);
  }

  const migrationsDir = resolve(__dirname, "../../../packages/database/migrations");
  const migrations = [
    "0001_core.sql",
    "0002_posting.sql",
    "0003_allocation.sql",
    "0004_reservations.sql",
    "0005_idempotency.sql",
  ];

  for (const migration of migrations) {
    const sql = readFileSync(resolve(migrationsDir, migration), "utf8");
    await db.exec(sql);
  }

  const shouldSeedDemo =
    process.env.SEED_DEMO_DATA === "true" ||
    process.env.NODE_ENV === "test" ||
    (!databaseUrl && process.env.NODE_ENV !== "production");

  if (!shouldSeedDemo) {
    return db;
  }

  // Check if standard tenant already seeded
  const tenantRes = await db.query(
    "SELECT id FROM tenant WHERE id = $1",
    [DEFAULT_TENANT_ID],
  );

  if (tenantRes.rows.length === 0) {
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'DisplayDeck Trade Store', 'ZAR', 'UTC', 'active')",
      [DEFAULT_TENANT_ID],
    );

    // Standard ledger accounts
    await db.query("SELECT seed_standard_ledger_accounts($1)", [DEFAULT_TENANT_ID]);

    // Installation
    const instRes = await db.query<{ id: string }>(
      `INSERT INTO installation (tenant_id, shop_gid, shop_domain, status, installed_at, token_secret_ref, scopes)
       VALUES ($1, 'gid://shopify/Shop/1', $2, 'active', now(), 'secrets://test/token', ARRAY['read_customers','read_orders'])
       RETURNING id`,
      [DEFAULT_TENANT_ID, DEFAULT_SHOP],
    );
    const installationId = instRes.rows[0]!.id;

    // Location
    await db.query(
      "INSERT INTO location (tenant_id, installation_id, shopify_location_gid, name, timezone) VALUES ($1, $2, 'gid://shopify/Location/1', 'Main Store Counter', 'UTC')",
      [DEFAULT_TENANT_ID, installationId],
    );

    // Seed default Payment Term
    const termRes = await db.query<{ id: string }>(
      "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
      [DEFAULT_TENANT_ID],
    );

    // Seed sample debtor accounts for development / testing
    await db.query(
      `INSERT INTO debtor_account (
         id, tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
       ) VALUES 
         ('11111111-1111-4111-8111-111111111111', $1, 'ACC-001', 'Ubuntu Hardware Trade', 'ZAR', $2, 25000.0000, 'active', 'due_date'),
         ('22222222-2222-4222-8222-222222222222', $1, 'ACC-002', 'Cape Coastal Marine', 'ZAR', $2, 15000.0000, 'active', 'due_date')`,
      [DEFAULT_TENANT_ID, termRes.rows[0]!.id],
    );

    // Seed actors
    await db.query(
      `INSERT INTO actor (tenant_id, external_subject, display_name, role) VALUES 
         ($1, 'gid://shopify/User/1', 'Owner Admin', 'owner'),
         ($1, 'gid://shopify/User/10', 'Megan Manager', 'manager'),
         ($1, 'gid://shopify/User/20', 'Brian Bookkeeper', 'bookkeeper'),
         ($1, 'gid://shopify/User/30', 'Chloe Cashier', 'cashier')`,
      [DEFAULT_TENANT_ID],
    );
  }

  return db;
}
