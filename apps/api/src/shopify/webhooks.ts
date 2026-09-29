import crypto from "node:crypto";
import type { DbClient } from "../../../../packages/database/tenant-context.ts";

export const SUPPORTED_WEBHOOK_TOPICS = [
  "orders/create",
  "orders/updated",
  "orders/paid",
  "orders/cancelled",
  "refunds/create",
  "order_transactions/create",
  "customers/create",
  "customers/update",
  "customers/delete",
  "companies/create",
  "companies/update",
  "companies/delete",
  "company_locations/create",
  "company_locations/update",
  "company_locations/delete",
  "products/create",
  "products/update",
  "products/delete",
  "inventory_levels/update",
  "inventory_levels/connect",
  "inventory_levels/disconnect",
  "locations/create",
  "locations/update",
  "locations/delete",
  "app/uninstalled",
  "app/scopes_update",
  "app_subscriptions/update",
  "customers/data_request",
  "customers/redact",
  "shop/redact",
] as const;

export type SupportedWebhookTopic = (typeof SUPPORTED_WEBHOOK_TOPICS)[number];

export interface WebhookHeaders {
  hmacHeader?: string;
  topic?: string;
  webhookId?: string;
  eventId?: string;
  shopDomain?: string;
  apiVersion?: string;
}

export interface IngestWebhookResult {
  status: "stored" | "duplicate" | "unsupported_topic" | "invalid_signature";
  inboxId?: string;
  error?: string;
}

/**
 * Validates HMAC signature for incoming Shopify webhook payloads.
 */
export function verifyWebhookHmac(rawBody: Buffer, hmacHeader: string | undefined, secret: string): boolean {
  if (!hmacHeader || !secret) {
    return false;
  }
  const generated = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const hmacBuf = Buffer.from(hmacHeader, "utf8");
  const genBuf = Buffer.from(generated, "utf8");
  if (hmacBuf.length !== genBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(hmacBuf, genBuf);
}

/**
 * Persists an incoming webhook event into the durable inbox before sending an acknowledgement.
 * Deduplicates by (tenant_id, webhook_id).
 */
export async function ingestWebhookToInbox(
  db: DbClient,
  tenantId: string,
  rawBody: Buffer,
  headers: WebhookHeaders,
  secret: string,
): Promise<IngestWebhookResult> {
  // 1. Signature verification
  if (!verifyWebhookHmac(rawBody, headers.hmacHeader, secret)) {
    return { status: "invalid_signature", error: "HMAC signature mismatch" };
  }

  // 2. Topic check
  const topic = headers.topic;
  if (!topic || !SUPPORTED_WEBHOOK_TOPICS.includes(topic as SupportedWebhookTopic)) {
    return { status: "unsupported_topic", error: `Topic '${topic}' is not in supported catalog` };
  }

  const webhookId = headers.webhookId;
  if (!webhookId) {
    return { status: "invalid_signature", error: "Missing x-shopify-webhook-id header" };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { status: "invalid_signature", error: "Malformed JSON payload" };
  }

  // 3. Insert into webhook_inbox with ON CONFLICT DO NOTHING
  const query = `
    INSERT INTO webhook_inbox (
      tenant_id, webhook_id, event_id, topic, api_version, payload, status
    ) VALUES (
      $1, $2, $3, $4, $5, $6, 'pending'
    )
    ON CONFLICT (tenant_id, webhook_id) DO NOTHING
    RETURNING id
  `;

  const res = await db.query<{ id: string }>(query, [
    tenantId,
    webhookId,
    headers.eventId ?? null,
    topic,
    headers.apiVersion ?? "2026-07",
    JSON.stringify(payload),
  ]);

  if (res.rows.length === 0) {
    // Already ingested duplicate delivery
    return { status: "duplicate" };
  }

  return { status: "stored", inboxId: res.rows[0]?.id };
}
