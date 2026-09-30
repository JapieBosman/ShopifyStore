import type { DbClient } from "../../../packages/database/tenant-context.ts";
import { withTenantContext } from "../../../packages/database/tenant-context.ts";
import {
  validateRecipientEmail,
  generateRecipientSecretRef,
  encryptRecipientSecretRef,
  decryptRecipientSecretRef,
  getStatementEmailProvider,
  type DeliveryChannel,
  type DeliveryStatus,
  type EmailDispatchPayload,
  type EmailLookupResult,
} from "../../../packages/domain/src/delivery.ts";
import { getStatementStorage } from "../../../packages/domain/src/storage.ts";

export interface EnqueueDeliveryOptions {
  statementId: string;
  channel: DeliveryChannel;
  recipientEmail: string;
  recipientName?: string;
  idempotencyKey: string;
}

export interface DeliveryRecord {
  id: string;
  tenantId: string;
  statementId: string;
  channel: DeliveryChannel;
  recipientSecretRef: string;
  idempotencyKey: string;
  providerMessageId: string | null;
  status: DeliveryStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  createdAt: string;
}

export interface ProcessDeliveriesResult {
  processed: number;
  succeeded: number;
  bounced: number;
  uncertain: number;
  failed: number;
  deliveries: Array<{
    id: string;
    statementId: string;
    status: DeliveryStatus;
    providerMessageId?: string;
    error?: string;
  }>;
}

export interface DeliveryCallbackEvent {
  providerMessageId: string;
  status: "delivered" | "bounced" | "failed";
  reason?: string;
  timestamp?: string;
}

/**
 * Enqueues a statement delivery request under strict tenant isolation and idempotency.
 * One authorised delivery per idempotency key.
 */
export async function enqueueStatementDelivery(
  db: DbClient,
  tenantId: string,
  options: EnqueueDeliveryOptions,
): Promise<DeliveryRecord> {
  const { statementId, channel, recipientEmail, idempotencyKey } = options;

  if (channel === "sms") {
    throw new Error("SMS delivery is deferred in v1; only email is supported");
  }

  if (channel !== "email") {
    throw new Error(`Unsupported delivery channel: ${channel}`);
  }

  const validation = validateRecipientEmail(recipientEmail);
  if (!validation.valid || !validation.normalizedEmail) {
    throw new Error(`Invalid recipient email: ${validation.error || "validation failed"}`);
  }

  const normalizedEmail = validation.normalizedEmail;
  const recipientSecretRef = encryptRecipientSecretRef(normalizedEmail);

  return await withTenantContext(db, tenantId, async (tx) => {
    // 1. Idempotency Check: if key already exists, return existing delivery record
    const existing = await tx.query<DeliveryRecord>(
      `SELECT id, tenant_id as "tenantId", statement_id as "statementId", channel,
              recipient_secret_ref as "recipientSecretRef", idempotency_key as "idempotencyKey",
              provider_message_id as "providerMessageId", status, attempt_count as "attemptCount",
              last_attempt_at as "lastAttemptAt", created_at as "createdAt"
       FROM statement_delivery
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey],
    );

    if (existing.rows.length > 0) {
      return existing.rows[0]!;
    }

    // 2. Validate statement exists and belongs to this tenant
    const stmtCheck = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM statement WHERE tenant_id = $1 AND id = $2`,
      [tenantId, statementId],
    );

    if (stmtCheck.rows.length === 0) {
      throw new Error(`Statement ${statementId} was not found for tenant`);
    }

    // 3. Insert new delivery record with status 'queued'
    const insertRes = await tx.query<DeliveryRecord>(
      `INSERT INTO statement_delivery (
         tenant_id, statement_id, channel, recipient_secret_ref, idempotency_key,
         status, attempt_count, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'queued', 0, now())
       RETURNING id, tenant_id as "tenantId", statement_id as "statementId", channel,
                 recipient_secret_ref as "recipientSecretRef", idempotency_key as "idempotencyKey",
                 provider_message_id as "providerMessageId", status, attempt_count as "attemptCount",
                 last_attempt_at as "lastAttemptAt", created_at as "createdAt"`,
      [tenantId, statementId, channel, recipientSecretRef, idempotencyKey],
    );

    return insertRes.rows[0]!;
  });
}

