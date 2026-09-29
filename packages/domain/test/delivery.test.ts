import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRecipientEmail,
  generateRecipientSecretRef,
  encryptRecipientSecretRef,
  decryptRecipientSecretRef,
  MockStatementEmailProvider,
  WebhookStatementEmailProvider,
  getStatementEmailProvider,
  setStatementEmailProvider,
  type EmailDispatchPayload,
} from "../src/delivery.ts";

test("delivery: validateRecipientEmail enforces RFC formatting and rejects malicious inputs", () => {
  // Valid email addresses
  assert.equal(validateRecipientEmail("accounting@ubuntu-hardware.co.za").valid, true);
  assert.equal(validateRecipientEmail("b2b.finance+statements@domain.org").valid, true);
  assert.equal(validateRecipientEmail("   trim.me@domain.com   ").valid, true);
  assert.equal(
    validateRecipientEmail("   trim.me@domain.com   ").normalizedEmail,
    "trim.me@domain.com",
  );

  // Invalid email inputs
  assert.equal(validateRecipientEmail("").valid, false);
  assert.equal(validateRecipientEmail("   ").valid, false);
  assert.equal(validateRecipientEmail(null).valid, false);
  assert.equal(validateRecipientEmail(undefined).valid, false);
  assert.equal(validateRecipientEmail(12345).valid, false);
  assert.equal(validateRecipientEmail("not-an-email").valid, false);
  assert.equal(validateRecipientEmail("missing@domain").valid, false);
  assert.equal(validateRecipientEmail("@nodomain.com").valid, false);

  // CRLF injection attacks
  assert.equal(validateRecipientEmail("victim@domain.com\r\nBcc: attacker@evil.com").valid, false);
  assert.equal(validateRecipientEmail("victim@domain.com\nSubject: Injected").valid, false);
});

