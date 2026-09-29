import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { SyncCursorManager, OrderReconciler, type ShopifyOrderNode } from "../../../apps/worker/src/reconcile.ts";
import { ShopifyClient } from "../../../apps/api/src/shopify/client.ts";
import { withTenantContext } from "../tenant-context.ts";

const migrationFile = fileURLToPath(
  new URL("../migrations/0001_core.sql", import.meta.url),
);

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const SHOP_DOMAIN = "displaydeck.myshopify.com";

test("integration: sync_cursor management and overlapping polling recovery with zero duplicate financial effect", async () => {
  const db = await PGlite.create();
  try {
    // 1. Run migrations
    await db.exec(readFileSync(migrationFile, "utf8"));

    // 2. Seed tenant, ledger account, and debtor account
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'DisplayDeck', 'ZAR', 'UTC', 'active')",
      [TENANT_ID],
    );

    const cursorManager = new SyncCursorManager();
    const reconciler = new OrderReconciler(cursorManager);

    // Initial check: no cursor exists
    const initialCursor = await withTenantContext(db, TENANT_ID, async (tx) => {
      return cursorManager.getCursor(tx, TENANT_ID, "orders");
    });
    assert.equal(initialCursor, null);

    // 3. Scenario A: Missed webhook recovery
    // Simulate Shopify returning an order that was missed by webhooks
    const sampleOrder: ShopifyOrderNode = {
      id: "gid://shopify/Order/7777001",
      name: "#1001",
      updatedAt: "2026-09-28T12:00:00.000Z",
      createdAt: "2026-09-28T11:00:00.000Z",
      displayFinancialStatus: "AUTHORIZED",
      totalPriceSet: {
        shopMoney: {
          amount: "1250.00",
          currencyCode: "ZAR",
        },
      },
      customer: {
        id: "gid://shopify/Customer/333",
        email: "contractor@example.com",
      },
    };

    let shopifyOrdersList = [sampleOrder];

    const mockFetch = async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          data: {
            orders: {
              pageInfo: { hasNextPage: false, endCursor: "cursor_page_1" },
              nodes: shopifyOrdersList,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const shopifyClient = new ShopifyClient({
      shopDomain: SHOP_DOMAIN,
      accessToken: "shpat_mock_key",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    // Run reconciliation under tenant context
    const reconcile1 = await withTenantContext(db, TENANT_ID, async (tx) => {
      return reconciler.reconcileOrders({
        client: tx,
        tenantId: TENANT_ID,
        shopifyClient,
      });
    });

    assert.equal(reconcile1.success, true);
    assert.equal(reconcile1.polledCount, 1);
    assert.equal(reconcile1.recoveredMissedEvents, 1, "Expected 1 missed event recovered");
    assert.equal(reconcile1.alreadyKnownCount, 0);
    assert.equal(reconcile1.newHighWaterAt?.toISOString(), "2026-09-28T12:00:00.000Z");

    // Verify sync_cursor has been persisted
    const savedCursor = await withTenantContext(db, TENANT_ID, async (tx) => {
      return cursorManager.getCursor(tx, TENANT_ID, "orders");
    });
    assert.ok(savedCursor);
    assert.equal(savedCursor.status, "idle");
    assert.equal(savedCursor.cursor, "cursor_page_1");
    assert.equal(new Date(savedCursor.high_water_at!).toISOString(), "2026-09-28T12:00:00.000Z");

    // Verify webhook_inbox now has exactly 1 pending item
    const inboxRows = await withTenantContext(db, TENANT_ID, async (tx) => {
      return tx.query<{ id: string; webhook_id: string; status: string; topic: string }>(
        "SELECT id, webhook_id, status, topic FROM webhook_inbox WHERE tenant_id = $1",
        [TENANT_ID],
      );
    });
    assert.equal(inboxRows.rows.length, 1);
    assert.equal(inboxRows.rows[0]?.topic, "orders/updated");
    assert.equal(inboxRows.rows[0]?.status, "pending");

    // 4. Scenario B: Overlapping polling run with NO duplicate financial effect
    // Simulate polling again: the 2-hour overlap window includes the order again.
    const reconcile2 = await withTenantContext(db, TENANT_ID, async (tx) => {
      return reconciler.reconcileOrders({
        client: tx,
        tenantId: TENANT_ID,
        shopifyClient,
        overlapMs: 2 * 60 * 60 * 1000,
      });
    });

    assert.equal(reconcile2.success, true);
    assert.equal(reconcile2.polledCount, 1);
    assert.equal(reconcile2.recoveredMissedEvents, 0, "No duplicate event should be recovered");
    assert.equal(reconcile2.alreadyKnownCount, 1, "The order is already known");

    // Verify webhook_inbox STILL has exactly 1 item (no duplication)
    const inboxCount = await withTenantContext(db, TENANT_ID, async (tx) => {
      return tx.query<{ count: string | number }>(
        "SELECT count(*) as count FROM webhook_inbox WHERE tenant_id = $1",
        [TENANT_ID],
      );
    });
    assert.equal(Number(inboxCount.rows[0]?.count), 1, "Duplicate polling produced zero extra inbox items");

    // 5. Scenario C: Enforce business idempotency on journal and document tables
    // Ensure UNIQUE(tenant_id, source_event_key) and UNIQUE(tenant_id, source_kind, source_key) prevent duplicate posting
    await withTenantContext(db, TENANT_ID, async (tx) => {
      // Create actor
      const actorRes = await tx.query<{ id: string }>(
        `INSERT INTO actor (tenant_id, external_subject, display_name, role)
         VALUES ($1, 'worker@displaydeck.internal', 'Background Worker', 'worker') RETURNING id`,
        [TENANT_ID],
      );

      // Create payment term, ledger account & debtor account
      const termRes = await tx.query<{ id: string }>(
        "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
        [TENANT_ID],
      );
      const ledgerRes = await tx.query<{ id: string }>(
        "INSERT INTO ledger_account (tenant_id, code, name, kind) VALUES ($1, '1200', 'Trade Debtors', 'receivable') RETURNING id",
        [TENANT_ID],
      );
      const debtorRes = await tx.query<{ id: string }>(
        `INSERT INTO debtor_account (
          tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
        ) VALUES (
          $1, 'DEBT-001', 'Acme Ltd', 'ZAR', $2, 50000.00, 'active', 'due_date'
        ) RETURNING id`,
        [TENANT_ID, termRes.rows[0]?.id],
      );
      const journalRes = await tx.query<{ id: string }>(
        `INSERT INTO journal (
          tenant_id, currency, effective_date, posted_at, actor_id, source_kind, source_key, idempotency_key, memo
        ) VALUES (
          $1, 'ZAR', '2026-09-28', now(), $2, 'order', $3, $4, 'Order 1001'
        ) RETURNING id`,
        [TENANT_ID, actorRes.rows[0]?.id, sampleOrder.id, `idem:${sampleOrder.id}`],
      );

      // Insert first document
      await tx.query(
        `INSERT INTO document (
          tenant_id, debtor_account_id, journal_id, document_number, kind, direction,
          amount, currency, issued_on, due_on, shopify_order_gid, source_event_key
        ) VALUES (
          $1, $2, $3, 'INV-1001', 'invoice', 'debit',
          1250.00, 'ZAR', '2026-09-28', '2026-10-28', $4, $5
        )`,
        [TENANT_ID, debtorRes.rows[0]?.id, journalRes.rows[0]?.id, sampleOrder.id, `order:${sampleOrder.id}`],
      );

      // Attempt to insert duplicate document with same source_event_key -> must fail unique constraint
      await assert.rejects(
        async () => {
          await tx.query(
            `INSERT INTO document (
              tenant_id, debtor_account_id, journal_id, document_number, kind, direction,
              amount, currency, issued_on, due_on, shopify_order_gid, source_event_key
            ) VALUES (
              $1, $2, $3, 'INV-1001-DUP', 'invoice', 'debit',
              1250.00, 'ZAR', '2026-09-28', '2026-10-28', $4, $5
            )`,
            [TENANT_ID, debtorRes.rows[0]?.id, journalRes.rows[0]?.id, sampleOrder.id, `order:${sampleOrder.id}`],
          );
        },
        /unique/i,
        "Duplicate source_event_key must violate unique constraint",
      );
    });
  } finally {
    await db.close();
  }
});
