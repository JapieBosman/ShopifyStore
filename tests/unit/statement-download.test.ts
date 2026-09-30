import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { forwardStatementDownload } from "../../apps/shopify/genesis-trade-suite/app/statement-download.server.ts";

test("embedded statement download forwards signed parameters and preserves PDF bytes", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.4\nSynthetic statement\n%%EOF");
  const request = new Request("https://app.example/v1/statements/download?key=statements%2Ftenant%2Ffile.pdf&expires=123&signature=abc&tenant=tenant&url=https://other.example");
  const response = await forwardStatementDownload(request, {
    apiUrl: "http://127.0.0.1:3001",
    fetchRequest: async (input, init) => {
      const target = new URL(String(input));
      assert.equal(target.origin, "http://127.0.0.1:3001");
      assert.equal(target.pathname, "/v1/statements/download");
      assert.equal(target.searchParams.get("key"), "statements/tenant/file.pdf");
      assert.equal(target.searchParams.get("signature"), "abc");
      assert.equal(target.searchParams.has("url"), false);
      assert.equal(init?.redirect, "manual");
      return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="statement.pdf"' } });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(createHash("sha256").update(new Uint8Array(await response.arrayBuffer())).digest("hex"), createHash("sha256").update(pdf).digest("hex"));
});

test("embedded download preserves API rejections and cloud redirects", async () => {
  for (const status of [400, 403, 404]) {
    const response = await forwardStatementDownload(new Request("https://app.example/v1/statements/download"), {
      apiUrl: "http://api.example", fetchRequest: async () => new Response("Rejected", { status }),
    });
    assert.equal(response.status, status);
    assert.equal(await response.text(), "Rejected");
  }
  const redirect = await forwardStatementDownload(new Request("https://app.example/v1/statements/download"), {
    apiUrl: "http://api.example", fetchRequest: async () => new Response(null, { status: 302, headers: { Location: "https://storage.example/signed.pdf" } }),
  });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("Location"), "https://storage.example/signed.pdf");
});

test("embedded download handles an unavailable API", async () => {
  const response = await forwardStatementDownload(new Request("https://app.example/v1/statements/download"), {
    apiUrl: "http://api.example", fetchRequest: async () => { throw new Error("offline"); },
  });
  assert.equal(response.status, 502);
});