test("delivery: provider lookup distinguishes an explicit absence from an unavailable lookup", async () => {
  const provider = new WebhookStatementEmailProvider("https://mail.example.test/deliveries");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 503 });
    assert.equal(await provider.queryDeliveryStatus({ idempotencyKey: "lookup-1" }), null);

    globalThis.fetch = async () => Response.json({ status: "not_found" });
    assert.deepEqual(await provider.queryDeliveryStatus({ idempotencyKey: "lookup-1" }), {
      status: "not_found",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("delivery: generateRecipientSecretRef masks email and appends deterministic hash", () => {
  const ref1 = generateRecipientSecretRef("finance@megacorp.com");
  const ref2 = generateRecipientSecretRef("finance@megacorp.com");
  const ref3 = generateRecipientSecretRef("sales@megacorp.com");

  assert.equal(ref1, ref2, "Same email must produce identical secret reference");
  assert.notEqual(ref1, ref3, "Different emails must produce distinct references");

  // Format checks
  assert.ok(ref1.startsWith("f***e@megacorp.com#"));
  assert.ok(ref1.includes("#"));
  assert.ok(!ref1.includes("finance@megacorp.com"), "Plain email must be masked");

  // Short local part
  const shortRef = generateRecipientSecretRef("ab@domain.com");
  assert.ok(shortRef.startsWith("a*@domain.com#"));
});

test("delivery: MockStatementEmailProvider supports accepted, bounced, failed, and uncertain lifecycle", async () => {
  const provider = new MockStatementEmailProvider();

  const payload: EmailDispatchPayload = {
    tenantId: "tenant-001",
    deliveryId: "del-001",
    statementId: "stmt-001",
    recipientEmail: "finance@partner.co.za",
    recipientName: "Partner Finance",
    accountNumber: "ACC-001",
    statementNumber: "STMT-2026-08-001",
    periodEnd: "2026-08-31",
    closingBalance: "15420.50",
    currency: "ZAR",
    downloadUrl: "https://api.example.com/v1/statements/download?key=stmt.pdf&sig=abc",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };

  // Normal accepted
  const res1 = await provider.sendStatementEmail(payload);
  assert.equal(res1.status, "accepted");
  assert.ok(res1.providerMessageId.startsWith("msg_mock_"));
  assert.equal(provider.sentEmails.length, 1);

  // Bounced simulation
  provider.setSimulatedOutcome("bounced", "Recipient address rejected by MX");
  const res2 = await provider.sendStatementEmail(payload);
  assert.equal(res2.status, "bounced");
  assert.equal(res2.error, "Recipient address rejected by MX");

  // Uncertain simulation (network timeout / provider ambiguity)
  provider.setSimulatedOutcome("uncertain", "Timeout waiting for gateway response");
  const res3 = await provider.sendStatementEmail(payload);
  assert.equal(res3.status, "uncertain");
  assert.equal(res3.error, "Timeout waiting for gateway response");

  // Failed simulation
  provider.setSimulatedOutcome("failed", "SMTP 550 permanent failure");
  const res4 = await provider.sendStatementEmail(payload);
  assert.equal(res4.status, "failed");
  assert.equal(res4.error, "SMTP 550 permanent failure");

  assert.equal(provider.sentEmails.length, 4);
});

test("delivery: global getStatementEmailProvider and setStatementEmailProvider lifecycle", () => {
  process.env.NODE_ENV = "test";
  setStatementEmailProvider(null);
  const defaultProvider = getStatementEmailProvider();
  assert.ok(defaultProvider);
  assert.equal(defaultProvider.providerName, "mock_email");

  const customMock = new MockStatementEmailProvider();
  setStatementEmailProvider(customMock);
  assert.equal(getStatementEmailProvider(), customMock);
});

test("delivery: getStatementEmailProvider fails closed outside test mode when unconfigured", () => {
  setStatementEmailProvider(null);
  const oldEnv = process.env.NODE_ENV;
  const oldUrl = process.env.STATEMENT_EMAIL_WEBHOOK_URL;
  try {
    delete process.env.STATEMENT_EMAIL_WEBHOOK_URL;
    process.env.NODE_ENV = "production";

    assert.throws(
      () => getStatementEmailProvider(),
      /STATEMENT_EMAIL_WEBHOOK_URL is required to dispatch statement emails in non-test runtimes/,
    );
  } finally {
    process.env.NODE_ENV = oldEnv;
    if (oldUrl) process.env.STATEMENT_EMAIL_WEBHOOK_URL = oldUrl;
    setStatementEmailProvider(null);
  }
});

test("delivery: encryptRecipientSecretRef and decryptRecipientSecretRef round-trip", () => {
  const email = "treasury@enterprise.co.za";
  const encrypted = encryptRecipientSecretRef(email);

  assert.ok(encrypted.startsWith("enc:v1:"));
  assert.ok(encrypted.includes("t***y@enterprise.co.za#"));

  const decrypted = decryptRecipientSecretRef(encrypted);
  assert.equal(decrypted, email);

  // Rejection of invalid secret refs
  assert.equal(decryptRecipientSecretRef("plain-invalid-ref"), null);
  assert.equal(decryptRecipientSecretRef("enc:v1:corrupt:data:tag#test"), null);
});

test("delivery: MockStatementEmailProvider supports queryDeliveryStatus", async () => {
  const provider = new MockStatementEmailProvider();
  provider.setSimulatedOutcome("uncertain");

  const res = await provider.sendStatementEmail({
    tenantId: "tenant-001",
    deliveryId: "del-001",
    statementId: "stmt-001",
    idempotencyKey: "idem-query-test",
    recipientEmail: "client@example.com",
    recipientName: "Client",
    accountNumber: "ACC-01",
    statementNumber: "STMT-01",
    periodEnd: "2026-08-31",
    closingBalance: "100.00",
    currency: "ZAR",
    downloadUrl: "https://example.com/dl",
    expiresAt: "2026-09-07T00:00:00Z",
  });

  assert.equal(res.status, "uncertain");

  // Remote provider query reveals actual accepted status
  const queryRes = await provider.queryDeliveryStatus({ idempotencyKey: "idem-query-test" });
  assert.ok(queryRes);
  assert.equal(queryRes.status, "accepted");
});

