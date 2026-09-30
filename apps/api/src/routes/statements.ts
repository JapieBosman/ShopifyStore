import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { DbClient } from "../../../../packages/database/tenant-context.ts";
import { withTenantContext } from "../../../../packages/database/tenant-context.ts";
import { getStatementStorage, LocalStorageProvider } from "../../../../packages/domain/src/storage.ts";
import { requireAuth, requirePermission, type AuthResolverOptions } from "../auth/context.ts";
import { computeRequestHash, type IdempotencyStore } from "../idempotency.ts";
import { executeStatementRun } from "../../../worker/src/statements.ts";

export interface StatementsRouteOptions extends AuthResolverOptions {
  db: DbClient;
  idempotencyStore: IdempotencyStore;
}

export const statementsRoutes: FastifyPluginAsync<StatementsRouteOptions> = async (fastify, opts) => {
  const { db, idempotencyStore } = opts;

  if (!db) {
    throw new Error("Database client is required for statement routes");
  }

  const authHook = requireAuth(opts);

  fastify.post(
    "/v1/statements/run",
    { preHandler: [authHook, requirePermission("run_statements")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
        return reply.code(400).send({
          error: "bad_request",
          code: "missing_idempotency_key",
          message: "Idempotency-Key header is required to build a statement run",
        });
      }

      const body = (request.body || {}) as {
        debtorAccountId?: string;
        periodFrom?: string;
        periodTo?: string;
      };
      if (
        !body.debtorAccountId ||
        !isCalendarDate(body.periodFrom) ||
        !isCalendarDate(body.periodTo) ||
        body.periodFrom > body.periodTo
      ) {
        return reply.code(400).send({
          error: "bad_request",
          code: "invalid_statement_period",
          message: "debtorAccountId and an ordered YYYY-MM-DD statement period are required",
        });
      }

      const tenantId = request.authContext!.tenantId;
      const requestHash = computeRequestHash(body);
      const claim = await idempotencyStore.claim(tenantId, idempotencyKey.trim(), requestHash);
      if (claim.state === "conflict") {
        return reply.code(409).send({
          error: "conflict",
          code: "idempotency_conflict",
          message: claim.message,
        });
      }
      if (claim.state === "in_flight") {
        return reply.code(409).send({
          error: "conflict",
          code: "statement_run_in_progress",
          message: "A statement run using this Idempotency-Key is in progress",
        });
      }
      if (claim.state === "cached") {
        return reply
          .code(claim.record.statusCode)
          .header("idempotent-replayed", "true")
          .send(claim.record.responseBody);
      }

      try {
        const result = await withTenantContext(db, tenantId, async (tx) => {
          await idempotencyStore.verifyAndLockLease(tenantId, idempotencyKey.trim(), tx);
          const account = await tx.query<{ id: string }>(
            "SELECT id FROM debtor_account WHERE tenant_id = $1 AND id = $2 AND status != 'closed'",
            [tenantId, body.debtorAccountId],
          );
          if (account.rows.length === 0) {
            throw new Error("statement_account_not_found");
          }

          const generationResult = await tx.query<{ generation: number }>(
            `SELECT COALESCE(MAX(generation), 0) + 1 AS generation
             FROM statement_run
             WHERE tenant_id = $1 AND period_from = $2 AND period_to = $3`,
            [tenantId, body.periodFrom, body.periodTo],
          );
          const run = await executeStatementRun(tx, tenantId, {
            periodFrom: body.periodFrom!,
            periodTo: body.periodTo!,
            generation: generationResult.rows[0]!.generation,
            actorId: request.authContext!.actorId,
          });
          const statementResult = await tx.query<{ id: string }>(
            `SELECT id FROM statement
             WHERE tenant_id = $1 AND statement_run_id = $2 AND debtor_account_id = $3`,
            [tenantId, run.statementRunId, body.debtorAccountId],
          );
          if (statementResult.rows.length === 0) {
            throw new Error("statement_build_failed");
          }

          const response = {
            ...run,
            statementId: statementResult.rows[0]!.id,
            debtorAccountId: body.debtorAccountId,
          };
          await idempotencyStore.complete(tenantId, idempotencyKey.trim(), 201, response, tx);
          return response;
        });
        return reply.code(201).send(result);
      } catch (error) {
        await idempotencyStore.release(tenantId, idempotencyKey.trim());
        const message = (error as Error).message;
        if (message === "statement_account_not_found") {
          return reply.code(404).send({
            error: "not_found",
            code: "statement_account_not_found",
            message: "An active or held account with that ID was not found",
          });
        }
        return reply.code(500).send({
          error: "internal_error",
          code: "statement_build_failed",
          message: "Statement run could not be completed",
        });
      }
    },
  );

  // ==========================================
  // GET /v1/statements/:id
  // Retrieve statement metadata and signed download URL
  // Role: view_accounts (cashier, bookkeeper, manager, owner)
  // ==========================================
  fastify.get(
    "/v1/statements/:id",
    { preHandler: [authHook, requirePermission("view_accounts")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.authContext!.tenantId;
      const { id } = request.params as { id: string };

      const result = await withTenantContext(db, tenantId, async (tx) => {
        const stmtRes = await tx.query<{
          id: string;
          statement_run_id: string;
          debtor_account_id: string;
          opening_balance: string;
          debits: string;
          credits: string;
          closing_balance: string;
          currency: string;
          ledger_version: number;
          pdf_object_key: string;
          pdf_sha256: string;
          status: string;
          created_at: string;
          account_number: string;
          legal_name: string;
        }>(
          `SELECT s.*, d.account_number, d.legal_name
           FROM statement s
           JOIN debtor_account d ON d.id = s.debtor_account_id AND d.tenant_id = s.tenant_id
           WHERE s.tenant_id = $1 AND s.id = $2`,
          [tenantId, id],
        );

        if (stmtRes.rows.length === 0) {
          return null;
        }

        const stmt = stmtRes.rows[0]!;
        const storage = getStatementStorage();
        const signedDownloadUrl = await storage.getSignedDownloadUrl(stmt.pdf_object_key, 3600, tenantId);

        return {
          id: stmt.id,
          statementRunId: stmt.statement_run_id,
          debtorAccountId: stmt.debtor_account_id,
          accountNumber: stmt.account_number,
          legalName: stmt.legal_name,
          openingBalance: stmt.opening_balance,
          debits: stmt.debits,
          credits: stmt.credits,
          closingBalance: stmt.closing_balance,
          currency: stmt.currency,
          ledgerVersion: stmt.ledger_version,
          status: stmt.status,
          pdfObjectKey: stmt.pdf_object_key,
          pdfSha256: stmt.pdf_sha256,
          downloadUrl: signedDownloadUrl,
          createdAt: stmt.created_at,
        };
      });

      if (!result) {
        return reply.code(404).send({
          error: "not_found",
          code: "statement_not_found",
          message: `Statement ${id} was not found`,
        });
      }

      return reply.code(200).send(result);
    },
  );

  // ==========================================
  // GET /v1/statements/:id/download
  // Direct PDF download with session token auth
  // Role: view_accounts (cashier, bookkeeper, manager, owner)
  // ==========================================
  fastify.get(
    "/v1/statements/:id/download",
    { preHandler: [authHook, requirePermission("view_accounts")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.authContext!.tenantId;
      const { id } = request.params as { id: string };

      const stmtRes = await withTenantContext(db, tenantId, async (tx) => {
        return await tx.query<{
          id: string;
          pdf_object_key: string;
          pdf_sha256: string;
          account_number: string;
        }>(
          `SELECT s.id, s.pdf_object_key, s.pdf_sha256, d.account_number
           FROM statement s
           JOIN debtor_account d ON d.id = s.debtor_account_id AND d.tenant_id = s.tenant_id
           WHERE s.tenant_id = $1 AND s.id = $2`,
          [tenantId, id],
        );
      });

      if (stmtRes.rows.length === 0) {
        return reply.code(404).send({
          error: "not_found",
          code: "statement_not_found",
          message: `Statement ${id} was not found`,
        });
      }

      const stmt = stmtRes.rows[0]!;
      const storage = getStatementStorage();

      try {
        const pdfBuffer = await storage.get(stmt.pdf_object_key);
        reply
          .header("Content-Type", "application/pdf")
          .header("Content-Disposition", `inline; filename="statement-${stmt.account_number}-${stmt.id}.pdf"`)
          .header("Content-Length", String(pdfBuffer.length))
          .header("ETag", `"${stmt.pdf_sha256}"`)
          .send(pdfBuffer);
      } catch (err) {
        return reply.code(404).send({
          error: "not_found",
          code: "statement_artifact_missing",
          message: (err as Error).message,
        });
      }
    },
  );

  // ==========================================
  // GET /v1/statements/download
  // Public signed URL handler (for pre-signed links)
  // ==========================================
  fastify.get("/v1/statements/download", async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as {
      key?: string;
      expires?: string;
      signature?: string;
      tenant?: string;
    };

    if (!query.key || !query.expires || !query.signature) {
      return reply.code(400).send({
        error: "bad_request",
        code: "missing_signature_parameters",
        message: "key, expires, and signature query parameters are required",
      });
    }

    if (query.key.includes("..")) {
      return reply.code(400).send({
        error: "bad_request",
        code: "invalid_key",
        message: "Invalid statement object key",
      });
    }

    // Verify tenant path isolation: if tenant is provided, key must be within statements/{tenant}/
    if (query.tenant) {
      const normalizedKey = query.key.replace(/\\/g, "/");
      const expectedPrefix = `statements/${query.tenant}/`;
      if (!normalizedKey.startsWith(expectedPrefix)) {
        return reply.code(403).send({
          error: "forbidden",
          code: "tenant_path_mismatch",
          message: "Access denied: statement key does not belong to specified tenant",
        });
      }
    }

    const storage = getStatementStorage();
    if (storage instanceof LocalStorageProvider) {
      const isValid = storage.verifyDownloadSignature(
        query.key,
        Number(query.expires),
        query.signature,
        query.tenant,
      );
      if (!isValid) {
        return reply.code(403).send({
          error: "forbidden",
          code: "invalid_signature",
          message: "Signed download URL is invalid or has expired",
        });
      }

      try {
        const pdfBuffer = await storage.get(query.key);
        return reply
          .header("Content-Type", "application/pdf")
          .header("Content-Disposition", 'inline; filename="statement.pdf"')
          .header("Content-Length", String(pdfBuffer.length))
          .send(pdfBuffer);
      } catch (err) {
        return reply.code(404).send({
          error: "not_found",
          code: "statement_artifact_missing",
          message: (err as Error).message,
        });
      }
    }

    // For S3 / GCS, redirect to cloud provider pre-signed URL
    const signedUrl = await storage.getSignedDownloadUrl(query.key, 3600, query.tenant);
    return reply.redirect(signedUrl);
  });
};

function isCalendarDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