/**
 * Claims and executes pending queued statement deliveries for a tenant with row-level locks.
 */
export async function processQueuedDeliveries(
  db: DbClient,
  tenantId: string,
  options?: { limit?: number; maxAttempts?: number; recipientEmailOverride?: string },
): Promise<ProcessDeliveriesResult> {
  const limit = options?.limit || 10;
  const maxAttempts = options?.maxAttempts || 5;

  const result: ProcessDeliveriesResult = {
    processed: 0,
    succeeded: 0,
    bounced: 0,
    uncertain: 0,
    failed: 0,
    deliveries: [],
  };

  // Phase 1: Atomically claim pending queued deliveries in a short, committed transaction.
  // This transitions status from 'queued' to 'sending' before any remote network call.
  // If the process crashes during dispatch, the record remains in 'sending' and is NEVER re-sent blindly.
  const claimedRows = await withTenantContext(db, tenantId, async (tx) => {
    const pendingRes = await tx.query<{
      id: string;
      statement_id: string;
      recipient_secret_ref: string;
      idempotency_key: string;
      attempt_count: number;
      debtor_account_id: string;
      account_number: string;
      legal_name: string;
      closing_balance: string;
      currency: string;
      pdf_object_key: string | null;
      period_to: string | Date;
      billing_contact_email: string | null;
    }>(
      `SELECT d.id, d.statement_id, d.recipient_secret_ref, d.idempotency_key, d.attempt_count,
              a.id as debtor_account_id, a.account_number, a.legal_name, s.closing_balance, s.currency,
              s.pdf_object_key, r.period_to,
              (
                SELECT bc.email
                FROM billing_contact bc
                WHERE bc.tenant_id = d.tenant_id
                  AND bc.debtor_account_id = a.id
                  AND bc.send_statements = true
                  AND bc.email IS NOT NULL
                ORDER BY bc.created_at ASC
                LIMIT 1
              ) as billing_contact_email
       FROM statement_delivery d
       JOIN statement s ON s.id = d.statement_id AND s.tenant_id = d.tenant_id
       JOIN statement_run r ON r.id = s.statement_run_id AND r.tenant_id = d.tenant_id
       JOIN debtor_account a ON a.id = s.debtor_account_id AND a.tenant_id = d.tenant_id
       WHERE d.tenant_id = $1
         AND d.status = 'queued'
         AND d.attempt_count < $2
       ORDER BY d.created_at ASC
       LIMIT $3
       FOR UPDATE OF d SKIP LOCKED`,
      [tenantId, maxAttempts, limit],
    );

    if (pendingRes.rows.length === 0) {
      return [];
    }

    const ids = pendingRes.rows.map((r) => r.id);
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
    await tx.query(
      `UPDATE statement_delivery
       SET status = 'sending',
           attempt_count = attempt_count + 1,
           last_attempt_at = now()
       WHERE tenant_id = $1 AND id IN (${placeholders})`,
      [tenantId, ...ids],
    );

    return pendingRes.rows;
  });

  if (claimedRows.length === 0) {
    return result;
  }

  const storage = getStatementStorage();
  const emailProvider = getStatementEmailProvider();

  // Phase 2 & 3: Dispatch outside any database transaction, then record final status
  for (const row of claimedRows) {
    result.processed++;

    if (!row.pdf_object_key) {
      await withTenantContext(db, tenantId, async (tx) => {
        await tx.query(
          `UPDATE statement_delivery
           SET status = 'failed'
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, row.id],
        );
      });
      result.failed++;
      result.deliveries.push({
        id: row.id,
        statementId: row.statement_id,
        status: "failed",
        error: "Statement PDF artifact has not been rendered",
      });
      continue;
    }

    // Recipient email resolution:
    // 1. Decrypt from encrypted recipient_secret_ref
    let recipientEmail = decryptRecipientSecretRef(row.recipient_secret_ref);
    // 2. Caller override (e.g. test injection)
    if (!recipientEmail && options?.recipientEmailOverride) {
      recipientEmail = options.recipientEmailOverride;
    }
    // 3. Fallback to active debtor billing contact configured to receive statements
    if (!recipientEmail && row.billing_contact_email) {
      recipientEmail = row.billing_contact_email;
    }

    // If no valid recipient can be determined, fail closed (never send to placeholder!)
    if (!recipientEmail) {
      await withTenantContext(db, tenantId, async (tx) => {
        await tx.query(
          `UPDATE statement_delivery
           SET status = 'failed'
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, row.id],
        );
      });
      result.failed++;
      result.deliveries.push({
        id: row.id,
        statementId: row.statement_id,
        status: "failed",
        error: "No valid recipient email address could be resolved",
      });
      continue;
    }

    // Generate expiring signed download URL (7 days = 604800 seconds) bound to tenant
    const signedDownloadUrl = await storage.getSignedDownloadUrl(row.pdf_object_key, 604800, tenantId);
    const expiresAt = new Date(Date.now() + 604800 * 1000).toISOString();

    const periodEndStr =
      typeof row.period_to === "string"
        ? row.period_to
        : row.period_to instanceof Date
          ? row.period_to.toISOString().substring(0, 10)
          : String(row.period_to);

    const payload: EmailDispatchPayload = {
      tenantId,
      deliveryId: row.id,
      statementId: row.statement_id,
      idempotencyKey: row.idempotency_key,
      recipientEmail,
      recipientName: row.legal_name,
      accountNumber: row.account_number,
      statementNumber: `STMT-${row.account_number}-${periodEndStr.substring(0, 7)}`,
      periodEnd: periodEndStr,
      closingBalance: row.closing_balance,
      currency: row.currency,
      downloadUrl: signedDownloadUrl,
      expiresAt,
    };

    try {
      const dispatchResult = await emailProvider.sendStatementEmail(payload);

      await withTenantContext(db, tenantId, async (tx) => {
        await tx.query(
          `UPDATE statement_delivery
           SET status = $1,
               provider_message_id = $2
           WHERE tenant_id = $3 AND id = $4`,
          [dispatchResult.status, dispatchResult.providerMessageId, tenantId, row.id],
        );
      });

      if (dispatchResult.status === "delivered" || dispatchResult.status === "accepted") {
        result.succeeded++;
      } else if (dispatchResult.status === "bounced") {
        result.bounced++;
      } else if (dispatchResult.status === "uncertain") {
        result.uncertain++;
      } else {
        result.failed++;
      }

      result.deliveries.push({
        id: row.id,
        statementId: row.statement_id,
        status: dispatchResult.status,
        providerMessageId: dispatchResult.providerMessageId,
        error: dispatchResult.error,
      });
    } catch (err) {
      // Unexpected network exception during dispatch: mark uncertain
      await withTenantContext(db, tenantId, async (tx) => {
        await tx.query(
          `UPDATE statement_delivery
           SET status = 'uncertain'
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, row.id],
        );
      });

      result.uncertain++;
      result.deliveries.push({
        id: row.id,
        statementId: row.statement_id,
        status: "uncertain",
        error: (err as Error).message,
      });
    }
  }

  return result;
}

/**
 * Handles incoming provider status webhook callbacks (e.g. delivered, bounced, failed).
 */
export async function recordDeliveryCallback(
  db: DbClient,
  tenantId: string,
  event: DeliveryCallbackEvent,
): Promise<boolean> {
  return await withTenantContext(db, tenantId, async (tx) => {
    const findRes = await tx.query<{ id: string; actor_id: string }>(
      `SELECT d.id, r.actor_id
       FROM statement_delivery d
       JOIN statement s ON s.id = d.statement_id AND s.tenant_id = d.tenant_id
       JOIN statement_run r ON r.id = s.statement_run_id AND r.tenant_id = d.tenant_id
       WHERE d.tenant_id = $1 AND d.provider_message_id = $2
       LIMIT 1`,
      [tenantId, event.providerMessageId],
    );

    if (findRes.rows.length === 0) {
      return false;
    }

    const { id: deliveryId, actor_id: actorId } = findRes.rows[0]!;

    await tx.query(
      `UPDATE statement_delivery
       SET status = $1,
           last_attempt_at = now()
       WHERE tenant_id = $2 AND id = $3`,
      [event.status, tenantId, deliveryId],
    );

    // Record audit event
    await tx.query(
      `INSERT INTO audit_event (
         tenant_id, actor_id, action, entity_type, entity_id, correlation_id, details
       ) VALUES ($1, $2, 'delivery_callback', 'statement_delivery', $3, gen_random_uuid(), $4)`,
      [
        tenantId,
        actorId,
        deliveryId,
        JSON.stringify({
          status: event.status,
          reason: event.reason,
          timestamp: event.timestamp || new Date().toISOString(),
        }),
      ],
    );

    return true;
  });
}

/**
 * Fetches all delivery attempts for a given statement under tenant isolation.
 */
export async function getStatementDeliveries(
  db: DbClient,
  tenantId: string,
  statementId: string,
): Promise<DeliveryRecord[]> {
  return await withTenantContext(db, tenantId, async (tx) => {
    const res = await tx.query<DeliveryRecord>(
      `SELECT id, tenant_id as "tenantId", statement_id as "statementId", channel,
              recipient_secret_ref as "recipientSecretRef", idempotency_key as "idempotencyKey",
              provider_message_id as "providerMessageId", status, attempt_count as "attemptCount",
              last_attempt_at as "lastAttemptAt", created_at as "createdAt"
       FROM statement_delivery
       WHERE tenant_id = $1 AND statement_id = $2
       ORDER BY created_at DESC`,
      [tenantId, statementId],
    );
    return res.rows;
  });
}

export interface ReconcileDeliveriesResult {
  reconciled: number;
  confirmedAccepted: number;
  confirmedBounced: number;
  confirmedFailed: number;
  requeued: number;
  stillUncertain: number;
  deliveries: Array<{
    id: string;
    statementId: string;
    status: DeliveryStatus;
    action: "confirmed" | "requeued" | "unresolved";
    providerMessageId?: string;
    error?: string;
  }>;
}

/**
 * Reconciles deliveries stuck in 'uncertain' status by querying the remote email provider.
 * Does NOT blindly re-send. If the provider confirms receipt/acceptance, the record is updated
 * to 'accepted' without re-dispatching. If the provider confirms the message was never received
 * and attempt_count < maxAttempts, the delivery is safely requeued.
 */
export async function reconcileUncertainDeliveries(
  db: DbClient,
  tenantId: string,
  options?: { limit?: number; maxAttempts?: number; staleSendingThresholdMs?: number },
): Promise<ReconcileDeliveriesResult> {
  const limit = options?.limit || 10;
  const maxAttempts = options?.maxAttempts || 5;
  const staleThreshold = options?.staleSendingThresholdMs ?? 60000;
  const staleCutoff = new Date(Date.now() - staleThreshold).toISOString();

  return await withTenantContext(db, tenantId, async (tx) => {
    const uncertainRes = await tx.query<{
      id: string;
      statement_id: string;
      provider_message_id: string | null;
      idempotency_key: string;
      attempt_count: number;
      status: DeliveryStatus;
    }>(
      `SELECT id, statement_id, provider_message_id, idempotency_key, attempt_count, status
       FROM statement_delivery
       WHERE tenant_id = $1
         AND (
           status = 'uncertain'
           OR (status = 'sending' AND last_attempt_at < $2)
         )
         AND attempt_count <= $3
       ORDER BY created_at ASC
       LIMIT $4
       FOR UPDATE SKIP LOCKED`,
      [tenantId, staleCutoff, maxAttempts, limit],
    );

    const result: ReconcileDeliveriesResult = {
      reconciled: 0,
      confirmedAccepted: 0,
      confirmedBounced: 0,
      confirmedFailed: 0,
      requeued: 0,
      stillUncertain: 0,
      deliveries: [],
    };

    const emailProvider = getStatementEmailProvider();

    for (const row of uncertainRes.rows) {
      result.reconciled++;

      let providerStatus: EmailLookupResult | null = null;
      if (emailProvider.queryDeliveryStatus) {
        try {
          providerStatus = await emailProvider.queryDeliveryStatus({
            tenantId,
            providerMessageId: row.provider_message_id,
            idempotencyKey: row.idempotency_key,
            timeoutMs: 5000,
          });
        } catch (err) {
          providerStatus = { status: "unknown", reason: (err as Error).message || "Provider lookup failed" };
        }
      }

      if (providerStatus) {
        if (providerStatus.status === "accepted" || providerStatus.status === "delivered") {
          await tx.query(
            `UPDATE statement_delivery
             SET status = $1,
                 provider_message_id = COALESCE($2, provider_message_id),
                 last_attempt_at = now()
             WHERE tenant_id = $3 AND id = $4`,
            [providerStatus.status, providerStatus.providerMessageId || null, tenantId, row.id],
          );
          result.confirmedAccepted++;
          result.deliveries.push({
            id: row.id,
            statementId: row.statement_id,
            status: providerStatus.status,
            action: "confirmed",
            providerMessageId: providerStatus.providerMessageId,
          });
          continue;
        }

        if (providerStatus.status === "bounced") {
          await tx.query(
            `UPDATE statement_delivery
             SET status = 'bounced',
                 last_attempt_at = now()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, row.id],
          );
          result.confirmedBounced++;
          result.deliveries.push({
            id: row.id,
            statementId: row.statement_id,
            status: "bounced",
            action: "confirmed",
          });
          continue;
        }

        if (providerStatus.status === "failed") {
          await tx.query(
            `UPDATE statement_delivery
             SET status = 'failed',
                 last_attempt_at = now()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, row.id],
          );
          result.confirmedFailed++;
          result.deliveries.push({
            id: row.id,
            statementId: row.statement_id,
            status: "failed",
            action: "confirmed",
          });
          continue;
        }
      }

      // Only an explicit authoritative not_found proves a send did not occur.
      if (providerStatus?.status === "not_found" && row.attempt_count < maxAttempts) {
        await tx.query(
          `UPDATE statement_delivery
           SET status = 'queued',
               last_attempt_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, row.id],
        );
        result.requeued++;
        result.deliveries.push({
          id: row.id,
          statementId: row.statement_id,
          status: "queued",
          action: "requeued",
        });
        continue;
      }

      if (providerStatus?.status === "not_found") {
        await tx.query(
          `UPDATE statement_delivery
           SET status = 'failed',
               last_attempt_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, row.id],
        );
        result.confirmedFailed++;
        result.deliveries.push({
          id: row.id,
          statementId: row.statement_id,
          status: "failed",
          action: "confirmed",
          error: "Provider confirmed no message was received; retry limit reached",
        });
      } else {
        // Unknown, unavailable, or ambiguous provider response: NEVER authorise retry!
        await tx.query(
          `UPDATE statement_delivery
           SET status = 'uncertain',
               last_attempt_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, row.id],
        );
        result.stillUncertain++;
        result.deliveries.push({
          id: row.id,
          statementId: row.statement_id,
          status: "uncertain",
          action: "unresolved",
          error: (providerStatus as any)?.reason || "Provider status remains unverified; not re-sent",
        });
      }
    }

    return result;
  });
}

