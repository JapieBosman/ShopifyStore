import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { DbClient } from "../../../../packages/database/tenant-context.ts";
import { withTenantContext } from "../../../../packages/database/tenant-context.ts";
import {
  executeExplicitAllocation,
  executeOldestFirstAllocation,
  reverseAllocation,
  getDebtorBalanceSummary,
} from "../../../../packages/domain/src/allocation.ts";
import { requireAuth, requirePermission, type AuthResolverOptions } from "../auth/context.ts";
import { computeRequestHash, type IdempotencyStore } from "../idempotency.ts";

export interface AllocationsRouteOptions extends AuthResolverOptions {
  idempotencyStore: IdempotencyStore;
}

export const allocationsRoutes: FastifyPluginAsync<AllocationsRouteOptions> = async (fastify, opts) => {
  const { db, idempotencyStore } = opts;

  if (!db) {
    throw new Error("Database client is required for allocations routes");
  }

  const authHook = requireAuth(opts);

  /**
   * Helper to enforce Idempotency-Key on mutating financial requests.
   */
  async function checkIdempotency(request: FastifyRequest, reply: FastifyReply): Promise<{
    idempotencyKey: string;
    requestHash: string;
  } | null> {
    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
      reply.code(400).send({
        error: "bad_request",
        code: "missing_idempotency_key",
        message: "Idempotency-Key header is required for this operation",
      });
      return null;
    }

    const tenantId = request.authContext!.tenantId;
    const requestHash = computeRequestHash(request.body ?? {});
    const claimRes = await idempotencyStore.claim(tenantId, idempotencyKey, requestHash);

    if (claimRes.state === "conflict") {
      reply.code(409).send({
        error: "conflict",
        code: "idempotency_conflict",
        message: claimRes.message,
      });
      return null;
    }

    if (claimRes.state === "in_flight") {
      reply.code(409).send({
        error: "conflict",
        code: "concurrent_mutation_in_progress",
        message: "An allocation mutation with this Idempotency-Key is currently in progress",
      });
      return null;
    }

    if (claimRes.state === "cached") {
      reply.code(claimRes.record.statusCode).header("idempotent-replayed", "true").send(claimRes.record.responseBody);
      return null;
    }

    return { idempotencyKey, requestHash };
  }

  // ==========================================
  // POST /v1/allocations
  // Create an explicit or oldest-first allocation
  // Role: allocate_payment (bookkeeper, manager, owner)
  // ==========================================
  fastify.post(
    "/v1/allocations",
    { preHandler: [authHook, requirePermission("allocate_payment")] },
    async (request, reply) => {
      const idem = await checkIdempotency(request, reply);
      if (!idem) return;

      const tenantId = request.authContext!.tenantId;
      const body = request.body as {
        debtorAccountId?: string;
        mode?: "explicit" | "oldest_first";
        debitDocumentId?: string;
        creditDocumentId?: string;
        amount?: string;
        effectiveDate?: string;
      };

      if (!body.debtorAccountId || !body.mode || !body.effectiveDate) {
        return reply.code(400).send({
          error: "bad_request",
          code: "missing_required_fields",
          message: "debtorAccountId, mode, and effectiveDate are required",
        });
      }

      if (body.mode === "explicit") {
        if (!body.debitDocumentId || !body.creditDocumentId || !body.amount) {
          return reply.code(400).send({
            error: "bad_request",
            code: "missing_explicit_fields",
            message: "debitDocumentId, creditDocumentId, and amount are required for explicit allocations",
          });
        }

        const debtorAccountId = body.debtorAccountId!;
        const debitDocumentId = body.debitDocumentId!;
        const creditDocumentId = body.creditDocumentId!;
        const amount = body.amount!;
        const effectiveDate = body.effectiveDate!;

        try {
          const responseBody = await withTenantContext(db, tenantId, async (tx) => {
            await idempotencyStore.verifyAndLockLease(tenantId, idem.idempotencyKey, tx);

            const result = await executeExplicitAllocation(tx, tenantId, {
              actorId: request.authContext!.actorId,
              debtorAccountId,
              debitDocumentId,
              creditDocumentId,
              amount,
              effectiveDate,
              idempotencyKey: idem.idempotencyKey,
            });

            const resp = {
              mode: "explicit",
              allocationId: result.allocationId,
              debtorAccountId: result.debtorAccountId,
              debitDocumentId: result.debitDocumentId,
              creditDocumentId: result.creditDocumentId,
              amount: result.amount,
              isDuplicate: result.isDuplicate,
              unappliedCredit: result.unappliedCredit,
              netBalance: result.netBalance,
            };

            await idempotencyStore.complete(tenantId, idem.idempotencyKey, 201, resp, tx);
            return resp;
          });

          return reply.code(201).send(responseBody);
        } catch (err: unknown) {
          const error = err as Error;
          if (error.message === "idempotency_lease_lost") {
            return reply.code(409).send({
              error: "conflict",
              code: "concurrent_mutation_in_progress",
              message: "A mutation with this Idempotency-Key is currently in progress",
            });
          }
          if (error.message.includes("Cannot allocate across different currencies")) {
            return reply.code(422).send({
              error: "unprocessable_entity",
              code: "currency_mismatch",
              message: error.message,
            });
          }
          if (error.message.includes("not found")) {
            return reply.code(404).send({
              error: "not_found",
              code: "document_not_found",
              message: error.message,
            });
          }
          return reply.code(422).send({
            error: "unprocessable_entity",
            code: "allocation_failed",
            message: error.message,
          });
        }
      } else if (body.mode === "oldest_first") {
        if (!body.creditDocumentId) {
          return reply.code(400).send({
            error: "bad_request",
            code: "missing_credit_document_id",
            message: "creditDocumentId is required for oldest_first allocations",
          });
        }

        const debtorAccountId = body.debtorAccountId!;
        const creditDocumentId = body.creditDocumentId!;
        const effectiveDate = body.effectiveDate!;

        try {
          const responseBody = await withTenantContext(db, tenantId, async (tx) => {
            await idempotencyStore.verifyAndLockLease(tenantId, idem.idempotencyKey, tx);

            const result = await executeOldestFirstAllocation(tx, tenantId, {
              actorId: request.authContext!.actorId,
              debtorAccountId,
              creditDocumentId,
              effectiveDate,
              idempotencyKeyPrefix: idem.idempotencyKey,
            });

            const resp = {
              mode: "oldest_first",
              debtorAccountId,
              creditDocumentId,
              totalAllocated: result.totalAllocated,
              unappliedCredit: result.unappliedCredit,
              netBalance: result.netBalance,
              allocations: result.allocations,
            };

            await idempotencyStore.complete(tenantId, idem.idempotencyKey, 201, resp, tx);
            return resp;
          });

          return reply.code(201).send(responseBody);
        } catch (err: unknown) {
          const error = err as Error;
          if (error.message.includes("not found")) {
            return reply.code(404).send({
              error: "not_found",
              code: "document_not_found",
              message: error.message,
            });
          }
          return reply.code(422).send({
            error: "unprocessable_entity",
            code: "allocation_failed",
            message: error.message,
          });
        }
      } else {
        return reply.code(400).send({
          error: "bad_request",
          code: "invalid_mode",
          message: "mode must be either 'explicit' or 'oldest_first'",
        });
      }
    },
  );

  // ==========================================
  // POST /v1/allocations/:id/reverse
  // Reverse an existing allocation immutably
  // Role: allocate_payment (bookkeeper, manager, owner)
  // ==========================================
  fastify.post(
    "/v1/allocations/:id/reverse",
    { preHandler: [authHook, requirePermission("allocate_payment")] },
    async (request, reply) => {
      const idem = await checkIdempotency(request, reply);
      if (!idem) return;

      const tenantId = request.authContext!.tenantId;
      const { id } = request.params as { id: string };
      const body = request.body as {
        reason?: string;
        effectiveDate?: string;
      };

      if (!body.reason || !body.effectiveDate) {
        return reply.code(400).send({
          error: "bad_request",
          code: "missing_required_fields",
          message: "reason and effectiveDate are required",
        });
      }

      const reason = body.reason!;
      const effectiveDate = body.effectiveDate!;

      try {
        const responseBody = await withTenantContext(db, tenantId, async (tx) => {
          await idempotencyStore.verifyAndLockLease(tenantId, idem.idempotencyKey, tx);

          const allocRes = await tx.query<{ debtor_account_id: string }>(
            "SELECT debtor_account_id FROM allocation WHERE tenant_id = $1 AND id = $2",
            [tenantId, id],
          );

          const result = await reverseAllocation(tx, tenantId, {
            actorId: request.authContext!.actorId,
            allocationId: id,
            reason,
            effectiveDate,
          });

          let debtorBalance = null;
          if (allocRes.rows.length > 0) {
            debtorBalance = await getDebtorBalanceSummary(tx, tenantId, allocRes.rows[0]!.debtor_account_id);
          }

          const resp = {
            reversalId: result.reversalId,
            allocationId: result.allocationId,
            restoredAmount: result.amount,
            effectiveDate: result.effectiveDate,
            reason: body.reason,
            unappliedCredit: debtorBalance ? debtorBalance.unappliedCredit : "0.0000",
            netBalance: debtorBalance ? debtorBalance.netBalance : "0.0000",
          };

          await idempotencyStore.complete(tenantId, idem.idempotencyKey, 200, resp, tx);
          return resp;
        });

        return reply.code(200).send(responseBody);
      } catch (err: unknown) {
        const error = err as Error;
        if (error.message === "idempotency_lease_lost") {
          return reply.code(409).send({
            error: "conflict",
            code: "concurrent_mutation_in_progress",
            message: "A mutation with this Idempotency-Key is currently in progress",
          });
        }
        if (error.message.includes("already been reversed")) {
          return reply.code(409).send({
            error: "conflict",
            code: "already_reversed",
            message: error.message,
          });
        }
        if (error.message.includes("not found")) {
          return reply.code(404).send({
            error: "not_found",
            code: "allocation_not_found",
            message: error.message,
          });
        }
        return reply.code(422).send({
          error: "unprocessable_entity",
          code: "reversal_failed",
          message: error.message,
        });
      }
    },
  );
};
