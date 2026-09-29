import crypto from "node:crypto";

export interface ShopifySessionTokenPayload {
  iss: string;
  dest: string;
  aud: string;
  sub: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  sid: string;
}

export interface VerifySessionTokenOptions {
  token: string;
  apiSecretKey: string;
  expectedClientId: string;
  expectedShop?: string;
  nowSeconds?: number;
}

export interface VerifiedSession {
  shop: string;
  shopifyUserId: string;
  sessionTokenPayload: ShopifySessionTokenPayload;
}

export class AuthenticationError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AuthenticationError";
  }
}

/**
 * Verifies an App Bridge session token (JWT signed with HMAC-SHA256 using the app's secret key).
 * Enforces signature integrity, audience matching, expiration, and shop destination.
 */
export function verifyShopifySessionToken(options: VerifySessionTokenOptions): VerifiedSession {
  const { token, apiSecretKey, expectedClientId, expectedShop, nowSeconds = Math.floor(Date.now() / 1000) } = options;

  if (!token || typeof token !== "string") {
    throw new AuthenticationError("missing_token", "Session token is required");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthenticationError("malformed_token", "Invalid JWT format: expected three parts");
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new AuthenticationError("malformed_token", "Empty JWT segment detected");
  }

  // Verify HMAC-SHA256 signature
  const signedContent = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto
    .createHmac("sha256", apiSecretKey)
    .update(signedContent)
    .digest("base64url");

  const sigBuf = Buffer.from(signatureB64);
  const expectedSigBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expectedSigBuf.length || !crypto.timingSafeEqual(sigBuf, expectedSigBuf)) {
    throw new AuthenticationError("invalid_signature", "Session token signature verification failed");
  }

  // Parse header and payload
  let payload: ShopifySessionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new AuthenticationError("invalid_payload", "Failed to parse JWT payload JSON");
  }

  // Verify Audience (client_id / API key)
  if (payload.aud !== expectedClientId) {
    throw new AuthenticationError("audience_mismatch", `Audience mismatch: expected ${expectedClientId}, got ${payload.aud}`);
  }

  // Verify Expiry
  if (payload.exp <= nowSeconds) {
    throw new AuthenticationError("token_expired", `Session token expired at ${payload.exp}, current time is ${nowSeconds}`);
  }

  // Verify Not-Before
  if (payload.nbf > nowSeconds) {
    throw new AuthenticationError("token_not_active", `Session token not valid before ${payload.nbf}, current time is ${nowSeconds}`);
  }

  // Extract and verify shop domain from destination
  // dest is formatted as "https://{shop}.myshopify.com"
  const destUrl = payload.dest.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (expectedShop && destUrl !== expectedShop.replace(/^https?:\/\//, "").replace(/\/$/, "")) {
    throw new AuthenticationError("shop_mismatch", `Shop destination mismatch: expected ${expectedShop}, got ${destUrl}`);
  }

  return {
    shop: destUrl,
    shopifyUserId: payload.sub,
    sessionTokenPayload: payload,
  };
}

/**
 * Creates a signed mock Shopify session token for testing and local simulation.
 */
export function createMockSessionToken(
  payload: Partial<ShopifySessionTokenPayload>,
  apiSecretKey: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: ShopifySessionTokenPayload = {
    iss: `https://${payload.dest ?? "displaydeck.myshopify.com"}/admin`,
    dest: `https://${payload.dest ?? "displaydeck.myshopify.com"}`,
    aud: payload.aud ?? "test-client-id",
    sub: payload.sub ?? "gid://shopify/User/12345",
    exp: payload.exp ?? now + 3600,
    nbf: payload.nbf ?? now - 60,
    iat: payload.iat ?? now,
    jti: payload.jti ?? crypto.randomUUID(),
    sid: payload.sid ?? crypto.randomUUID(),
    ...payload,
  };

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", apiSecretKey)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Installation token lifecycle manager.
 * Stores opaque secret-manager references rather than raw token strings in the database.
 */
export interface InstallationRecord {
  tenantId: string;
  shopGid: string;
  shopDomain: string;
  status: "active" | "uninstalled" | "suspended";
  tokenSecretRef: string;
  refreshSecretRef?: string;
  tokenExpiresAt?: Date;
  scopes: string[];
}

export function generateTokenSecretRef(shopDomain: string): string {
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  return `secrets://shopify/${shopDomain}/offline-token-${randomSuffix}`;
}

export function handleAppReinstallation(
  current: InstallationRecord,
  newScopes: string[],
  newExpiresAt?: Date,
): InstallationRecord {
  return {
    ...current,
    status: "active",
    scopes: newScopes,
    tokenSecretRef: generateTokenSecretRef(current.shopDomain),
    tokenExpiresAt: newExpiresAt,
  };
}
