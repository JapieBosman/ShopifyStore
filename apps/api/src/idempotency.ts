import crypto from "node:crypto";
import type { DbClient } from "../../../packages/database/tenant-context.ts";

export interface IdempotencyRecord {
  tenantId: string;
  idempotencyKey: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
  status: "in_progress" | "completed";
  createdAt: Date;
}

export type IdempotencyClaimResult =
  | { state: "acquired" }
  | { state: "cached"; record: IdempotencyRecord }
  | { state: "conflict"; message: string }
  | { state: "in_flight" };

export interface IdempotencyStore {
  claim(tenantId: string, idempotencyKey: string, requestHash: string): Promise<IdempotencyClaimResult>;
  complete(tenantId: string, idempotencyKey: string, statusCode: number, responseBody: unknown, client?: DbClient): Promise<void>;
  release(tenantId: string, idempotencyKey: string): Promise<void>;
  get(tenantId: string, idempotencyKey: string): Promise<IdempotencyRecord | null>;
  save(record: Omit<IdempotencyRecord, "status">): Promise<void>;
  verifyAndLockLease(tenantId: string, idempotencyKey: string, client?: DbClient): Promise<void>;
}

/**
 * Deterministically normalizes and sorts object keys to produce a stable JSON representation.
 */
export function canonicalizeJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalizeJson((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

/**
 * Computes a SHA-256 hash of the canonical request payload.
 */
export function computeRequestHash(payload: unknown): string {
  const canonical = canonicalizeJson(payload);
  const jsonStr = JSON.stringify(canonical);
  return crypto.createHash("sha256").update(jsonStr).digest("hex");
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  private makeKey(tenantId: string, idempotencyKey: string): string {
    return `${tenantId}:${idempotencyKey}`;
  }

  async claim(tenantId: string, idempotencyKey: string, requestHash: string): Promise<IdempotencyClaimResult> {
    const key = this.makeKey(tenantId, idempotencyKey);
    const existing = this.records.get(key);

    if (existing) {
      if (existing.status === "in_progress") {
        return { state: "in_flight" };
      }
      if (existing.requestHash !== requestHash) {
        return { state: "conflict", message: "Idempotency key reused with different request payload" };
      }
      return { state: "cached", record: existing };
    }

    this.records.set(key, {
      tenantId,
      idempotencyKey,
      requestHash,
      statusCode: 0,
      responseBody: null,
      status: "in_progress",
      createdAt: new Date(),
    });

    return { state: "acquired" };
  }

  async complete(
    tenantId: string,
    idempotencyKey: string,
    statusCode: number,
    responseBody: unknown,
    _client?: DbClient,
  ): Promise<void> {
    const key = this.makeKey(tenantId, idempotencyKey);
    const existing = this.records.get(key);
    if (existing) {
      existing.statusCode = statusCode;
      existing.responseBody = responseBody;
      existing.status = "completed";
    }
  }

  async verifyAndLockLease(tenantId: string, idempotencyKey: string, _client?: DbClient): Promise<void> {
    const key = this.makeKey(tenantId, idempotencyKey);
    const existing = this.records.get(key);
    if (!existing || existing.status !== "in_progress") {
      throw new Error("idempotency_lease_lost");
    }
  }

  async release(tenantId: string, idempotencyKey: string): Promise<void> {
    const key = this.makeKey(tenantId, idempotencyKey);
    const existing = this.records.get(key);
    if (existing && existing.status === "in_progress") {
      this.records.delete(key);
    }
  }

  async get(tenantId: string, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const rec = this.records.get(this.makeKey(tenantId, idempotencyKey));
    return rec ?? null;
  }

  async save(record: Omit<IdempotencyRecord, "status">): Promise<void> {
    this.records.set(this.makeKey(record.tenantId, record.idempotencyKey), {
      ...record,
      status: "completed",
    });
  }

  clear(): void {
    this.records.clear();
  }
}

export class PostgresIdempotencyStore implements IdempotencyStore {
  private db: DbClient;

  constructor(db: DbClient) {
    this.db = db;
  }

  setDb(db: DbClient): void {
    this.db = db;
  }

  async claim(tenantId: string, idempotencyKey: string, requestHash: string): Promise<IdempotencyClaimResult> {
    // Attempt atomic insertion of in-progress record
    const insertRes = await this.db.query(
      `INSERT INTO api_idempotency (tenant_id, idempotency_key, request_hash, status, created_at)
       VALUES ($1, $2, $3, 'in_progress', now())
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING status`,
      [tenantId, idempotencyKey, requestHash],
    );

    if (insertRes.rows.length > 0) {
      // Successfully acquired lock
      return { state: "acquired" };
    }

    // Row already exists - inspect its state
    const existingRes = await this.db.query<{
      tenant_id: string;
      idempotency_key: string;
      request_hash: string;
      status_code: number | null;
      response_body: unknown;
      status: "in_progress" | "completed";
      created_at: string | Date;
    }>(
      `SELECT tenant_id, idempotency_key, request_hash, status_code, response_body, status, created_at
       FROM api_idempotency
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey],
    );

    if (existingRes.rows.length === 0) {
      return { state: "acquired" };
    }

    const row = existingRes.rows[0]!;
    if (row.request_hash !== requestHash) {
      return { state: "conflict", message: "Idempotency key reused with different request payload" };
    }

    if (row.status === "in_progress") {
      // 1. Crash recovery check: Did financial journal post before the crash?
      const journalRes = await this.db.query<{ id: string; currency: string }>(
        `SELECT id, currency FROM journal WHERE tenant_id = $1 AND idempotency_key = $2`,
        [tenantId, idempotencyKey],
      );

      if (journalRes.rows.length > 0) {
        const journal = journalRes.rows[0]!;
        const docsRes = await this.db.query<{ id: string; amount: string }>(
          `SELECT id, amount FROM document WHERE tenant_id = $1 AND journal_id = $2`,
          [tenantId, journal.id],
        );
        const docId = docsRes.rows[0]?.id;
        const recoveredBody = {
          journalId: journal.id,
          documentId: docId,
          amount: docsRes.rows[0]?.amount || "0.0000",
          currency: journal.currency,
          recoveredAfterCrash: true,
        };

        await this.complete(tenantId, idempotencyKey, 201, recoveredBody);
        return {
          state: "cached",
          record: {
            tenantId,
            idempotencyKey,
            requestHash,
            statusCode: 201,
            responseBody: recoveredBody,
            status: "completed",
            createdAt: new Date(),
          },
        };
      }

      // Check allocation crash recovery
      const allocRes = await this.db.query<{ id: string }>(
        `SELECT id FROM allocation WHERE tenant_id = $1 AND idempotency_key = $2`,
        [tenantId, idempotencyKey],
      );
      if (allocRes.rows.length > 0) {
        const recoveredBody = {
          allocationId: allocRes.rows[0]!.id,
          recoveredAfterCrash: true,
        };
        await this.complete(tenantId, idempotencyKey, 201, recoveredBody);
        return {
          state: "cached",
          record: {
            tenantId,
            idempotencyKey,
            requestHash,
            statusCode: 201,
            responseBody: recoveredBody,
            status: "completed",
            createdAt: new Date(),
          },
        };
      }

      // 2. Check if lease expired (process crashed before financial posting)
      const leaseTimeoutSec = 30; // 30 seconds max in-flight lease
      const rowAgeMs = Date.now() - new Date(row.created_at).getTime();
      if (rowAgeMs > leaseTimeoutSec * 1000) {
        // Lease expired without committing: worker crashed before posting.
        // Renew lease atomically for this retry
        await this.db.query(
          `UPDATE api_idempotency
           SET created_at = now()
           WHERE tenant_id = $1 AND idempotency_key = $2 AND status = 'in_progress'`,
          [tenantId, idempotencyKey],
        );
        return { state: "acquired" };
      }

      return { state: "in_flight" };
    }

    return {
      state: "cached",
      record: {
        tenantId: row.tenant_id,
        idempotencyKey: row.idempotency_key,
        requestHash: row.request_hash,
        statusCode: row.status_code ?? 200,
        responseBody: row.response_body,
        status: "completed",
        createdAt: new Date(row.created_at),
      },
    };
  }

  async complete(
    tenantId: string,
    idempotencyKey: string,
    statusCode: number,
    responseBody: unknown,
    client?: DbClient,
  ): Promise<void> {
    const runner = client || this.db;
    await runner.query(
      `UPDATE api_idempotency
       SET status_code = $3, response_body = $4, status = 'completed'
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey, statusCode, JSON.stringify(responseBody)],
    );
  }

  async verifyAndLockLease(tenantId: string, idempotencyKey: string, client?: DbClient): Promise<void> {
    const runner = client || this.db;
    const lockRes = await runner.query<{ status: string }>(
      `SELECT status FROM api_idempotency WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE`,
      [tenantId, idempotencyKey],
    );
    if (lockRes.rows.length === 0 || lockRes.rows[0]!.status !== "in_progress") {
      throw new Error("idempotency_lease_lost");
    }
  }

  async release(tenantId: string, idempotencyKey: string): Promise<void> {
    await this.db.query(
      `DELETE FROM api_idempotency
       WHERE tenant_id = $1 AND idempotency_key = $2 AND status = 'in_progress'`,
      [tenantId, idempotencyKey],
    );
  }

  async get(tenantId: string, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const res = await this.db.query<{
      tenant_id: string;
      idempotency_key: string;
      request_hash: string;
      status_code: number | null;
      response_body: unknown;
      status: "in_progress" | "completed";
      created_at: string | Date;
    }>(
      `SELECT tenant_id, idempotency_key, request_hash, status_code, response_body, status, created_at
       FROM api_idempotency
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey],
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0]!;
    return {
      tenantId: row.tenant_id,
      idempotencyKey: row.idempotency_key,
      requestHash: row.request_hash,
      statusCode: row.status_code ?? 200,
      responseBody: row.response_body,
      status: row.status,
      createdAt: new Date(row.created_at),
    };
  }

  async save(record: Omit<IdempotencyRecord, "status">): Promise<void> {
    await this.db.query(
      `INSERT INTO api_idempotency (tenant_id, idempotency_key, request_hash, status_code, response_body, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6)
       ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
       SET status_code = EXCLUDED.status_code, response_body = EXCLUDED.response_body, status = 'completed'`,
      [
        record.tenantId,
        record.idempotencyKey,
        record.requestHash,
        record.statusCode,
        JSON.stringify(record.responseBody),
        record.createdAt.toISOString(),
      ],
    );
  }
}
