import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { DbClient } from "../../../../packages/database/tenant-context.ts";
import { withTenantContext } from "../../../../packages/database/tenant-context.ts";
import { validateCurrency, formatMoney, parseMoney } from "../../../../packages/domain/src/money.ts";
import { getDebtorBalanceSummary } from "../../../../packages/domain/src/allocation.ts";
import { getLatestAgingSnapshot } from "../../../../packages/domain/src/aging.ts";
import {
  getDebtorCreditExposure,
  createCreditReservation,
  recordSupervisorOverride,
  confirmReservationSubmission,
} from "../../../../packages/domain/src/credit.ts";
import { requireAuth, requirePermission, type AuthResolverOptions } from "../auth/context.ts";
import { computeRequestHash, type IdempotencyStore } from "../idempotency.ts";

export interface AccountsRouteOptions extends AuthResolverOptions {
  idempotencyStore: IdempotencyStore;
}

export const accountsRoutes: FastifyPluginAsync<AccountsRouteOptions> = async (fastify, opts) => {
  const { db, idempotencyStore } = opts;

  if (!db) {
    throw new Error("Database client is required for accounts routes");
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
        message: "A mutation with this Idempotency-Key is currently in progress",
      });
      return null;
    }

    if (claimRes.state === "cached") {
      // Replay cached response
      reply.code(claimRes.record.statusCode).header("idempotent-replayed", "true").send(claimRes.record.responseBody);
      return null;
    }

    return { idempotencyKey, requestHash };
  }

  // ==========================================
  // GET /v1/accounts
  // List debtor accounts with cursor pagination
  // Role: view_accounts (cashier or above)
  // ==========================================
  fastify.get(
    "/v1/accounts",
    { preHandler: [authHook, requirePermission("view_accounts")] },
    async (request, reply) => {
      const tenantId = request.authContext!.tenantId;
      const query = request.query as {
        limit?: string;
        cursor?: string;
        search?: string;
        status?: string;
      };

      const limit = Math.min(Math.max(Number(query.limit ?? "50"), 1), 100);
      const search = query.search?.trim();
      const status = query.status?.trim();
      const cursor = query.cursor?.trim();

      const params: unknown[] = [tenantId];
      let sql = `
        SELECT id, account_number, legal_name, trade_name, currency, credit_limit,
               status, hold_reason, require_po, require_job_reference, aging_basis,
               policy_version, ledger_version, created_at
        FROM debtor_account
        WHERE tenant_id = $1
      `;

      if (status) {
        params.push(status);
        sql += ` AND status = $${params.length}`;
      }

      if (search) {
        params.push(`%${search}%`);
        sql += ` AND (account_number ILIKE $${params.length} OR legal_name ILIKE $${params.length})`;
      }

      if (cursor) {
        params.push(cursor);
        sql += ` AND account_number > $${params.length}`;
      }

      params.push(limit + 1);
      sql += ` ORDER BY account_number ASC LIMIT $${params.length}`;

      const res = await withTenantContext(db, tenantId, (tx) => tx.query<Record<string, unknown>>(sql, params));

      const hasMore = res.rows.length > limit;
      const items = hasMore ? res.rows.slice(0, limit) : res.rows;
      const nextCursor = hasMore && items.length > 0 ? (items[items.length - 1]!.account_number as string) : null;

      return reply.code(200).send({
        items,
        nextCursor,
        hasMore,
      });
    },
  );

  // ==========================================
  // GET /v1/accounts/:id
  // Account details, live balance, credit exposure, and 8 aging buckets
  // Role: view_accounts (cashier or above)
  // ==========================================
  fastify.get(
    "/v1/accounts/:id",
    { preHandler: [authHook, requirePermission("view_accounts")] },
    async (request, reply) => {
      const tenantId = request.authContext!.tenantId;
      const { id } = request.params as { id: string };

      const debtorRes = await withTenantContext(db, tenantId, (tx) =>
        tx.query<Record<string, unknown>>(
          `SELECT id, account_number, legal_name, trade_name, currency, credit_limit,
                  status, hold_reason, require_po, require_job_reference, aging_basis,
                  policy_version, ledger_version, created_at
           FROM debtor_account
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id],
        ),
      );

      if (debtorRes.rows.length === 0) {
        return reply.code(404).send({
          error: "not_found",
          code: "account_not_found",
          message: `Debtor account '${id}' not found`,
        });
      }

      const debtor = debtorRes.rows[0]!;

      // Live balance summary
      const balance = await getDebtorBalanceSummary(db, tenantId, id);

      // Live credit exposure
      const credit = await getDebtorCreditExposure(db, tenantId, id);

      // Latest aging snapshot
      const snapshot = await getLatestAgingSnapshot(db, tenantId, id);
      const isFresh = snapshot ? Number(snapshot.ledgerVersion) === Number(debtor.ledger_version) : false;

      // Allocations for this account
      const allocRes = await withTenantContext(db, tenantId, (tx) =>
        tx.query<{
          id: string;
          debtor_account_id: string;
          debit_document_id: string;
          debit_document_number: string;
          credit_document_id: string;
          credit_document_number: string;
          amount: string;
          created_at: string;
          reversed: boolean;
        }>(
          `SELECT a.id, a.debtor_account_id, a.debit_document_id, d_deb.document_number AS debit_document_number,
                  a.credit_document_id, d_cred.document_number AS credit_document_number,
                  a.amount, a.created_at,
                  (EXISTS (SELECT 1 FROM allocation_reversal r WHERE r.tenant_id = a.tenant_id AND r.allocation_id = a.id)) AS reversed
           FROM allocation a
           JOIN document d_deb ON d_deb.id = a.debit_document_id AND d_deb.tenant_id = a.tenant_id
           JOIN document d_cred ON d_cred.id = a.credit_document_id AND d_cred.tenant_id = a.tenant_id
           WHERE a.tenant_id = $1 AND a.debtor_account_id = $2
           ORDER BY a.created_at DESC`,
          [tenantId, id],
        ),
      );

      return reply.code(200).send({
        account: debtor,
        balance,
        credit,
        aging: {
          snapshot,
          isFresh,
        },
        allocations: allocRes.rows,
      });
    },
  );

  // ==========================================
  // POST /v1/accounts
  // Create a new debtor account
  // Role: manage_accounts (bookkeeper, manager, owner)
  // ==========================================
  fastify.post(
    "/v1/accounts",
    { preHandler: [authHook, requirePermission("manage_accounts")] },
    async (request, reply) => {
      const idem = await checkIdempotency(request, reply);
      if (!idem) return;

      const tenantId = request.authContext!.tenantId;
      const body = request.body as {
        accountNumber?: string;
        legalName?: string;
        tradeName?: string;
        currency?: string;
        paymentTermId?: string;
        creditLimit?: string;
        status?: "active" | "hold" | "stopped" | "closed";
        agingBasis?: "due_date" | "calendar_period";
        requirePo?: boolean;
        requireJobReference?: boolean;
      };

      if (!body.accountNumber || !body.legalName || !body.currency || !body.creditLimit) {
        return reply.code(400).send({
          error: "bad_request",
          code: "missing_required_fields",
          message: "accountNumber, legalName, currency, and creditLimit are required",
        });
      }

      try {
        validateCurrency(body.currency);
      } catch (err) {
        return reply.code(422).send({
          error: "unprocessable_entity",
          code: "invalid_currency",
          message: (err as Error).message,
        });
      }

      let parsedLimit: bigint;
      try {
        parsedLimit = parseMoney(body.creditLimit);
        if (parsedLimit < 0n) {
          throw new RangeError("Credit limit must be non-negative");
        }
      } catch (err) {
        return reply.code(400).send({
          error: "bad_request",
          code: "invalid_credit_limit",
          message: (err as Error).message,
        });
      }

      const res = await withTenantContext(db, tenantId, async (tx) => {
        // Resolve payment term: use specified ID or look up/create tenant default
        let resolvedTermId = body.paymentTermId;
        if (!resolvedTermId) {
          const defaultTermRes = await tx.query<{ id: string }>(
            "SELECT id FROM payment_term WHERE tenant_id = $1 ORDER BY code ASC LIMIT 1",
            [tenantId],
          );
          if (defaultTermRes.rows.length === 0) {
            const createdTermRes = await tx.query<{ id: string }>(
              "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
              [tenantId],
            );
            resolvedTermId = createdTermRes.rows[0]!.id;
          } else {
            resolvedTermId = defaultTermRes.rows[0]!.id;
          }
        } else {
          // Validate payment term belongs to tenant
          const termRes = await tx.query<{ id: string }>(
            "SELECT id FROM payment_term WHERE tenant_id = $1 AND id = $2",
            [tenantId, resolvedTermId],
          );
          if (termRes.rows.length === 0) {
            return { error: "payment_term_not_found" };
          }
        }

        // Check uniqueness of account number
        const existingRes = await tx.query<{ id: string }>(
          "SELECT id FROM debtor_account WHERE tenant_id = $1 AND account_number = $2",
          [tenantId, body.accountNumber],
        );
        if (existingRes.rows.length > 0) {
          return { error: "duplicate_account_number" };
        }

        const uppercaseCurrency = body.currency!.toUpperCase();
        const insertRes = await tx.query<Record<string, unknown>>(
          `INSERT INTO debtor_account (
            tenant_id, account_number, legal_name, trade_name, currency,
            payment_term_id, credit_limit, status, aging_basis,
            require_po, require_job_reference
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *`,
          [
            tenantId,
            body.accountNumber,
            body.legalName,
            body.tradeName ?? null,
            uppercaseCurrency,
            resolvedTermId,
            formatMoney(parsedLimit),
            body.status ?? "active",
            body.agingBasis ?? "due_date",
            body.requirePo ?? false,
            body.requireJobReference ?? false,
          ],
        );

        return { account: insertRes.rows[0]! };
      });

      if ("error" in res) {
        if (res.error === "duplicate_account_number") {
          return reply.code(409).send({
            error: "conflict",
            code: "duplicate_account_number",
            message: `Debtor account number '${body.accountNumber}' already exists`,
          });
        }
        return reply.code(422).send({
          error: "unprocessable_entity",
          code: res.error,
          message: "Specified payment term not found",
        });
      }

      const responseBody = { account: res.account };
      await idempotencyStore.save({
        tenantId,
        idempotencyKey: idem.idempotencyKey,
        requestHash: idem.requestHash,
        statusCode: 201,
        responseBody,
        createdAt: new Date(),
      });

      return reply.code(201).send(responseBody);
    },
  );

  // ==========================================
  // PATCH /v1/accounts/:id/policy
  // Modify credit limit, status, hold reason, or terms
  // Role: manage_policy (manager, owner)
  // ==========================================
  fastify.patch(
    "/v1/accounts/:id/policy",
    { preHandler: [authHook, requirePermission("manage_policy")] },
    async (request, reply) => {
      const idem = await checkIdempotency(request, reply);
      if (!idem) return;

      const tenantId = request.authContext!.tenantId;
      const { id } = request.params as { id: string };
      const body = request.body as {
        reason?: string;
        expectedPolicyVersion?: number;
        creditLimit?: string;
        status?: "active" | "hold" | "stopped" | "closed";
        holdReason?: string | null;
        agingBasis?: "due_date" | "calendar_period";
        requirePo?: boolean;
        requireJobReference?: boolean;
      };

      if (!body.reason || typeof body.reason !== "string" || !body.reason.trim()) {
        return reply.code(400).send({
          error: "bad_request",
          code: "missing_reason",
          message: "A non-empty 'reason' is required for policy modifications",
        });
      }

      const result = await withTenantContext(db, tenantId, async (tx) => {
        const debtorRes = await tx.query<{
          id: string;
          status: string;
          credit_limit: string;
          policy_version: number;
        }>(
          `SELECT id, status, credit_limit, policy_version
           FROM debtor_account
           WHERE tenant_id = $1 AND id = $2
           FOR UPDATE`,
          [tenantId, id],
        );

        if (debtorRes.rows.length === 0) {
          return { error: "not_found" };
        }

        const debtor = debtorRes.rows[0]!;

        if (body.expectedPolicyVersion !== undefined && debtor.policy_version !== body.expectedPolicyVersion) {
          return { error: "version_conflict", currentVersion: debtor.policy_version };
        }

        const newCreditLimit = body.creditLimit ? formatMoney(parseMoney(body.creditLimit)) : debtor.credit_limit;
        const newStatus = body.status ?? debtor.status;
        const newPolicyVersion = debtor.policy_version + 1;

        const updateRes = await tx.query<Record<string, unknown>>(
          `UPDATE debtor_account
           SET credit_limit = $1,
               status = $2,
               hold_reason = COALESCE($3, hold_reason),
               aging_basis = COALESCE($4, aging_basis),
               require_po = COALESCE($5, require_po),
               require_job_reference = COALESCE($6, require_job_reference),
               policy_version = $7
           WHERE tenant_id = $8 AND id = $9
           RETURNING *`,
          [
            newCreditLimit,
            newStatus,
            body.holdReason !== undefined ? body.holdReason : null,
            body.agingBasis ?? null,
            body.requirePo ?? null,
            body.requireJobReference ?? null,
            newPolicyVersion,
            tenantId,
            id,
          ],
        );

        // Invalidate unused unapproved reservations if status is restricted or limit decreased
        if (newStatus !== "active" || parseMoney(newCreditLimit) < parseMoney(debtor.credit_limit)) {
          await tx.query(
            `UPDATE credit_reservation
             SET status = 'cancelled'
             WHERE tenant_id = $1 AND debtor_account_id = $2 AND status = 'reserved' AND approved = false`,
            [tenantId, id],
          );
        }

        // Record audit event
        await tx.query(
          `INSERT INTO audit_event (
            tenant_id, actor_id, action, entity_type, entity_id, correlation_id, details
          ) VALUES ($1, $2, 'account/policy_updated', 'debtor_account', $3, gen_random_uuid(), $4)`,
          [
            tenantId,
            request.authContext!.actorId,
            id,
            JSON.stringify({
              reason: body.reason,
              previousPolicyVersion: debtor.policy_version,
              newPolicyVersion,
              previousStatus: debtor.status,
              newStatus,
              previousCreditLimit: debtor.credit_limit,
              newCreditLimit,
            }),
          ],
        );

        return { account: updateRes.rows[0]! };
      });

      if ("error" in result) {
        if (result.error === "not_found") {
          return reply.code(404).send({
            error: "not_found",
            code: "account_not_found",
            message: `Debtor account '${id}' not found`,
          });
        }
        if (result.error === "version_conflict") {
          return reply.code(409).send({
            error: "conflict",
            code: "policy_version_conflict",
            message: `Policy version conflict: expected ${body.expectedPolicyVersion}, currently ${result.currentVersion}`,
          });
        }
      }

      const responseBody = { account: result.account };
      await idempotencyStore.save({
        tenantId,
        idempotencyKey: idem.idempotencyKey,
        requestHash: idem.requestHash,
        statusCode: 200,
        responseBody,
        createdAt: new Date(),
      });

      return reply.code(200).send(responseBody);
    },
  );

  // ==========================================
  // POST /v1/accounts/:id/credit-reservations
  // Create a credit reservation for an in-flight POS / checkout basket
  // Role: request_account_sale (cashier or above)
  // ==========================================
  fastify.post(
    "/v1/accounts/:id/credit-reservations",
    { preHandler: [authHook, requirePermission("request_account_sale")] },
    async (request, reply) => {
      const idem = await checkIdempotency(request, reply);
      if (!idem) return;

      const tenantId = request.authContext!.tenantId;
      const { id } = request.params as { id: string };
      const body = request.body as {
        amount?: string;
        currency?: string;
        cartDigest?: string;
        locationId?: string;
        confirmedDeposit?: string;
        ttlSeconds?: number;
        shopifyDraftGid?: string;
      };

      if (!body.amount || !body.currency || !body.cartDigest || !body.locationId) {
        return reply.code(400).send({
          error: "bad_request",
          code: "missing_required_fields",
          message: "amount, currency, cartDigest, and locationId are required",
        });
      }

      try {
        const result = await createCreditReservation(db, tenantId, {
          debtorAccountId: id,
          actorId: request.authContext!.actorId,
          locationId: body.locationId,
          amount: body.amount,
          currency: body.currency,
          cartDigest: body.cartDigest,
          idempotencyKey: idem.idempotencyKey,
          confirmedDeposit: body.confirmedDeposit,
          ttlSeconds: body.ttlSeconds,
        });

        if (!result.approved) {
          return reply.code(422).send({
            error: "unprocessable_entity",
            code: "credit_declined",
            message:
              result.status === "requires_override"
                ? `Credit limit exceeded: shortfall of ${result.shortfall}. Supervisor override required.`
                : "Credit policy blocked for this debtor account.",
            reservationId: result.reservationId,
            status: result.status,
            shortfall: result.shortfall,
            exposureAfter: result.exposureAfter,
          });
        }

        const responseBody = {
          reservationId: result.reservationId,
          status: result.status,
          amount: result.amount,
          currency: result.currency,
          expiresAt: result.expiresAt,
          isDuplicate: result.isDuplicate,
        };

        await idempotencyStore.save({
          tenantId,
          idempotencyKey: idem.idempotencyKey,
          requestHash: idem.requestHash,
          statusCode: 201,
          responseBody,
          createdAt: new Date(),
        });

        return reply.code(201).send(responseBody);
      } catch (err: unknown) {
        const error = err as Error;
        if (error.message.includes("Idempotency conflict")) {
          return reply.code(409).send({
            error: "conflict",
            code: "idempotency_conflict",
            message: error.message,
          });
        }
        if (error.message.includes("Currency mismatch")) {
          return reply.code(422).send({
            error: "unprocessable_entity",
            code: "currency_mismatch",
            message: error.message,
          });
        }
        if (error.message.includes("not found")) {
          return reply.code(404).send({
            error: "not_found",
            code: "account_not_found",
            message: error.message,
          });
        }
        // Policy rejection (credit limit exceeded, account on hold, etc.)
        return reply.code(422).send({
          error: "unprocessable_entity",
          code: "credit_declined",
          message: error.message,
        });
      }
    },
  );

  // ==========================================
  // POST /v1/credit-reservations/:id/override
  // Supervisor override for a declined or referred reservation
  // Role: approve_override (manager, owner)
  // ==========================================
  fastify.post(
    "/v1/credit-reservations/:id/override",
    { preHandler: [authHook, requirePermission("approve_override")] },
    async (request, reply) => {
      const idem = await checkIdempotency(request, reply);
      if (!idem) return;

      const tenantId = request.authContext!.tenantId;
      const { id } = request.params as { id: string };
      const body = request.body as {
        reason?: string;
        approvedAmount?: string;
        cartDigest?: string;
      };

      if (!body.reason || !body.approvedAmount || !body.cartDigest) {
        return reply.code(400).send({
          error: "bad_request",
          code: "missing_required_fields",
          message: "reason, approvedAmount, and cartDigest are required",
        });
      }

      try {
        const result = await recordSupervisorOverride(db, tenantId, {
          creditReservationId: id,
          supervisorActorId: request.authContext!.actorId,
          reason: body.reason,
          approvedAmount: body.approvedAmount,
          cartDigest: body.cartDigest,
        });

        const responseBody = {
          overrideId: result.overrideId,
          creditReservationId: id,
          approved: true,
          approvedAmount: formatMoney(parseMoney(body.approvedAmount)),
        };

        await idempotencyStore.save({
          tenantId,
          idempotencyKey: idem.idempotencyKey,
          requestHash: idem.requestHash,
          statusCode: 200,
          responseBody,
          createdAt: new Date(),
        });

        return reply.code(200).send(responseBody);
      } catch (err: unknown) {
        const error = err as Error;
        if (error.message.includes("not found")) {
          return reply.code(404).send({
            error: "not_found",
            code: "reservation_not_found",
            message: error.message,
          });
        }
        return reply.code(422).send({
          error: "unprocessable_entity",
          code: "override_rejected",
          message: error.message,
        });
      }
    },
  );

  // ==========================================
  // POST /v1/credit-reservations/:id/confirm
  // Confirm submission of reservation (transition to 'submitting')
  // Role: request_account_sale (cashier or above)
  // ==========================================
  fastify.post(
    "/v1/credit-reservations/:id/confirm",
    { preHandler: [authHook, requirePermission("request_account_sale")] },
    async (request, reply) => {
      const idem = await checkIdempotency(request, reply);
      if (!idem) return;

      const tenantId = request.authContext!.tenantId;
      const { id } = request.params as { id: string };
      const body = (request.body as { cartDigest?: string } | undefined) ?? {};

      try {
        let digest = body.cartDigest;
        if (!digest) {
          const resv = await withTenantContext(db, tenantId, (tx) =>
            tx.query<{ cart_digest: string }>(
              "SELECT cart_digest FROM credit_reservation WHERE tenant_id = $1 AND id = $2",
              [tenantId, id],
            ),
          );
          if (resv.rows.length === 0) {
            return reply.code(404).send({
              error: "not_found",
              code: "reservation_not_found",
              message: `Credit reservation '${id}' not found`,
            });
          }
          digest = resv.rows[0]!.cart_digest;
        }

        await confirmReservationSubmission(db, tenantId, {
          reservationId: id,
          currentCartDigest: digest,
        });

        const responseBody = {
          reservationId: id,
          status: "submitting",
          operationId: id,
        };

        await idempotencyStore.save({
          tenantId,
          idempotencyKey: idem.idempotencyKey,
          requestHash: idem.requestHash,
          statusCode: 200,
          responseBody,
          createdAt: new Date(),
        });

        return reply.code(200).send(responseBody);
      } catch (err: unknown) {
        const error = err as Error;
        if (error.message.includes("not found")) {
          return reply.code(404).send({
            error: "not_found",
            code: "reservation_not_found",
            message: error.message,
          });
        }
        return reply.code(422).send({
          error: "unprocessable_entity",
          code: "confirmation_failed",
          message: error.message,
        });
      }
    },
  );
};
