export interface DbConnection extends DbClient {
  release?(): void;
}

export interface DbClient {
  query<R = Record<string, unknown>>(query: string, params?: unknown[]): Promise<{ rows: R[] }>;
  exec(sql: string): Promise<unknown>;
  acquireConnection?(): Promise<DbConnection>;
  close?(): Promise<void>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateTenantId(tenantId: string): string {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new TypeError(`Invalid tenant ID: expected UUID, got '${tenantId}'`);
  }
  return tenantId;
}

const TX_DEPTH = Symbol("tx_depth");

export interface TenantContextOptions {
  runtimeRole?: string;
}

/**
 * Executes a callback within an isolated database transaction with the tenant context set.
 * For pooled clients, checks out a dedicated connection from the pool so that BEGIN,
 * set_config, business queries, and COMMIT run on the exact same PostgreSQL connection.
 * The tenant setting is local to the transaction (is_local = true), preventing context leakage.
 * Supports re-entrant/nested calls on the same connection via SQL savepoints without leaking state
 * across concurrent requests.
 */
export async function withTenantContext<T>(
  client: DbClient,
  tenantId: string,
  operation: (client: DbClient) => Promise<T>,
  options?: TenantContextOptions,
): Promise<T> {
  const validTenant = validateTenantId(tenantId);
  const clientAny = client as any;
  const existingDepth = clientAny[TX_DEPTH];

  let conn: DbClient;
  let shouldRelease = false;

  if (typeof existingDepth === "number" && existingDepth > 0) {
    // Nested transaction inside an active transaction context on this dedicated connection
    conn = client;
  } else if (typeof client.acquireConnection === "function") {
    // Acquire dedicated connection from the connection pool
    conn = await client.acquireConnection();
    shouldRelease = true;
  } else {
    // Single client / direct connection (e.g. PGlite): wrap in scoped adapter so concurrent requests never share TX_DEPTH
    conn = {
      query: (q, p) => client.query(q, p),
      exec: (s) => client.exec(s),
    };
  }

  const connAny = conn as any;
  const depth = (connAny[TX_DEPTH] || 0) + 1;
  connAny[TX_DEPTH] = depth;

  const isRoot = depth === 1;
  const savepointName = `sp_${depth}`;

  try {
    if (isRoot) {
      await conn.exec("BEGIN");
    } else {
      await conn.exec(`SAVEPOINT ${savepointName}`);
    }

    const runtimeRole = options?.runtimeRole || process.env.PG_RUNTIME_ROLE;
    if (runtimeRole && isRoot) {
      await conn.exec(`SET LOCAL ROLE ${runtimeRole}`);
    }

    await conn.query("SELECT set_config('app.tenant_id', $1, true)", [validTenant]);
    const result = await operation(conn);
    if (isRoot) {
      await conn.exec("COMMIT");
    } else {
      await conn.exec(`RELEASE SAVEPOINT ${savepointName}`);
    }
    return result;
  } catch (err) {
    try {
      if (isRoot) {
        await conn.exec("ROLLBACK");
      } else {
        await conn.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      }
    } catch {
      // Preserve original error if rollback fails
    }
    throw err;
  } finally {
    connAny[TX_DEPTH] = depth - 1;
    if (depth - 1 === 0) {
      delete connAny[TX_DEPTH];
    }
    if (shouldRelease && isRoot) {
      try {
        (conn as DbConnection).release?.();
      } catch {
        // Ignore release errors
      }
    }
  }
}

/**
 * Tenant-aware repository helper for executing scoped queries.
 */
export class TenantRepository {
  private readonly client: DbClient;
  public readonly tenantId: string;

  constructor(client: DbClient, tenantId: string) {
    this.client = client;
    this.tenantId = validateTenantId(tenantId);
  }

  public async getTenant(): Promise<{ id: string; name: string; base_currency: string; timezone: string; status: string } | null> {
    const res = await this.client.query<{ id: string; name: string; base_currency: string; timezone: string; status: string }>(
      "SELECT id, name, base_currency, timezone, status FROM tenant WHERE id = $1",
      [this.tenantId],
    );
    return res.rows[0] ?? null;
  }

  public async listPaymentTerms(): Promise<Array<{ id: string; code: string; kind: string; days: number }>> {
    const res = await this.client.query<{ id: string; code: string; kind: string; days: number }>(
      "SELECT id, code, kind, days FROM payment_term ORDER BY code",
    );
    return res.rows;
  }

  public async getDebtorAccount(id: string): Promise<Record<string, unknown> | null> {
    const res = await this.client.query<Record<string, unknown>>(
      "SELECT * FROM debtor_account WHERE id = $1",
      [id],
    );
    return res.rows[0] ?? null;
  }
}
