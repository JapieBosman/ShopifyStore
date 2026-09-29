import type { DbClient } from "../../../packages/database/tenant-context.ts";

export interface InboxItem {
  id: string;
  tenantId: string;
  webhookId: string;
  eventId: string | null;
  topic: string;
  apiVersion: string;
  payload: Record<string, unknown>;
  receivedAt: Date;
  status: "pending" | "processing" | "complete" | "failed";
}

export type WebhookTopicHandler = (item: InboxItem, client: DbClient) => Promise<void>;

export class InboxProcessor {
  private topicHandlers = new Map<string, WebhookTopicHandler>();

  public registerHandler(topic: string, handler: WebhookTopicHandler): this {
    this.topicHandlers.set(topic, handler);
    return this;
  }

  /**
   * Claims a batch of pending webhook inbox rows using SKIP LOCKED.
   */
  public async claimPendingBatch(client: DbClient, tenantId: string, limit = 10): Promise<InboxItem[]> {
    const query = `
      WITH candidate AS (
        SELECT id
        FROM webhook_inbox
        WHERE tenant_id = $1
          AND status = 'pending'
        ORDER BY received_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE webhook_inbox w
      SET status = 'processing',
          attempt_count = w.attempt_count + 1
      FROM candidate c
      WHERE w.id = c.id
      RETURNING
        w.id,
        w.tenant_id as "tenantId",
        w.webhook_id as "webhookId",
        w.event_id as "eventId",
        w.topic,
        w.api_version as "apiVersion",
        w.payload,
        w.received_at as "receivedAt",
        w.status
    `;

    const res = await client.query<InboxItem>(query, [tenantId, limit]);
    return res.rows;
  }

  /**
   * Processes a single claimed inbox item and updates its status.
   */
  public async processItem(client: DbClient, item: InboxItem): Promise<boolean> {
    const handler = this.topicHandlers.get(item.topic);
    try {
      if (handler) {
        await handler(item, client);
      }
      await client.query(
        "UPDATE webhook_inbox SET status = 'complete', processed_at = now() WHERE tenant_id = $1 AND id = $2",
        [item.tenantId, item.id],
      );
      return true;
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      await client.query(
        "UPDATE webhook_inbox SET status = 'failed', last_error_code = $3 WHERE tenant_id = $1 AND id = $2",
        [item.tenantId, item.id, code],
      );
      return false;
    }
  }

  /**
   * Claims and processes a full batch of inbox items.
   */
  public async processBatch(client: DbClient, tenantId: string, limit = 10): Promise<{ processed: number; failed: number }> {
    const items = await this.claimPendingBatch(client, tenantId, limit);
    let processed = 0;
    let failed = 0;

    for (const item of items) {
      const ok = await this.processItem(client, item);
      if (ok) {
        processed++;
      } else {
        failed++;
      }
    }

    return { processed, failed };
  }
}
