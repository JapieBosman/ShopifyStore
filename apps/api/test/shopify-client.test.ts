import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ShopifyClient,
  ShopifyCostScheduler,
  ShopifyGraphQLError,
  ShopifyUserErrorCollection,
  ShopifyThrottleError,
  ShopifyHttpError,
} from "../src/shopify/client.ts";

describe("ShopifyCostScheduler", () => {
  it("initializes with default maximum available points and refills over time", async () => {
    const scheduler = new ShopifyCostScheduler();
    const shop = "test-store.myshopify.com";

    const state = scheduler.getShopState(shop);
    assert.equal(state.maximumAvailable, 1000);
    assert.equal(state.currentlyAvailable, 1000);
    assert.equal(state.restoreRate, 100);

    // Consume 300 points
    await scheduler.schedule(shop, 300);
    const afterConsume = scheduler.getShopState(shop);
    assert.ok(afterConsume.currentlyAvailable <= 705);

    // Update from Shopify response
    scheduler.updateFromResponse(shop, {
      requestedQueryCost: 50,
      actualQueryCost: 40,
      throttleStatus: {
        maximumAvailable: 2000,
        currentlyAvailable: 1500,
        restoreRate: 200,
      },
    });

    const updated = scheduler.getShopState(shop);
    assert.equal(updated.maximumAvailable, 2000);
    assert.equal(updated.currentlyAvailable, 1500);
    assert.equal(updated.restoreRate, 200);
  });

  it("schedules requests and waits when budget is depleted", async () => {
    const scheduler = new ShopifyCostScheduler();
    const shop = "drain-store.myshopify.com";

    // Set state manually to near zero
    scheduler.updateFromResponse(shop, {
      requestedQueryCost: 100,
      actualQueryCost: 100,
      throttleStatus: {
        maximumAvailable: 1000,
        currentlyAvailable: 10,
        restoreRate: 500, // fast refill for test
      },
    });

    const start = Date.now();
    // Scheduling 50 points requires 40 more points -> at 500 pts/sec, ~80ms wait
    await scheduler.schedule(shop, 50);
    const elapsed = Date.now() - start;

    assert.ok(elapsed >= 70, `Expected delay for replenish, got ${elapsed}ms`);
  });
});

