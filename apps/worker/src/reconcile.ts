import type { DbClient } from "../../../packages/database/tenant-context.ts";
import type { ShopifyClient } from "../../api/src/shopify/client.ts";

export interface SyncCursorRecord {
  id: string;
  tenant_id: string;
  resource: string;
  high_water_at: Date | null;
  cursor: string | null;
  last_success_at: Date | null;
  status: string;
  created_at: Date;
}

export interface ReconcileWindowOptions {
  overlapMs?: number; // default: 2 hours (7,200,000 ms)
  defaultLookbackMs?: number; // default: 30 days
}

export interface ReconcileResult {
  resource: string;
  polledCount: number;
  recoveredMissedEvents: number;
  alreadyKnownCount: number;
  newHighWaterAt: Date | null;
  success: boolean;
  error?: string;
}

export interface ShopifyOrderNode {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  displayFinancialStatus?: string;
  cancelledAt?: string | null;
  totalPriceSet?: {
    shopMoney?: {
      amount: string;
      currencyCode: string;
    };
  };
  customer?: {
    id: string;
    email?: string | null;
  } | null;
}

/**
 * Manages persistent cursor positions in sync_cursor table with overlapping windows.
 */
export class SyncCursorManager {
  private defaultOverlapMs = 2 * 60 * 60 * 1000; // 2 hours
  private defaultLookbackMs = 30 * 24 * 60 * 60 * 1000; // 30 days

