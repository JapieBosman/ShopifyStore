import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { DbClient } from "../../../../packages/database/tenant-context.ts";
import { withTenantContext } from "../../../../packages/database/tenant-context.ts";
import { validateCurrency, formatMoney, parseMoney } from "../../../../packages/domain/src/money.ts";
import { postJournal } from "../../../../packages/domain/src/posting.ts";
import {
  getDebtorBalanceSummary,
  executeOldestFirstAllocation,
  type OldestFirstAllocationResult,
} from "../../../../packages/domain/src/allocation.ts";
import { requireAuth, requirePermission, type AuthResolverOptions } from "../auth/context.ts";
import { computeRequestHash, type IdempotencyStore } from "../idempotency.ts";

export interface PaymentsRouteOptions extends AuthResolverOptions {
  idempotencyStore: IdempotencyStore;
}

export type PaymentMode = "external_receipt" | "shopify_manual" | "shopify_pos_cash";

export const paymentsRoutes: FastifyPluginAsync<PaymentsRouteOptions> = async (fastify, opts) => {
  const { db, idempotencyStore } = opts;

  if (!db) {
    throw new Error("Database client is required for payments routes");
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
        message: "A payment mutation with this Idempotency-Key is currently in progress",
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
  // POST /v1/payments (and alias POST /v1/receipts)
  // Record evidence-backed payment or manual Shopify receipt
  // Role: post_journal (bookkeeper, manager, owner)
  // ==========================================
  const handlePayment = async (request: FastifyRequest, reply: FastifyReply) => {
    const idem = await checkIdempotency(request, reply);
    if (!idem) return;

    const tenantId = request.authContext!.tenantId;
    const body = request.body as {
      debtorAccountId?: string;
      amount?: string;
      currency?: string;
      paymentMethod?: "bank_transfer" | "cash" | "card" | "shopify_manual_payment" | "check";
      effectiveDate?: string;
      reference?: string;
      paymentMode?: PaymentMode;
      memo?: string;
      autoAllocate?: boolean;
    };

    if (
      !body.debtorAccountId ||
      !body.amount ||
      !body.currency ||
      !body.paymentMethod ||
      !body.effectiveDate ||
      !body.reference ||
      !body.paymentMode
    ) {
      return reply.code(400).send({
        error: "bad_request",
        code: "missing_required_fields",
        message: "debtorAccountId, amount, currency, paymentMethod, effectiveDate, reference, and paymentMode are required",
      });
    }

    const validModes: PaymentMode[] = ["external_receipt", "shopify_manual", "shopify_pos_cash"];
    if (!validModes.includes(body.paymentMode)) {
      return reply.code(400).send({
        error: "bad_request",
        code: "invalid_payment_mode",
        message: `paymentMode must be one of: ${validModes.join(", ")}`,
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

    let parsedAmount: bigint;
    try {
      parsedAmount = parseMoney(body.amount);
      if (parsedAmount <= 0n) {
        throw new RangeError("Payment amount must be greater than zero");
      }
    } catch (err) {
      return reply.code(400).send({
        error: "bad_request",
        code: "invalid_amount",
        message: (err as Error).message,
      });
    }

    const formattedAmount = formatMoney(parsedAmount);

    // Verify debtor account and currency match
    const debtorRes = await withTenantContext(db, tenantId, (tx) =>
      tx.query<{ id: string; currency: string; status: string }>(
        "SELECT id, currency, status FROM debtor_account WHERE tenant_id = $1 AND id = $2",
        [tenantId, body.debtorAccountId],
      ),
    );

    if (debtorRes.rows.length === 0) {
      return reply.code(404).send({
        error: "not_found",
        code: "debtor_not_found",
        message: `Debtor account '${body.debtorAccountId}' not found`,
      });
    }

    const debtor = debtorRes.rows[0]!;
    if (debtor.currency !== body.currency.toUpperCase()) {
      return reply.code(422).send({
        error: "unprocessable_entity",
        code: "currency_mismatch",
        message: `Payment currency (${body.currency.toUpperCase()}) does not match debtor currency (${debtor.currency})`,
      });
    }

    // Lookup standard ledger accounts: 1010 (Bank Account / Cash) and 1200 (Accounts Receivable)
    const ledgerAccounts = await withTenantContext(db, tenantId, (tx) =>
      tx.query<{ id: string; code: string }>(
        "SELECT id, code FROM ledger_account WHERE tenant_id = $1 AND code IN ('1010', '1200')",
        [tenantId],
      ),
    );

    const bankAccount = ledgerAccounts.rows.find((a) => a.code === "1010");
    const arAccount = ledgerAccounts.rows.find((a) => a.code === "1200");

    if (!bankAccount || !arAccount) {
      return reply.code(500).send({
        error: "internal_error",
        code: "missing_ledger_accounts",
        message: "Required ledger clearing accounts (1010, 1200) not configured",
      });
    }

    const docNumber = `REC-${body.reference}`;
    const sourceEventKey = `payment:${body.paymentMode}:${body.reference}`;

    const postingBundle = {
      actorId: request.authContext!.actorId,
      currency: debtor.currency,
      effectiveDate: body.effectiveDate,
      sourceKind: "payment",
      sourceKey: sourceEventKey,
      idempotencyKey: idem.idempotencyKey,
      memo: body.memo ?? `Payment via ${body.paymentMethod} (mode: ${body.paymentMode})`,
      lines: [
        {
          ledgerAccountId: bankAccount.id,
          direction: "debit" as const,
          amount: formattedAmount,
          currency: debtor.currency,
        },
        {
          ledgerAccountId: arAccount.id,
          debtorAccountId: body.debtorAccountId,
          direction: "credit" as const,
          amount: formattedAmount,
          currency: debtor.currency,
        },
      ],
      documents: [
        {
          debtorAccountId: body.debtorAccountId,
          documentNumber: docNumber,
          kind: "payment" as const,
          direction: "credit" as const,
          amount: formattedAmount,
          currency: debtor.currency,
          issuedOn: body.effectiveDate,
          sourceEventKey,
          billingSnapshot: {
            paymentMode: body.paymentMode,
            paymentMethod: body.paymentMethod,
            reference: body.reference,
          },
        },
      ],
    };

    const debtorAccountId = body.debtorAccountId!;
    const effectiveDate = body.effectiveDate!;
    const paymentMode = body.paymentMode!;
    const paymentMethod = body.paymentMethod!;
    const reference = body.reference!;

    let responseBody;
    try {
      responseBody = await withTenantContext(db, tenantId, async (tx) => {
        // 1. Lock idempotency lease inside the transaction
        await idempotencyStore.verifyAndLockLease(tenantId, idem.idempotencyKey, tx);

        // 2. Execute balanced posting inside the transaction
        const postResult = await postJournal(tx, tenantId, postingBundle);
        const documentId = postResult.documentIds[0]!;

        // 3. Execute optional auto-allocation inside the transaction
        let autoAllocationResult: OldestFirstAllocationResult | null = null;
        if (body.autoAllocate && !postResult.isDuplicate) {
          try {
            autoAllocationResult = await executeOldestFirstAllocation(tx, tenantId, {
              actorId: request.authContext!.actorId,
              debtorAccountId,
              creditDocumentId: documentId,
              effectiveDate,
              idempotencyKeyPrefix: `${idem.idempotencyKey}-autoalloc`,
            });
          } catch {
            // If auto-allocation encounters an issue, the payment itself remains intact as unapplied credit
          }
        }

        // 4. Calculate updated debtor balance summary
        const balance = await getDebtorBalanceSummary(tx, tenantId, debtorAccountId);

        const resp = {
          journalId: postResult.journalId,
          documentId,
          paymentDocumentId: documentId,
          paymentMode,
          paymentMethod,
          amount: postResult.totalAmount,
          currency: postResult.currency,
          effectiveDate,
          reference,
          isDuplicate: postResult.isDuplicate,
          unappliedCredit: balance.unappliedCredit,
          netBalance: balance.netBalance,
          allocations: autoAllocationResult ? autoAllocationResult.allocations : [],
        };

        // 5. Complete idempotency record in the EXACT same transaction
        await idempotencyStore.complete(tenantId, idem.idempotencyKey, 201, resp, tx);

        return resp;
      });
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message === "idempotency_lease_lost") {
        return reply.code(409).send({
          error: "conflict",
          code: "concurrent_mutation_in_progress",
          message: "A mutation with this Idempotency-Key is currently in progress",
        });
      }
      return reply.code(422).send({
        error: "unprocessable_entity",
        code: "posting_failed",
        message: error.message,
      });
    }

    return reply.code(201).send(responseBody);
  };

  fastify.post(
    "/v1/payments",
    { preHandler: [authHook, requirePermission("post_journal")] },
    handlePayment,
  );

  fastify.post(
    "/v1/receipts",
    { preHandler: [authHook, requirePermission("post_journal")] },
    handlePayment,
  );
};
