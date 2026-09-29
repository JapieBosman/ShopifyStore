import assert from "node:assert/strict";
import test from "node:test";
import {
  verifyShopifySessionToken,
  createMockSessionToken,
  generateTokenSecretRef,
  handleAppReinstallation,
  AuthenticationError,
  type InstallationRecord,
} from "../../apps/api/src/auth/shopify.ts";
import {
  hasPermission,
  assertPermission,
  AuthorizationError,
} from "../../apps/api/src/auth/roles.ts";

const API_SECRET = "shpss_test_secret_key_12345";
const CLIENT_ID = "test_client_id_67890";
const SHOP = "displaydeck.myshopify.com";

test("integration: session token verification extracts shop and user GID", () => {
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

test("integration: token rejection on invalid signature, audience, expiry, or shop", () => {
  // Tampered signature
  const validToken = createMockSessionToken({ dest: SHOP, aud: CLIENT_ID }, API_SECRET);
  const [header, payload] = validToken.split(".");
  assert.throws(
    () =>
      verifyShopifySessionToken({
        token: `${header}.${payload}.corrupted_sig`,
        apiSecretKey: API_SECRET,
        expectedClientId: CLIENT_ID,
      }),
    AuthenticationError,
  );

  // Audience mismatch
  const badAudToken = createMockSessionToken({ dest: SHOP, aud: "wrong_id" }, API_SECRET);
  assert.throws(
    () =>
      verifyShopifySessionToken({
        token: badAudToken,
        apiSecretKey: API_SECRET,
        expectedClientId: CLIENT_ID,
      }),
    AuthenticationError,
  );

  // Expired token
  const past = Math.floor(Date.now() / 1000) - 300;
  const expiredToken = createMockSessionToken({ dest: SHOP, aud: CLIENT_ID, exp: past, nbf: past - 60 }, API_SECRET);
  assert.throws(
    () =>
      verifyShopifySessionToken({
        token: expiredToken,
        apiSecretKey: API_SECRET,
        expectedClientId: CLIENT_ID,
      }),
    AuthenticationError,
  );
});

test("integration: reinstall lifecycle rotates token secret reference and preserves tenant", () => {
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
  assert.notEqual(reinstalled.tokenSecretRef, initial.tokenSecretRef);
  assert.ok(reinstalled.tokenSecretRef.startsWith("secrets://shopify/displaydeck.myshopify.com/offline-token-"));
});

test("integration: role permission restrictions enforce strict role boundaries", () => {
  assert.equal(hasPermission("cashier", "request_account_sale"), true);
  assert.equal(hasPermission("cashier", "run_statements"), false);
  assert.throws(() => assertPermission("cashier", "run_statements"), AuthorizationError);

  assert.equal(hasPermission("bookkeeper", "run_statements"), true);
  assert.equal(hasPermission("bookkeeper", "manage_billing"), false);
  assert.throws(() => assertPermission("bookkeeper", "manage_billing"), AuthorizationError);

  assert.equal(hasPermission("owner", "manage_billing"), true);
});
