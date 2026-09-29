import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { DbClient } from "../../../../packages/database/tenant-context.ts";
import { requireAuth, requirePermission, type AuthResolverOptions } from "../auth/context.ts";
import {
  enqueueStatementDelivery,
  processQueuedDeliveries,
  getStatementDeliveries,
  recordDeliveryCallback,
} from "../../../worker/src/delivery.ts";
import { validateRecipientEmail } from "../../../../packages/domain/src/delivery.ts";

export interface StatementDeliveryRouteOptions extends AuthResolverOptions {
  db: DbClient;
}

export const statementDeliveryRoutes: FastifyPluginAsync<StatementDeliveryRouteOptions> = async (
  fastify,
  opts,
) => {
  const { db } = opts;

  if (!db) {
    throw new Error("Database client is required for statement delivery routes");
  }

  const authHook = requireAuth(opts);

  // ==========================================
  // POST /v1/statements/:id/deliver
  // Trigger statement delivery via Email
  // Role: run_statements (bookkeeper, manager, owner)
  // Cashier is strictly denied
  // ==========================================
  fastify.post(
    "/v1/statements/:id/deliver",
    { preHandler: [authHook, requirePermission("run_statements")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.authContext!.tenantId;
      const { id } = request.params as { id: string };
      const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

      if (!idempotencyKey || !idempotencyKey.trim()) {
        return reply.code(400).send({
          error: "bad_request",
          code: "missing_idempotency_key",
          message: "Idempotency-Key header is required for statement delivery",
        });
      }

      const body = (request.body || {}) as {
        recipientEmail?: string;
        channel?: string;
        immediate?: boolean;
      };

      const channel = (body.channel || "email").toLowerCase();

      // Defer SMS as required by TASK-019
      if (channel === "sms") {
        return reply.code(422).send({
          error: "unprocessable_entity",
          code: "sms_delivery_deferred",
          message: "SMS delivery is deferred in v1; only email is supported",
        });
      }

      if (channel !== "email") {
        return reply.code(400).send({
          error: "bad_request",
          code: "unsupported_channel",
          message: `Delivery channel '${channel}' is not supported`,
        });
      }

      if (!body.recipientEmail) {
        return reply.code(400).send({
          error: "bad_request",
          code: "missing_recipient_email",
          message: "recipientEmail is required",
        });
      }

      const emailCheck = validateRecipientEmail(body.recipientEmail);
      if (!emailCheck.valid) {
        return reply.code(422).send({
          error: "unprocessable_entity",
          code: "invalid_recipient_email",
          message: emailCheck.error || "Invalid recipient email address",
        });
      }

      try {
        const delivery = await enqueueStatementDelivery(db, tenantId, {
          statementId: id,
          channel: "email",
          recipientEmail: body.recipientEmail,
          idempotencyKey: idempotencyKey.trim(),
        });

        // If newly queued, immediately process delivery so callers receive live delivery status
        if (delivery.status === "queued" && body.immediate !== false) {
          const processRes = await processQueuedDeliveries(db, tenantId, {
            limit: 1,
            recipientEmailOverride: body.recipientEmail,
          });

          const current = processRes.deliveries.find((d) => d.id === delivery.id);
          if (current) {
            delivery.status = current.status;
            delivery.providerMessageId = current.providerMessageId || null;
            delivery.attemptCount = delivery.attemptCount + 1;
            delivery.lastAttemptAt = new Date().toISOString();
          }
        }

        return reply.code(200).send(delivery);
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes("was not found")) {
          return reply.code(404).send({
            error: "not_found",
            code: "statement_not_found",
            message,
          });
        }
        return reply.code(500).send({
          error: "internal_error",
          code: "delivery_enqueue_failed",
          message,
        });
      }
    },
  );

  // ==========================================
  // GET /v1/statements/:id/deliveries
  // Retrieve delivery audit history for a statement
  // Role: view_accounts (cashier, bookkeeper, manager, owner)
  // ==========================================
  fastify.get(
    "/v1/statements/:id/deliveries",
    { preHandler: [authHook, requirePermission("view_accounts")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.authContext!.tenantId;
      const { id } = request.params as { id: string };

      try {
        const deliveries = await getStatementDeliveries(db, tenantId, id);
        return reply.code(200).send({ deliveries });
      } catch (err) {
        return reply.code(500).send({
          error: "internal_error",
          code: "fetch_deliveries_failed",
          message: (err as Error).message,
        });
      }
    },
  );

  // ==========================================
  // POST /v1/deliveries/callback
  // Provider webhook status callback (e.g. delivered, bounced)
  // ==========================================
  fastify.post(
    "/v1/deliveries/callback",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const configuredSecret = process.env.DELIVERY_CALLBACK_SECRET?.trim();
      if (!configuredSecret) {
        if (!process.env.NODE_ENV || process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") {
          // Dev / test fallback token permitted in isolated local environments
        } else {
          return reply.code(500).send({
            error: "internal_error",
            code: "delivery_callback_unconfigured",
            message: "DELIVERY_CALLBACK_SECRET is not configured on this server",
          });
        }
      }
      const callbackSecret = configuredSecret || "genesis-delivery-callback-token";
      const authHeader = request.headers["x-delivery-callback-token"] || request.headers.authorization;

      if (authHeader !== callbackSecret && authHeader !== `Bearer ${callbackSecret}`) {
        return reply.code(401).send({
          error: "unauthorized",
          code: "invalid_callback_secret",
          message: "Valid callback token is required",
        });
      }

      const body = (request.body || {}) as {
        tenantId?: string;
        providerMessageId?: string;
        status?: "delivered" | "bounced" | "failed";
        reason?: string;
        timestamp?: string;
      };

      if (!body.tenantId || !body.providerMessageId || !body.status) {
        return reply.code(400).send({
          error: "bad_request",
          code: "missing_required_fields",
          message: "tenantId, providerMessageId, and status are required",
        });
      }

      if (!["delivered", "bounced", "failed"].includes(body.status)) {
        return reply.code(400).send({
          error: "bad_request",
          code: "invalid_status",
          message: "status must be 'delivered', 'bounced', or 'failed'",
        });
      }

      try {
        const updated = await recordDeliveryCallback(db, body.tenantId, {
          providerMessageId: body.providerMessageId,
          status: body.status,
          reason: body.reason,
          timestamp: body.timestamp,
        });

        if (!updated) {
          return reply.code(404).send({
            error: "not_found",
            code: "delivery_not_found",
            message: `Delivery with providerMessageId ${body.providerMessageId} was not found for tenant`,
          });
        }

        return reply.code(200).send({ ok: true, status: body.status });
      } catch (err) {
        return reply.code(500).send({
          error: "internal_error",
          code: "callback_processing_failed",
          message: (err as Error).message,
        });
      }
    },
  );
};
