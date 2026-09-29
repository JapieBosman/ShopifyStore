import assert from "node:assert/strict";
import test from "node:test";
import {
  SyncCursorManager,
  OrderReconciler,
  type SyncCursorRecord,
  type ShopifyOrderNode,
} from "../src/reconcile.ts";
import type { DbClient } from "../../../packages/database/tenant-context.ts";
import { ShopifyClient } from "../../api/src/shopify/client.ts";

test("SyncCursorManager calculates correct polling window with overlap", () => {
  const manager = new SyncCursorManager();

  // 1. Initial run without existing cursor -> uses default lookback (e.g. 30 days)
  const now = Date.now();
  const windowInitial = manager.calculatePollingWindow(null);
  assert.equal(windowInitial.startCursor, null);
  const lookbackDays = (now - windowInitial.updatedAtMin.getTime()) / (1000 * 60 * 60 * 24);
  assert.ok(lookbackDays >= 29 && lookbackDays <= 31);

  // 2. Incremental run with existing high_water_at -> steps back by overlapMs (2 hours default)
  const highWater = new Date("2026-09-28T10:00:00.000Z");
  const existingCursor: SyncCursorRecord = {
    id: "cursor-uuid-1",
    tenant_id: "tenant-uuid-1",
    resource: "orders",
    high_water_at: highWater,
    cursor: "end_cursor_abc",
    last_success_at: highWater,
    status: "idle",
    created_at: highWater,
  };

  const windowIncremental = manager.calculatePollingWindow(existingCursor);
  assert.equal(windowIncremental.startCursor, "end_cursor_abc");
  const overlapDiffHours = (highWater.getTime() - windowIncremental.updatedAtMin.getTime()) / (1000 * 60 * 60);
  assert.equal(overlapDiffHours, 2); // 2 hours overlap
});

test("OrderReconciler reconciles orders and recovers missed events with mock client", async () => {
  const executedQueries: Array<{ sql: string; params: unknown[] }> = [];

  const mockDb: DbClient = {
    async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<{ rows: R[] }> {
      executedQueries.push({ sql, params });

      if (sql.includes("SELECT id, tenant_id, resource")) {
        // No existing cursor
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO webhook_inbox")) {
        // Return 1 row to simulate successful insert of missed event
        return { rows: [{ id: "mock-inbox-id-1" }] as unknown as R[] };
      }

      return { rows: [] };
    },
    async exec(): Promise<void> {},
  };

  const sampleOrder: ShopifyOrderNode = {
    id: "gid://shopify/Order/99001",
    name: "#1001",
    updatedAt: "2026-09-28T11:30:00.000Z",
    createdAt: "2026-09-28T11:00:00.000Z",
    displayFinancialStatus: "AUTHORIZED",
    totalPriceSet: {
      shopMoney: {
        amount: "550.00",
        currencyCode: "ZAR",
      },
    },
    customer: {
      id: "gid://shopify/Customer/888",
    },
  };

  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        data: {
          orders: {
            pageInfo: { hasNextPage: false, endCursor: "cursor_final" },
            nodes: [sampleOrder],
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const shopifyClient = new ShopifyClient({
    shopDomain: "displaydeck.myshopify.com",
    accessToken: "shpat_mock_token",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const reconciler = new OrderReconciler();
  const result = await reconciler.reconcileOrders({
    client: mockDb,
    tenantId: "11111111-1111-4111-8111-111111111111",
    shopifyClient,
  });

  assert.equal(result.success, true);
  assert.equal(result.polledCount, 1);
  assert.equal(result.recoveredMissedEvents, 1);
  assert.equal(result.alreadyKnownCount, 0);
  assert.equal(result.newHighWaterAt?.toISOString(), "2026-09-28T11:30:00.000Z");

  // Verify sync_cursor was updated
  const saveCursorQuery = executedQueries.find((q) => q.sql.includes("INSERT INTO sync_cursor"));
  assert.ok(saveCursorQuery, "Expected INSERT INTO sync_cursor query");
  assert.equal(saveCursorQuery.params[0], "11111111-1111-4111-8111-111111111111");
  assert.equal(saveCursorQuery.params[1], "orders");
  assert.equal(saveCursorQuery.params[2], "2026-09-28T11:30:00.000Z");
  assert.equal(saveCursorQuery.params[3], "cursor_final");
});

test("OrderReconciler records failure in sync_cursor if remote API fails", async () => {
  const executedQueries: Array<{ sql: string; params: unknown[] }> = [];

  const mockDb: DbClient = {
    async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<{ rows: R[] }> {
      executedQueries.push({ sql, params });
      return { rows: [] };
    },
    async exec(): Promise<void> {},
  };

  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        errors: [{ message: "Unauthorized access" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const shopifyClient = new ShopifyClient({
    shopDomain: "displaydeck.myshopify.com",
    accessToken: "bad_token",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const reconciler = new OrderReconciler();
  const result = await reconciler.reconcileOrders({
    client: mockDb,
    tenantId: "11111111-1111-4111-8111-111111111111",
    shopifyClient,
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /Unauthorized access/);

  // Verify failure recorded
  const failureQuery = executedQueries.find((q) => q.sql.includes("UPDATE sync_cursor"));
  assert.ok(failureQuery, "Expected UPDATE sync_cursor error query");
  assert.equal(failureQuery.params[2], "error");
});
