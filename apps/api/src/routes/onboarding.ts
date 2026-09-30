import type { FastifyPluginAsync } from "fastify";
import { withTenantContext } from "../../../../packages/database/tenant-context.ts";
import { parseMoney } from "../../../../packages/domain/src/money.ts";
import { requireAuth, requirePermission, type AuthResolverOptions } from "../auth/context.ts";

export const onboardingRoutes: FastifyPluginAsync<AuthResolverOptions> = async (server, options) => {
  const db = options.db;
  if (!db) throw new Error("Database is required for onboarding");
  const auth = requireAuth(options);
  server.get("/v1/onboarding", { preHandler: [auth, requirePermission("view_accounts")] }, async (request) => {
    const tenantId = request.authContext!.tenantId;
    return withTenantContext(db, tenantId, async (connection) => {
      const result = await connection.query<{ preferences: Record<string, unknown> }>(
        "SELECT preferences FROM tenant_onboarding WHERE tenant_id = $1", [tenantId],
      );
      const tenant = await connection.query<{ base_currency: string }>("SELECT base_currency FROM tenant WHERE id = $1", [tenantId]);
      return { operatingCurrency: tenant.rows[0]!.base_currency, ...result.rows[0]?.preferences };
    });
  });
  server.patch("/v1/onboarding", { preHandler: [auth, requirePermission("manage_policy")] }, async (request, reply) => {
    const raw = request.body;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reply.code(400).send({ message: "Preferences must be an object" });
    const body = raw as Record<string, unknown>;
    const allowed = new Set(["operatingCurrency", "agingBasis", "defaultCreditLimit", "defaultTermsType", "defaultTermsDays", "step", "isCompleted"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) return reply.code(400).send({ message: "Unknown onboarding preference" });
    try {
      if (body.agingBasis !== undefined && !["due_date", "calendar_period"].includes(String(body.agingBasis))) throw new Error("Invalid aging basis");
      if (body.defaultTermsType !== undefined && !["net_monthly", "eom", "cod"].includes(String(body.defaultTermsType))) throw new Error("Invalid payment terms");
      if (body.defaultTermsDays !== undefined && (!Number.isInteger(body.defaultTermsDays) || Number(body.defaultTermsDays) < 0 || Number(body.defaultTermsDays) > 365)) throw new Error("Payment days must be an integer from 0 to 365");
      if (body.step !== undefined && (!Number.isInteger(body.step) || Number(body.step) < 1 || Number(body.step) > 4)) throw new Error("Invalid onboarding step");
      if (body.isCompleted !== undefined && typeof body.isCompleted !== "boolean") throw new Error("Invalid completion status");
      if (body.defaultCreditLimit !== undefined && (typeof body.defaultCreditLimit !== "string" || parseMoney(body.defaultCreditLimit) < 0n)) throw new Error("Credit limit must be a nonnegative money amount");
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Invalid preferences" });
    }
    const tenantId = request.authContext!.tenantId;
    return withTenantContext(db, tenantId, async (connection) => {
      const tenant = await connection.query<{ base_currency: string }>("SELECT base_currency FROM tenant WHERE id = $1", [tenantId]);
      if (body.operatingCurrency !== undefined && body.operatingCurrency !== tenant.rows[0]!.base_currency) return reply.code(400).send({ message: "Ledger currency must match the tenant base currency" });
      const result = await connection.query<{ preferences: Record<string, unknown> }>(
        `INSERT INTO tenant_onboarding (tenant_id, preferences) VALUES ($1, $2::jsonb)
         ON CONFLICT (tenant_id) DO UPDATE SET preferences = tenant_onboarding.preferences || EXCLUDED.preferences, updated_at = now()
         RETURNING preferences`, [tenantId, JSON.stringify(body)],
      );
      return { operatingCurrency: tenant.rows[0]!.base_currency, ...result.rows[0]!.preferences };
    });
  });
};
