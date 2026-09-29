import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../src/server.ts";

test("liveness responds but readiness stays closed until integrations exist", async () => {
  const server = buildServer();
  try {
    const live = await server.inject({ method: "GET", url: "/health/live" });
    assert.equal(live.statusCode, 200);
    assert.deepStrictEqual(live.json(), { status: "ok" });

    const ready = await server.inject({ method: "GET", url: "/health/ready" });
    assert.equal(ready.statusCode, 503);
  } finally {
    await server.close();
  }
});
