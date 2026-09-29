import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { ingestWebhookToInbox, verifyWebhookHmac } from "../../../apps/api/src/shopify/webhooks.ts";
import { enqueueOutboxItem, claimOutboxBatch, markOutboxItemCompleted, recordOutboxItemFailed } from "../outbox.ts";
import { InboxProcessor } from "../../../apps/worker/src/inbox.ts";

const migrationFile = fileURLToPath(
  new URL("../migrations/0001_core.sql", import.meta.url),
);

const API_SECRET = "shpss_webhook_secret_key_abcdef";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function signPayload(body: Buffer, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}

test("ingestWebhookToInbox persists verified webhooks and deduplicates identical deliveries", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(readFileSync(migrationFile, "utf8"));
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Shop', 'ZAR', 'UTC', 'active')",
      [TENANT_ID],
    );

    const payload = Buffer.from(JSON.stringify({ id: 12345, total_price: "500.00" }), "utf8");
    const hmac = signPayload(payload, API_SECRET);
    const webhookId = "delivery-uuid-0001";

    // 1. Initial ingestion
    const firstResult = await ingestWebhookToInbox(
      db,
      TENANT_ID,
      payload,
      {
        hmacHeader: hmac,
        topic: "orders/create",
        webhookId,
        eventId: "event-1",
        apiVersion: "2026-07",
      },
      API_SECRET,
    );

    assert.equal(firstResult.status, "stored");
    assert.ok(firstResult.inboxId);

    // Verify row in DB
    const rows = await db.query<{ id: string; status: string; topic: string }>(
      "SELECT id, status, topic FROM webhook_inbox WHERE tenant_id = $1 AND webhook_id = $2",
      [TENANT_ID, webhookId],
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]?.status, "pending");
    assert.equal(rows.rows[0]?.topic, "orders/create");

    // 2. Duplicate redelivery
    const duplicateResult = await ingestWebhookToInbox(
      db,
      TENANT_ID,
      payload,
      {
        hmacHeader: hmac,
        topic: "orders/create",
        webhookId, // Identical delivery ID
        eventId: "event-1",
        apiVersion: "2026-07",
      },
      API_SECRET,
    );

    assert.equal(duplicateResult.status, "duplicate");

    // Verify DB still contains exactly one row
    const count = await db.query<{ count: string }>(
      "SELECT count(*) FROM webhook_inbox WHERE tenant_id = $1",
      [TENANT_ID],
    );
    assert.equal(Number(count.rows[0]?.count), 1);
  } finally {
    await db.close();
  }
});

test("ingestWebhookToInbox rejects bad HMAC and unsupported topics", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(readFileSync(migrationFile, "utf8"));
    const payload = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8");

    // Bad HMAC
    const badHmac = await ingestWebhookToInbox(
      db,
      TENANT_ID,
      payload,
      { hmacHeader: "invalid_base64_hmac", topic: "orders/create", webhookId: "d1" },
      API_SECRET,
    );
    assert.equal(badHmac.status, "invalid_signature");

    // Unsupported topic
    const goodHmac = signPayload(payload, API_SECRET);
    const badTopic = await ingestWebhookToInbox(
      db,
      TENANT_ID,
      payload,
      { hmacHeader: goodHmac, topic: "unsupported/random_topic", webhookId: "d2" },
      API_SECRET,
    );
    assert.equal(badTopic.status, "unsupported_topic");
  } finally {
    await db.close();
  }
});

test("inbox processing claims items, executes domain handler, and records completion", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(readFileSync(migrationFile, "utf8"));
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Shop', 'ZAR', 'UTC', 'active')",
      [TENANT_ID],
    );

    const payload = Buffer.from(JSON.stringify({ order_number: "SO-101", amount: "250.00" }), "utf8");
    const hmac = signPayload(payload, API_SECRET);

    await ingestWebhookToInbox(
      db,
      TENANT_ID,
      payload,
      { hmacHeader: hmac, topic: "orders/create", webhookId: "del-101" },
      API_SECRET,
    );

    const processor = new InboxProcessor();
    let handledOrder: string | null = null;

    processor.registerHandler("orders/create", async (item) => {
      handledOrder = item.payload["order_number"] as string;
    });

    const summary = await processor.processBatch(db, TENANT_ID);
    assert.equal(summary.processed, 1);
    assert.equal(summary.failed, 0);
    assert.equal(handledOrder, "SO-101");

    // Verify inbox status updated to complete
    const res = await db.query<{ status: string; processed_at: string }>(
      "SELECT status, processed_at FROM webhook_inbox WHERE tenant_id = $1 AND webhook_id = 'del-101'",
      [TENANT_ID],
    );
    assert.equal(res.rows[0]?.status, "complete");
    assert.ok(res.rows[0]?.processed_at);
  } finally {
    await db.close();
  }
});

test("outbox queue handles enqueue, leased claim, concurrency lock, and completion", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(readFileSync(migrationFile, "utf8"));
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Shop', 'ZAR', 'UTC', 'active')",
      [TENANT_ID],
    );

    const aggregateId = "22222222-2222-4222-8222-222222222222";
    const idempotencyKey = "sync-shopify-order-1";

    // 1. Enqueue outbox row
    const id = await enqueueOutboxItem(db, TENANT_ID, {
      kind: "sync_order",
      aggregateId,
      idempotencyKey,
      payload: { externalId: 999 },
    });
    assert.ok(id);

    // 2. Claim batch with 30-second lease
    const batch = await claimOutboxBatch(db, TENANT_ID, 5, 30);
    assert.equal(batch.length, 1);
    assert.equal(batch[0]?.id, id);
    assert.equal(batch[0]?.attemptCount, 1);
    assert.ok(batch[0]?.leasedUntil);

    // 3. Second claim while lease is active should find 0 items (SKIP LOCKED / lease active)
    const secondClaim = await claimOutboxBatch(db, TENANT_ID, 5, 30);
    assert.equal(secondClaim.length, 0);

    // 4. Mark completed
    await markOutboxItemCompleted(db, TENANT_ID, id);

    // 5. Subsequent claims find 0 items
    const completedClaim = await claimOutboxBatch(db, TENANT_ID, 5, 30);
    assert.equal(completedClaim.length, 0);
  } finally {
    await db.close();
  }
});

test("durable webhook ack latency p95 is under 1 second in load fixture", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(readFileSync(migrationFile, "utf8"));
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Shop', 'ZAR', 'UTC', 'active')",
      [TENANT_ID],
    );

    const iterations = 50;
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const payload = Buffer.from(JSON.stringify({ index: i, timestamp: Date.now() }), "utf8");
      const hmac = signPayload(payload, API_SECRET);
      const webhookId = `bench-del-${i}`;

      const start = performance.now();
      const res = await ingestWebhookToInbox(
        db,
        TENANT_ID,
        payload,
        { hmacHeader: hmac, topic: "orders/updated", webhookId },
        API_SECRET,
      );
      const elapsed = performance.now() - start;
      durations.push(elapsed);
      assert.equal(res.status, "stored");
    }

    durations.sort((a, b) => a - b);
    const p95Index = Math.floor(durations.length * 0.95);
    const p95LatencyMs = durations[p95Index]!;

    // Assert p95 latency is well under 1,000ms (typically < 30ms)
    assert.ok(p95LatencyMs < 1000, `p95 latency was ${p95LatencyMs}ms, expected < 1000ms`);
  } finally {
    await db.close();
  }
});
