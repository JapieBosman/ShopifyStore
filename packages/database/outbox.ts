import type { DbClient } from "./tenant-context.ts";

export interface NewOutboxItem {
  kind: string;
  aggregateId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
}

export interface OutboxItem {
  id: string;
  tenantId: string;
  kind: string;
  aggregateId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  availableAt: Date;
  leasedUntil: Date | null;
  completedAt: Date | null;
  attemptCount: number;
  lastErrorCode: string | null;
}

/**
 * Atomically enqueues an outbox item inside a database transaction.
 */
export async function enqueueOutboxItem(
  client: DbClient,
  tenantId: string,
  item: NewOutboxItem,
): Promise<string> {
  const query = `
    INSERT INTO outbox (
      tenant_id, kind, aggregate_id, idempotency_key, payload, available_at
    ) VALUES (
      $1, $2, $3, $4, $5, COALESCE($6, now())
    )
    ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
      SET idempotency_key = EXCLUDED.idempotency_key
    RETURNING id
  `;

  const res = await client.query<{ id: string }>(query, [
    tenantId,
    item.kind,
    item.aggregateId,
    item.idempotencyKey,
    JSON.stringify(item.payload),
    item.availableAt ? item.availableAt.toISOString() : null,
  ]);

  return res.rows[0]!.id;
}

/**
 * Claims a batch of ready outbox items using bounded leases and SKIP LOCKED concurrency control.
 */
export async function claimOutboxBatch(
  client: DbClient,
  tenantId: string,
  batchSize = 10,
  leaseSeconds = 60,
): Promise<OutboxItem[]> {
  const query = `
    WITH candidate AS (
      SELECT id
      FROM outbox
      WHERE tenant_id = $1
        AND completed_at IS NULL
        AND available_at <= now()
        AND (leased_until IS NULL OR leased_until < now())
      ORDER BY available_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox o
    SET leased_until = now() + ($3 || ' seconds')::interval,
        attempt_count = o.attempt_count + 1
    FROM candidate c
    WHERE o.id = c.id
    RETURNING 
      o.id,
      o.tenant_id as "tenantId",
      o.kind,
      o.aggregate_id as "aggregateId",
      o.idempotency_key as "idempotencyKey",
      o.payload,
      o.available_at as "availableAt",
      o.leased_until as "leasedUntil",
      o.completed_at as "completedAt",
      o.attempt_count as "attemptCount",
      o.last_error_code as "lastErrorCode"
  `;

  const res = await client.query<OutboxItem>(query, [tenantId, batchSize, leaseSeconds]);
  return res.rows;
}

/**
 * Marks an outbox item successfully completed.
 */
export async function markOutboxItemCompleted(
  client: DbClient,
  tenantId: string,
  id: string,
): Promise<void> {
  await client.query(
    "UPDATE outbox SET completed_at = now(), leased_until = NULL WHERE tenant_id = $1 AND id = $2",
    [tenantId, id],
  );
}

/**
 * Releases lease and schedules exponential backoff retry on job failure.
 */
export async function recordOutboxItemFailed(
  client: DbClient,
  tenantId: string,
  id: string,
  errorCode: string,
  retryDelaySeconds = 30,
): Promise<void> {
  await client.query(
    `UPDATE outbox 
     SET leased_until = NULL,
         last_error_code = $3,
         available_at = now() + ($4 || ' seconds')::interval
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, errorCode, retryDelaySeconds],
  );
}