  public async getCursor(
    client: DbClient,
    tenantId: string,
    resource: string,
  ): Promise<SyncCursorRecord | null> {
    const res = await client.query<SyncCursorRecord>(
      `SELECT id, tenant_id, resource, high_water_at, cursor, last_success_at, status, created_at
       FROM sync_cursor
       WHERE tenant_id = $1 AND resource = $2`,
      [tenantId, resource],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Calculates the starting search window.
   * If a previous high_water_at exists, it steps back by overlapMs to catch out-of-order or delayed events.
   */
  public calculatePollingWindow(
    cursor: SyncCursorRecord | null,
    options?: ReconcileWindowOptions,
  ): { updatedAtMin: Date; startCursor: string | null } {
    const overlapMs = options?.overlapMs ?? this.defaultOverlapMs;
    const defaultLookbackMs = options?.defaultLookbackMs ?? this.defaultLookbackMs;

    if (cursor?.high_water_at) {
      const highWater = new Date(cursor.high_water_at);
      const updatedAtMin = new Date(highWater.getTime() - overlapMs);
      return { updatedAtMin, startCursor: cursor.cursor };
    }

    return {
      updatedAtMin: new Date(Date.now() - defaultLookbackMs),
      startCursor: null,
    };
  }

  /**
   * Persists updated cursor position after successful page/batch processing.
   */
  public async saveCursor(
    client: DbClient,
    tenantId: string,
    resource: string,
    highWaterAt: Date,
    cursor: string | null,
    status = "idle",
  ): Promise<void> {
    const query = `
      INSERT INTO sync_cursor (
        tenant_id, resource, high_water_at, cursor, last_success_at, status
      ) VALUES (
        $1, $2, $3, $4, now(), $5
      )
      ON CONFLICT (tenant_id, resource) DO UPDATE
      SET high_water_at = EXCLUDED.high_water_at,
          cursor = EXCLUDED.cursor,
          last_success_at = EXCLUDED.last_success_at,
          status = EXCLUDED.status
    `;
    await client.query(query, [tenantId, resource, highWaterAt.toISOString(), cursor, status]);
  }

  /**
   * Records failure state without wiping high water progress.
   */
  public async recordFailure(
    client: DbClient,
    tenantId: string,
    resource: string,
    status = "error",
  ): Promise<void> {
    const query = `
      UPDATE sync_cursor
      SET status = $3
      WHERE tenant_id = $1 AND resource = $2
    `;
    await client.query(query, [tenantId, resource, status]);
  }
}

/**
 * Reconciles remote Shopify events with local durable state, recovering missed webhooks
 * and ensuring zero duplicate financial effects.
 */
export class OrderReconciler {
  public cursorManager: SyncCursorManager;

  constructor(cursorManager?: SyncCursorManager) {
    this.cursorManager = cursorManager ?? new SyncCursorManager();
  }

  /**
   * Polls Shopify for orders updated since the overlapping window and reconciles them.
   */
  public async reconcileOrders(options: {
    client: DbClient;
    tenantId: string;
    shopifyClient: ShopifyClient;
    overlapMs?: number;
    lookbackMs?: number;
  }): Promise<ReconcileResult> {
    const { client, tenantId, shopifyClient } = options;
    const resource = "orders";

    const currentCursor = await this.cursorManager.getCursor(client, tenantId, resource);
    const { updatedAtMin } = this.cursorManager.calculatePollingWindow(currentCursor, {
      overlapMs: options.overlapMs,
      defaultLookbackMs: options.lookbackMs,
    });

    const queryStr = `updated_at:>='${updatedAtMin.toISOString()}'`;

    const graphql = `
      query PollOrders($query: String!, $cursor: String) {
        orders(first: 50, query: $query, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            name
            updatedAt
            createdAt
            displayFinancialStatus
            cancelledAt
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              id
              email
            }
          }
        }
      }
    `;

    interface OrdersQueryData {
      orders: {
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
        nodes: ShopifyOrderNode[];
      };
    }

    let polledCount = 0;
    let recoveredMissedEvents = 0;
    let alreadyKnownCount = 0;
    let maxUpdatedAt: Date | null = currentCursor?.high_water_at
      ? new Date(currentCursor.high_water_at)
      : null;
    let lastEndCursor: string | null = null;

    try {
      // Iterate pages from Shopify
      for await (const pageNodes of shopifyClient.paginate<ShopifyOrderNode>(
        graphql,
        { query: queryStr },
        (data) => {
          const res = data as OrdersQueryData;
          lastEndCursor = res.orders.pageInfo.endCursor;
          return {
            nodes: res.orders.nodes,
            pageInfo: res.orders.pageInfo,
          };
        },
        { priority: "low" }, // Polling runs with low priority
      )) {
        for (const order of pageNodes) {
          polledCount++;
          const orderUpdated = new Date(order.updatedAt);
          if (!maxUpdatedAt || orderUpdated > maxUpdatedAt) {
            maxUpdatedAt = orderUpdated;
          }

          // Ingest into webhook_inbox with deterministic ID to recover missed webhooks safely
          const deterministicWebhookId = `poll:orders/updated:${order.id}:${order.updatedAt}`;

          const insertInbox = `
            INSERT INTO webhook_inbox (
              tenant_id, webhook_id, event_id, topic, api_version, payload, status
            ) VALUES (
              $1, $2, $3, 'orders/updated', '2026-07', $4, 'pending'
            )
            ON CONFLICT (tenant_id, webhook_id) DO NOTHING
            RETURNING id
          `;

          const res = await client.query<{ id: string }>(insertInbox, [
            tenantId,
            deterministicWebhookId,
            order.id,
            JSON.stringify(order),
          ]);

          if (res.rows.length > 0) {
            // New missed event recovered!
            recoveredMissedEvents++;
          } else {
            // Already known event (either processed via webhook or earlier poll)
            alreadyKnownCount++;
          }
        }
      }

      // Persist sync cursor only after successful poll/commit
      if (maxUpdatedAt) {
        await this.cursorManager.saveCursor(
          client,
          tenantId,
          resource,
          maxUpdatedAt,
          lastEndCursor,
          "idle",
        );
      }

      return {
        resource,
        polledCount,
        recoveredMissedEvents,
        alreadyKnownCount,
        newHighWaterAt: maxUpdatedAt,
        success: true,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.cursorManager.recordFailure(client, tenantId, resource, "error");
      return {
        resource,
        polledCount,
        recoveredMissedEvents,
        alreadyKnownCount,
        newHighWaterAt: maxUpdatedAt,
        success: false,
        error: errorMsg,
      };
    }
  }
}