describe("ShopifyClient", () => {
  it("executes GraphQL query and sends authentication headers", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = String(init?.body);

      return new Response(
        JSON.stringify({
          data: { shop: { name: "DisplayDeck" } },
          extensions: {
            cost: {
              requestedQueryCost: 1,
              actualQueryCost: 1,
              throttleStatus: {
                maximumAvailable: 1000,
                currentlyAvailable: 999,
                restoreRate: 100,
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new ShopifyClient({
      shopDomain: "displaydeck.myshopify.com",
      accessToken: "shpat_test_token_123",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const data = await client.query<{ shop: { name: string } }>("{ shop { name } }");
    assert.equal(data.shop.name, "DisplayDeck");
    assert.equal(capturedUrl, "https://displaydeck.myshopify.com/admin/api/2026-07/graphql.json");
    assert.equal(capturedHeaders["X-Shopify-Access-Token"], "shpat_test_token_123");
    assert.equal(capturedHeaders["Content-Type"], "application/json");
    assert.ok(capturedBody.includes("{ shop { name } }"));
  });

  it("handles HTTP 429 and retries using Retry-After header", async () => {
    let callCount = 0;

    const mockFetch = async (): Promise<Response> => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ errors: "Throttled" }), {
          status: 429,
          headers: { "Retry-After": "0.05" }, // 50ms wait
        });
      }
      return new Response(
        JSON.stringify({
          data: { shop: { name: "RecoveredStore" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new ShopifyClient({
      shopDomain: "displaydeck.myshopify.com",
      accessToken: "shpat_test_token",
      fetchFn: mockFetch as unknown as typeof fetch,
      maxRetries: 2,
    });

    const data = await client.query<{ shop: { name: string } }>("{ shop { name } }");
    assert.equal(callCount, 2);
    assert.equal(data.shop.name, "RecoveredStore");
  });

  it("handles HTTP 200 with GraphQL THROTTLED error and retries", async () => {
    let callCount = 0;

    const mockFetch = async (): Promise<Response> => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            errors: [
              {
                message: "Throttled",
                extensions: { code: "THROTTLED" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          data: { order: { id: "gid://shopify/Order/1" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new ShopifyClient({
      shopDomain: "displaydeck.myshopify.com",
      accessToken: "shpat_test_token",
      fetchFn: mockFetch as unknown as typeof fetch,
      maxRetries: 2,
    });

    const data = await client.query<{ order: { id: string } }>("{ order(id: 1) { id } }");
    assert.equal(callCount, 2);
    assert.equal(data.order.id, "gid://shopify/Order/1");
  });

  it("throws ShopifyGraphQLError for non-retryable GraphQL errors", async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          errors: [
            {
              message: "Field 'invalidField' doesn't exist on type 'QueryRoot'",
              locations: [{ line: 1, column: 3 }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new ShopifyClient({
      shopDomain: "displaydeck.myshopify.com",
      accessToken: "shpat_test_token",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await assert.rejects(
      async () => {
        await client.query("{ invalidField }");
      },
      (err: unknown) => {
        assert.ok(err instanceof ShopifyGraphQLError);
        assert.ok(err.message.includes("Field 'invalidField' doesn't exist"));
        assert.equal(err.status, 200);
        return true;
      },
    );
  });

  it("extracts and throws ShopifyUserErrorCollection for mutation validation errors", async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          data: {
            draftOrderCreate: {
              draftOrder: null,
              userErrors: [
                {
                  field: ["lineItems", "0", "quantity"],
                  message: "Quantity must be greater than 0",
                },
                {
                  field: ["customerId"],
                  message: "Customer does not exist",
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new ShopifyClient({
      shopDomain: "displaydeck.myshopify.com",
      accessToken: "shpat_test_token",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await assert.rejects(
      async () => {
        await client.mutate("mutation { draftOrderCreate { draftOrder { id } } }");
      },
      (err: unknown) => {
        assert.ok(err instanceof ShopifyUserErrorCollection);
        assert.equal(err.userErrors.length, 2);
        assert.equal(err.userErrors[0]?.message, "Quantity must be greater than 0");
        assert.deepEqual(err.userErrors[0]?.field, ["lineItems", "0", "quantity"]);
        return true;
      },
    );
  });

  it("supports cursor-based pagination across multiple pages", async () => {
    let pageRequest = 0;

    const mockFetch = async (_url: unknown, init?: RequestInit): Promise<Response> => {
      pageRequest++;
      const body = JSON.parse(String(init?.body));
      const cursor = body.variables?.cursor;

      if (!cursor) {
        // Page 1
        return new Response(
          JSON.stringify({
            data: {
              orders: {
                pageInfo: { hasNextPage: true, endCursor: "cursor_page_1" },
                nodes: [{ id: "order_1" }, { id: "order_2" }],
              },
            },
          }),
          { status: 200 },
        );
      } else if (cursor === "cursor_page_1") {
        // Page 2
        return new Response(
          JSON.stringify({
            data: {
              orders: {
                pageInfo: { hasNextPage: false, endCursor: "cursor_page_2" },
                nodes: [{ id: "order_3" }],
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ data: { orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }));
    };

    const client = new ShopifyClient({
      shopDomain: "displaydeck.myshopify.com",
      accessToken: "shpat_test_token",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const allOrders = await client.fetchAllPages<{ id: string }>(
      "query { orders { nodes { id } } }",
      {},
      (data) => {
        const d = data as { orders: { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
        return { nodes: d.orders.nodes, pageInfo: d.orders.pageInfo };
      },
    );

    assert.equal(pageRequest, 2);
    assert.deepEqual(allOrders.map((o) => o.id), ["order_1", "order_2", "order_3"]);
  });

  it("initiates bulk query operations cleanly", async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          data: {
            bulkOperationRunQuery: {
              bulkOperation: {
                id: "gid://shopify/BulkOperation/1001",
                status: "CREATED",
              },
              userErrors: [],
            },
          },
        }),
        { status: 200 },
      );
    };

    const client = new ShopifyClient({
      shopDomain: "displaydeck.myshopify.com",
      accessToken: "shpat_test_token",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const op = await client.startBulkQuery("{ orders { edges { node { id } } } }");
    assert.equal(op.id, "gid://shopify/BulkOperation/1001");
    assert.equal(op.status, "CREATED");
  });
});
