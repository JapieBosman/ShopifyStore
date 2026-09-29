import assert from "node:assert/strict";
import test from "node:test";
import {
  verifyShopifySessionToken,
  createMockSessionToken,
  generateTokenSecretRef,
  handleAppReinstallation,
  AuthenticationError,
  type InstallationRecord,
} from "../src/auth/shopify.ts";
import {
  hasPermission,
  assertPermission,
  AuthorizationError,
} from "../src/auth/roles.ts";

const API_SECRET = "shpss_test_secret_key_12345";
const CLIENT_ID = "test_client_id_67890";
const SHOP = "displaydeck.myshopify.com";

test("valid session token verifies and extracts shop and user GID", () => {
  const token = createMockSessionToken(
    { dest: SHOP, aud: CLIENT_ID, sub: "gid://shopify/User/999" },
    API_SECRET,
  );

  const session = verifyShopifySessionToken({
    token,
    apiSecretKey: API_SECRET,
    expectedClientId: CLIENT_ID,
    expectedShop: SHOP,
  });

  assert.equal(session.shop, SHOP);
  assert.equal(session.shopifyUserId, "gid://shopify/User/999");
});

test("tampered signature is rejected with invalid_signature", () => {
  const validToken = createMockSessionToken({ dest: SHOP, aud: CLIENT_ID }, API_SECRET);
  const [header, payload] = validToken.split(".");
  const badToken = `${header}.${payload}.corrupted_signature_value`;

  assert.throws(
    () =>
      verifyShopifySessionToken({
        token: badToken,
        apiSecretKey: API_SECRET,
        expectedClientId: CLIENT_ID,
      }),
    (err: unknown) => {
      assert.ok(err instanceof AuthenticationError);
      assert.equal(err.code, "invalid_signature");
      return true;
    },
  );
});

test("mismatched client_id audience is rejected with audience_mismatch", () => {
  const token = createMockSessionToken({ dest: SHOP, aud: "wrong_client_id" }, API_SECRET);

  assert.throws(
    () =>
      verifyShopifySessionToken({
        token,
        apiSecretKey: API_SECRET,
        expectedClientId: CLIENT_ID,
      }),
    (err: unknown) => {
      assert.ok(err instanceof AuthenticationError);
      assert.equal(err.code, "audience_mismatch");
      return true;
    },
  );
});

test("expired token is rejected with token_expired", () => {
  const past = Math.floor(Date.now() / 1000) - 300;
  const token = createMockSessionToken(
    { dest: SHOP, aud: CLIENT_ID, exp: past, nbf: past - 60 },
    API_SECRET,
  );

  assert.throws(
    () =>
      verifyShopifySessionToken({
        token,
        apiSecretKey: API_SECRET,
        expectedClientId: CLIENT_ID,
      }),
    (err: unknown) => {
      assert.ok(err instanceof AuthenticationError);
      assert.equal(err.code, "token_expired");
      return true;
    },
  );
});

test("shop destination mismatch is rejected with shop_mismatch", () => {
  const token = createMockSessionToken(
    { dest: "other-merchant.myshopify.com", aud: CLIENT_ID },
    API_SECRET,
  );

  assert.throws(
    () =>
      verifyShopifySessionToken({
        token,
        apiSecretKey: API_SECRET,
        expectedClientId: CLIENT_ID,
        expectedShop: SHOP,
      }),
    (err: unknown) => {
      assert.ok(err instanceof AuthenticationError);
      assert.equal(err.code, "shop_mismatch");
      return true;
    },
  );
});

test("installation secret ref generation creates opaque reference without leaking secrets", () => {
  const ref = generateTokenSecretRef("displaydeck.myshopify.com");
  assert.match(ref, /^secrets:\/\/shopify\/displaydeck\.myshopify\.com\/offline-token-[0-9a-f]{16}$/);
});

test("handleAppReinstallation rotates secret reference and preserves tenant ID", () => {
  const initial: InstallationRecord = {
    tenantId: "11111111-1111-4111-8111-111111111111",
    shopGid: "gid://shopify/Shop/100",
    shopDomain: "displaydeck.myshopify.com",
    status: "uninstalled",
    tokenSecretRef: "secrets://shopify/displaydeck.myshopify.com/offline-token-old1234567890ab",
    scopes: ["read_customers"],
  };

  const reinstalled = handleAppReinstallation(initial, ["read_customers", "read_orders"]);

  assert.equal(reinstalled.tenantId, initial.tenantId);
  assert.equal(reinstalled.status, "active");
  assert.deepStrictEqual(reinstalled.scopes, ["read_customers", "read_orders"]);
  assert.notEqual(reinstalled.tokenSecretRef, initial.tokenSecretRef);
  assert.ok(reinstalled.tokenSecretRef.startsWith("secrets://shopify/displaydeck.myshopify.com/offline-token-"));
});

test("role-based permission matrix enforces cashier, bookkeeper, manager, owner boundaries", () => {
  // Cashier
  assert.equal(hasPermission("cashier", "request_account_sale"), true);
  assert.equal(hasPermission("cashier", "perform_cash_count"), true);
  assert.equal(hasPermission("cashier", "run_statements"), false);
  assert.equal(hasPermission("cashier", "approve_override"), false);
  assert.throws(() => assertPermission("cashier", "approve_override"), AuthorizationError);

  // Bookkeeper
  assert.equal(hasPermission("bookkeeper", "post_journal"), true);
  assert.equal(hasPermission("bookkeeper", "run_statements"), true);
  assert.equal(hasPermission("bookkeeper", "reconcile_shift"), false);
  assert.equal(hasPermission("bookkeeper", "manage_billing"), false);
  assert.throws(() => assertPermission("bookkeeper", "manage_billing"), AuthorizationError);

  // Manager
  assert.equal(hasPermission("manager", "approve_override"), true);
  assert.equal(hasPermission("manager", "reconcile_shift"), true);
  assert.equal(hasPermission("manager", "manage_billing"), false);
  assert.throws(() => assertPermission("manager", "manage_billing"), AuthorizationError);

  // Owner
  assert.equal(hasPermission("owner", "manage_billing"), true);
  assert.equal(hasPermission("owner", "approve_override"), true);

  // Worker
  assert.equal(hasPermission("worker", "process_inbox_outbox"), true);
  assert.equal(hasPermission("worker", "request_account_sale"), false);
});

test("resolveAuthContext: rejects unconfigured secrets and unsigned tokens", async () => {
  const { resolveAuthContext } = await import("../src/auth/context.ts");
  const fakeToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.signature";
  const req = {
    headers: {
      authorization: `Bearer ${fakeToken}`,
    },
  } as any;

  await assert.rejects(
    async () => {
      await resolveAuthContext(req, { apiSecretKey: undefined, clientId: undefined });
    },
    (err: any) => {
      assert.ok(err instanceof AuthenticationError);
      assert.equal(err.code, "unconfigured_secret");
      return true;
    },
  );
});

test("resolveAuthContext: rejects caller-supplied test headers when not permitted", async () => {
  const { resolveAuthContext } = await import("../src/auth/context.ts");
  const req = {
    headers: {
      "x-tenant-id": "11111111-1111-4111-8111-111111111111",
      "x-actor-role": "owner",
    },
  } as any;

  // When allowTestHeaders is false
  await assert.rejects(
    async () => {
      await resolveAuthContext(req, { allowTestHeaders: false });
    },
    (err: any) => {
      assert.ok(err instanceof AuthenticationError);
      assert.equal(err.code, "forbidden_header_auth");
      return true;
    },
  );
});
