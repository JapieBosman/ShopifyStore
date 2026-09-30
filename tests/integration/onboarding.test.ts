import { test } from "node:test";
import assert from "node:assert/strict";
import { initApiDatabase, DEFAULT_TENANT_ID } from "../../apps/api/src/db.ts";
import { buildServer } from "../../apps/api/src/server.ts";
import { createMockSessionToken } from "../../apps/api/src/auth/shopify.ts";

test("onboarding persists partial updates and restricts currency, values and roles", async () => {
  const db = await initApiDatabase({ seedDemo: true });
  const server = buildServer({ db, apiSecretKey: "test-secret", clientId: "test-client" });
  const headers = (sub: string) => ({ authorization: `Bearer ${createMockSessionToken({ sub, aud: "test-client" }, "test-secret")}` });
  const owner = headers("gid://shopify/User/1");
  try {
    const save = (payload: Record<string, unknown>, auth = owner) => server.inject({ method: "PATCH", url: "/v1/onboarding", headers: auth, payload });
    assert.equal((await save({ operatingCurrency: "ZAR", agingBasis: "calendar_period", step: 3 })).statusCode, 200);
    assert.equal((await save({ defaultCreditLimit: "20000.00", defaultTermsType: "eom", defaultTermsDays: 15, step: 4 })).statusCode, 200);
    const saved = (await server.inject({ method: "GET", url: "/v1/onboarding", headers: owner })).json();
    assert.equal(saved.operatingCurrency, "ZAR");
    assert.equal(saved.agingBasis, "calendar_period");
    assert.equal(saved.defaultTermsDays, 15);
    assert.equal((await save({ operatingCurrency: "USD" })).statusCode, 400);
    assert.equal((await save({ defaultTermsDays: 1.5 })).statusCode, 400);
    assert.equal((await save({ defaultCreditLimit: "-1.00" })).statusCode, 400);
    assert.equal((await save({ defaultTermsType: "made-up" })).statusCode, 400);
    assert.equal((await save({ unknown: true })).statusCode, 400);
    assert.equal((await save({ step: 4 }, headers("gid://shopify/User/20"))).statusCode, 403);
    assert.equal((await server.inject({ method: "GET", url: "/v1/onboarding" })).statusCode, 401);
    const stored = await db.query<{ preferences: { agingBasis: string } }>("SELECT preferences FROM tenant_onboarding WHERE tenant_id = $1", [DEFAULT_TENANT_ID]);
    assert.equal(stored.rows[0]!.preferences.agingBasis, "calendar_period");
  } finally {
    await server.close();
    await db.close?.();
  }
});
