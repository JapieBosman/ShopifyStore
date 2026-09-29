import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { buildServer } from "../src/server.ts";
import { verifyShopifyWebhook } from "../src/shopify-webhook.ts";

const secret = "test-secret";
const body = Buffer.from('{"id":123,"topic":"orders/create"}');
const signature = createHmac("sha256", secret).update(body).digest("base64");

test("verifies the exact raw webhook bytes", () => {
  assert.equal(verifyShopifyWebhook(body, signature, secret), true);
  assert.equal(verifyShopifyWebhook(Buffer.from('{"id":123}'), signature, secret), false);
  assert.equal(verifyShopifyWebhook(body, "invalid", secret), false);
  assert.equal(verifyShopifyWebhook(body, [signature], secret), false);
});

test("rejects unverified webhooks and does not acknowledge undurable work", async () => {
  const previous = process.env.SHOPIFY_API_SECRET;
  process.env.SHOPIFY_API_SECRET = secret;
  const server = buildServer();
  try {
    const invalid = await server.inject({ method: "POST", url: "/webhooks/shopify", payload: body, headers: { "content-type": "application/json", "x-shopify-hmac-sha256": "invalid" } });
    assert.equal(invalid.statusCode, 401);
    const valid = await server.inject({ method: "POST", url: "/webhooks/shopify", payload: body, headers: { "content-type": "application/json", "x-shopify-hmac-sha256": signature } });
    assert.equal(valid.statusCode, 503);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.SHOPIFY_API_SECRET;
    else process.env.SHOPIFY_API_SECRET = previous;
  }
});
