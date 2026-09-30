import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthenticatedFetch } from "../../apps/shopify/genesis-trade-suite/app/authenticated-fetch.ts";

test("app fetch obtains a fresh token for Request objects and preserves POST body", async () => {
  const requests: Request[] = [];
  let count = 0;
  const send: typeof fetch = async (input, init) => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return new Response("{}");
  };
  const fetchApp = createAuthenticatedFetch(send, "https://app.example", async () => `fresh-${++count}`);
  await fetchApp(new Request("https://app.example/app/onboarding.data", { method: "POST", body: "step=2", headers: { Authorization: "Bearer expired" } }));
  await fetchApp("/app/accounts.data");
  assert.equal(requests[0]!.headers.get("Authorization"), "Bearer fresh-1");
  assert.equal(await requests[0]!.text(), "step=2");
  assert.equal(requests[1]!.headers.get("Authorization"), "Bearer fresh-2");
  await fetchApp("https://other.example/app");
  assert.equal(count, 2, "Never send Shopify tokens to another origin");
  assert.equal(requests[2]!.headers.get("Authorization"), null);
});
