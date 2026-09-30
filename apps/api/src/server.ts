import Fastify, { type FastifyInstance } from "fastify";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DbClient } from "../../../packages/database/tenant-context.ts";
import { verifyShopifyWebhook } from "./shopify-webhook.ts";
import { accountsRoutes } from "./routes/accounts.ts";
import { onboardingRoutes } from "./routes/onboarding.ts";
import { paymentsRoutes } from "./routes/payments.ts";
import { allocationsRoutes } from "./routes/allocations.ts";
import { statementsRoutes } from "./routes/statements.ts";
import { statementDeliveryRoutes } from "./routes/statement-delivery.ts";
import { MemoryIdempotencyStore, PostgresIdempotencyStore, type IdempotencyStore } from "./idempotency.ts";

export interface ServerOptions {
  db?: DbClient;
  apiSecretKey?: string;
  clientId?: string;
  idempotencyStore?: IdempotencyStore;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: false, trustProxy: false });

  const idempotencyStore =
    options.idempotencyStore ??
    (options.db ? new PostgresIdempotencyStore(options.db) : new MemoryIdempotencyStore());

  server.get("/health/live", async () => ({ status: "ok" }));
  server.get("/health/ready", async (_request, reply) => {
    if (options.db) {
      return reply.code(200).send({ status: "ready" });
    }
    return reply.code(503).send({
      status: "not_ready",
      reason: "Shopify installation and PostgreSQL are not configured",
    });
  });

  server.register(
    async (webhooks) => {
      webhooks.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
        done(null, body);
      });
      webhooks.post<{ Body: Buffer }>("/shopify", async (request, reply) => {
        const secret = options.apiSecretKey ?? process.env.SHOPIFY_API_SECRET;
        if (!secret || !verifyShopifyWebhook(request.body, request.headers["x-shopify-hmac-sha256"], secret)) {
          return reply.code(401).send({ error: "invalid_signature" });
        }
        // A verified webhook must enter a durable inbox before an acknowledgement is sent.
        return reply.code(503).send({ error: "webhook_inbox_not_configured" });
      });
    },
    { prefix: "/webhooks" },
  );

  if (options.db) {
    const routeOpts = {
      db: options.db,
      apiSecretKey: options.apiSecretKey,
      clientId: options.clientId,
      idempotencyStore,
    };
    server.register(accountsRoutes, routeOpts);
    server.register(onboardingRoutes, routeOpts);
    server.register(paymentsRoutes, routeOpts);
    server.register(allocationsRoutes, routeOpts);
    server.register(statementsRoutes, routeOpts);
    server.register(statementDeliveryRoutes, routeOpts);
  }

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const isTest = process.env.NODE_ENV === "test";
  const apiSecretKey = process.env.SHOPIFY_API_SECRET;
  const clientId = process.env.SHOPIFY_CLIENT_ID;

  if (!isTest && (!apiSecretKey || !clientId)) {
    throw new Error(
      "SHOPIFY_API_SECRET and SHOPIFY_CLIENT_ID environment variables must be configured to run the Trade API server",
    );
  }

  const { initApiDatabase } = await import("./db.ts");
  const db = await initApiDatabase();
  const server = buildServer({
    db,
    apiSecretKey: apiSecretKey || "shpss_test_secret_key_12345",
    clientId: clientId || "test_client_id_67890",
  });
  const port = Number(process.env.PORT ?? "3001");
  const host = process.env.HOST ?? "127.0.0.1";
  await server.listen({ port, host });
  console.log(`[Trade API] Standalone server active on http://${host}:${port} with PostgreSQL backing`);
}
