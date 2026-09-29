import type { FastifyRequest, FastifyReply } from "fastify";
import type { DbClient } from "../../../../packages/database/tenant-context.ts";
import { validateTenantId } from "../../../../packages/database/tenant-context.ts";
import {
  verifyShopifySessionToken,
  AuthenticationError,
  type VerifiedSession,
} from "./shopify.ts";
import {
  type ActorRole,
  type Permission,
  hasPermission,
  assertPermission,
  AuthorizationError,
} from "./roles.ts";

export interface RequestAuthContext {
  tenantId: string;
  shop: string;
  actorId: string;
  actorRole: ActorRole;
  shopifyUserId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    authContext?: RequestAuthContext;
  }
}

export interface AuthResolverOptions {
  db?: DbClient | null;
  apiSecretKey?: string;
  clientId?: string;
  allowTestHeaders?: boolean;
}

/**
 * Extracts and verifies the authentication context from a Fastify request.
 * Derives the tenant and actor role securely from the cryptographically verified session and database.
 * Never trusts unverified tokens or caller-supplied identity/roles in production.
 */
export async function resolveAuthContext(
  request: FastifyRequest,
  options: AuthResolverOptions,
): Promise<RequestAuthContext> {
  const isTestEnvironment =
    process.env.NODE_ENV === "test" && options.allowTestHeaders === true;

  const authHeader = request.headers["authorization"];
  let verifiedSession: VerifiedSession | null = null;

  if (authHeader && typeof authHeader === "string") {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token) {
      if (!options.apiSecretKey || !options.clientId) {
        throw new AuthenticationError(
          "unconfigured_secret",
          "API secrets are not configured for session verification",
        );
      }
      try {
        verifiedSession = verifyShopifySessionToken({
          token,
          apiSecretKey: options.apiSecretKey,
          expectedClientId: options.clientId,
        });
      } catch (err) {
        if (err instanceof AuthenticationError) {
          throw err;
        }
        throw new AuthenticationError("invalid_token", String(err));
      }
    }
  }

  // Reject caller-supplied test headers in non-test environments or when not explicitly allowed
  const hasTestHeaders = Boolean(
    request.headers["x-tenant-id"] ||
    request.headers["x-actor-role"] ||
    request.headers["x-actor-id"] ||
    request.headers["x-shopify-shop"]
  );

  if (hasTestHeaders && !isTestEnvironment) {
    throw new AuthenticationError(
      "forbidden_header_auth",
      "Direct header-based authentication is strictly prohibited in production and live environments",
    );
  }

  let tenantId: string | undefined;
  let shop: string;
  let shopifyUserId: string;
  let actorId: string | undefined;
  let actorRole: ActorRole | undefined;

  if (verifiedSession) {
    shop = verifiedSession.shop;
    shopifyUserId = verifiedSession.shopifyUserId;

    if (!options.db) {
      throw new AuthenticationError("database_unavailable", "Database required to resolve tenant installation");
    }

    // Look up tenant from installation table
    const instRes = await options.db.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM installation WHERE shop_domain = $1 AND status = 'active'",
      [shop],
    );
    if (instRes.rows.length === 0) {
      throw new AuthenticationError("installation_not_found", `No active installation found for shop '${shop}'`);
    }
    tenantId = instRes.rows[0]!.tenant_id;

    // Look up actor and role from database - CANNOT be forged by caller
    const actorRes = await options.db.query<{ id: string; role: ActorRole }>(
      "SELECT id, role FROM actor WHERE tenant_id = $1 AND external_subject = $2 AND active = true",
      [tenantId, shopifyUserId],
    );
    if (actorRes.rows.length === 0) {
      throw new AuthenticationError("unauthorized_actor", `Shopify user '${shopifyUserId}' has no active actor role in tenant`);
    }
    actorId = actorRes.rows[0]!.id;
    actorRole = actorRes.rows[0]!.role;
  } else if (isTestEnvironment) {
    // Only in test environment with allowTestHeaders explicitly enabled
    tenantId = request.headers["x-tenant-id"] as string | undefined;
    shop = (request.headers["x-shopify-shop"] as string | undefined) ?? "test-shop.myshopify.com";
    shopifyUserId = "gid://shopify/User/test";
    actorId = (request.headers["x-actor-id"] as string | undefined) ?? "00000000-0000-4000-8000-000000000001";
    const testRole = request.headers["x-actor-role"] as string | undefined;
    if (testRole && isValidRole(testRole)) {
      actorRole = testRole;
    } else {
      actorRole = "cashier";
    }
  } else {
    throw new AuthenticationError(
      "unauthenticated",
      "Authentication required: missing valid Bearer session token",
    );
  }

  if (!tenantId) {
    throw new AuthenticationError("unauthenticated", "Authentication required: missing tenant context");
  }

  validateTenantId(tenantId);

  return {
    tenantId,
    shop,
    actorId,
    actorRole,
    shopifyUserId,
  };
}

function isValidRole(role: string): role is ActorRole {
  return ["owner", "manager", "bookkeeper", "cashier", "worker"].includes(role);
}

/**
 * Fastify preHandler hook requiring verified authentication.
 */
export function requireAuth(options: AuthResolverOptions) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      request.authContext = await resolveAuthContext(request, options);
    } catch (err) {
      if (err instanceof AuthenticationError) {
        return reply.code(401).send({
          error: "unauthorized",
          code: err.code,
          message: err.message,
        });
      }
      return reply.code(401).send({
        error: "unauthorized",
        code: "invalid_session",
        message: "Failed to authenticate session",
      });
    }
  };
}

/**
 * Fastify preHandler hook asserting that the authenticated actor has a required permission.
 */
export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.authContext;
    if (!auth) {
      return reply.code(401).send({
        error: "unauthorized",
        code: "missing_auth_context",
        message: "Authentication required",
      });
    }

    if (!hasPermission(auth.actorRole, permission)) {
      return reply.code(403).send({
        error: "forbidden",
        code: "insufficient_permissions",
        message: `Role '${auth.actorRole}' is not authorized to perform '${permission}'`,
      });
    }
  };
}
