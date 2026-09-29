import { createHash } from "node:crypto";
import type { DbClient } from "../../database/tenant-context.ts";
import { withTenantContext } from "../../database/tenant-context.ts";
import { formatMoney, parseMoney, requireNonnegative, requirePositive } from "./money.ts";
import { postJournal, type PostingBundle, type PostingResult } from "./posting.ts";

export type AccountStatus = "active" | "hold" | "stopped" | "closed";

export interface CreditDecisionInput {
  status: AccountStatus;
  limit: string;
  netBalance: string;
  pendingReservations: string;
  requestedCredit: string;
  confirmedDeposit: string;
}

export type CreditDecision =
  | { kind: "approved"; availableAfter: string; exposureAfter: string }
  | { kind: "requires_override"; shortfall: string; exposureAfter: string }
  | { kind: "blocked"; reason: "hold" | "stopped" | "closed" };

/**
 * Evaluates credit policy in-memory given status, limit, net balance, reservations, and requested credit.
 */
export function evaluateCredit(input: CreditDecisionInput): CreditDecision {
  if (input.status !== "active") {
    return { kind: "blocked", reason: input.status };
  }

  const limit = requireNonnegative(input.limit, "Credit limit");
  const reservations = requireNonnegative(input.pendingReservations, "Reservations");
  const requested = requirePositive(input.requestedCredit, "Requested credit");
  const deposit = requireNonnegative(input.confirmedDeposit, "Confirmed deposit");
  if (deposit > requested) {
    throw new RangeError("Deposit exceeds sale amount");
  }

  const exposureAfter =
    parseMoney(input.netBalance) + reservations + requested - deposit;
  const availableAfter = limit - exposureAfter;
  if (availableAfter < 0n) {
    return {
      kind: "requires_override",
      shortfall: formatMoney(-availableAfter),
      exposureAfter: formatMoney(exposureAfter),
    };
  }
  return {
    kind: "approved",
    availableAfter: formatMoney(availableAfter),
    exposureAfter: formatMoney(exposureAfter),
  };
}

/**
 * Computes a deterministic SHA-256 cart digest from lines or payload.
 */
export function computeCartDigest(payload: unknown): string {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  return createHash("sha256").update(serialized).digest("hex");
}

// ---------------------------------------------------------------------------
// Database Transactional Execution
// ---------------------------------------------------------------------------

export interface CreditExposureSummary {
  debtorAccountId: string;
  currency: string;
  accountStatus: AccountStatus;
  creditLimit: string;
  postedNetBalance: string;
  pendingReservations: string;
  totalExposure: string;
  availableCredit: string;
  activeReservationsCount: number;
}

export interface CreateReservationCommand {
  actorId: string;
  debtorAccountId: string;
  locationId: string;
  amount: string;
  currency: string;
  cartDigest: string;
  idempotencyKey: string;
  confirmedDeposit?: string;
  ttlSeconds?: number;
}

export interface ReservationResult {
  reservationId: string;
  debtorAccountId: string;
  amount: string;
  currency: string;
  cartDigest: string;
  status: "reserved" | "requires_override" | "blocked";
  approved: boolean;
  shortfall?: string;
  availableAfter?: string;
  exposureAfter: string;
  expiresAt: string;
  isDuplicate: boolean;
}

export interface SupervisorOverrideCommand {
  supervisorActorId: string;
  creditReservationId: string;
  reason: string;
  approvedAmount: string;
  cartDigest: string;
  ttlSeconds?: number;
}

export interface SupervisorOverrideResult {
  overrideId: string;
  creditReservationId: string;
  supervisorActorId: string;
  approvedAmount: string;
  expiresAt: string;
}

export interface ConfirmReservationCommand {
  reservationId: string;
  currentCartDigest: string;
}

export interface ConsumeReservationCommand {
  reservationId: string;
  currentCartDigest: string;
  postingBundle: PostingBundle;
}

export interface ConsumeReservationResult {
  reservationId: string;
  postingResult: PostingResult;
}

/**
 * Queries live credit exposure for a debtor account, locking nothing (read-only snapshot).
 */
export async function getDebtorCreditExposure(
  db: DbClient,
  tenantId: string,
  debtorAccountId: string,
): Promise<CreditExposureSummary> {
  return withTenantContext(db, tenantId, async (tx) => {
    // Debtor metadata
    const debtorRes = await tx.query<{
      currency: string;
      credit_limit: string | number;
      status: AccountStatus;
    }>(
      "SELECT currency, credit_limit, status FROM debtor_account WHERE tenant_id = $1 AND id = $2",
      [tenantId, debtorAccountId],
    );
    if (debtorRes.rows.length === 0) {
      throw new Error(`Debtor account ${debtorAccountId} not found`);
    }
    const debtor = debtorRes.rows[0]!;

    // Posted net balance = posted debits - posted credits on documents
    const docBalRes = await tx.query<{
      debits: string | number;
      credits: string | number;
    }>(
      `SELECT 
         COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0) AS debits,
         COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS credits
       FROM document
       WHERE tenant_id = $1 AND debtor_account_id = $2`,
      [tenantId, debtorAccountId],
    );
    const postedDebits = parseMoney(String(docBalRes.rows[0]?.debits ?? 0));
    const postedCredits = parseMoney(String(docBalRes.rows[0]?.credits ?? 0));
    const postedNetUnits = postedDebits - postedCredits;

    // Active reservations = sum of amount where status IN ('reserved', 'submitting', 'uncertain')
    // and (status <> 'reserved' OR expires_at > now())
    const resvBalRes = await tx.query<{
      pending: string | number;
      count: string | number;
    }>(
      `SELECT 
         COALESCE(SUM(amount), 0) AS pending,
         COUNT(*) AS count
       FROM credit_reservation
       WHERE tenant_id = $1 
         AND debtor_account_id = $2
         AND status IN ('reserved', 'submitting', 'uncertain')
         AND (status <> 'reserved' OR expires_at > now())
         AND approved = true`,
      [tenantId, debtorAccountId],
    );

    const pendingUnits = parseMoney(String(resvBalRes.rows[0]?.pending ?? 0));
    const activeCount = Number(resvBalRes.rows[0]?.count ?? 0);

    const limitUnits = parseMoney(String(debtor.credit_limit));
    const totalExposureUnits = postedNetUnits + pendingUnits;
    const availableUnits = limitUnits - totalExposureUnits;

    return {
      debtorAccountId,
      currency: debtor.currency,
      accountStatus: debtor.status,
      creditLimit: formatMoney(limitUnits),
      postedNetBalance: formatMoney(postedNetUnits),
      pendingReservations: formatMoney(pendingUnits),
      totalExposure: formatMoney(totalExposureUnits),
      availableCredit: formatMoney(availableUnits < 0n ? 0n : availableUnits),
      activeReservationsCount: activeCount,
    };
  });
}

/**
 * Creates a row-locked credit reservation.
 * Follows strict concurrency safety: locks debtor_account FOR UPDATE,
 * evaluates credit against posted net balance and active reservations,
 * and creates reservation with a 120-second expiry.
 */
export async function createCreditReservation(
  db: DbClient,
  tenantId: string,
  command: CreateReservationCommand,
): Promise<ReservationResult> {
  const reqUnits = requirePositive(command.amount, "Reservation amount");
  const depositUnits = parseMoney(command.confirmedDeposit ?? "0.0000");
  const ttlSeconds = command.ttlSeconds ?? 120;

  return withTenantContext(db, tenantId, async (tx) => {
    // 1. Lock debtor account FOR UPDATE
    const debtorRes = await tx.query<{
      id: string;
      currency: string;
      credit_limit: string | number;
      status: AccountStatus;
      ledger_version: string | number;
      policy_version: number;
    }>(
      `SELECT id, currency, credit_limit, status, ledger_version, policy_version
       FROM debtor_account
       WHERE tenant_id = $1 AND id = $2
       FOR UPDATE`,
      [tenantId, command.debtorAccountId],
    );
    if (debtorRes.rows.length === 0) {
      throw new Error(`Debtor account ${command.debtorAccountId} not found`);
    }
    const debtor = debtorRes.rows[0]!;

    if (command.currency !== debtor.currency) {
      throw new RangeError(`Currency mismatch: debtor requires ${debtor.currency}, got ${command.currency}`);
    }

    // 2. Check Idempotency
    const existingRes = await tx.query<{
      id: string;
      amount: string | number;
      currency: string;
      cart_digest: string;
      status: "reserved" | "submitting" | "consumed" | "cancelled" | "expired" | "uncertain";
      expires_at: string | Date;
    }>(
      `SELECT id, amount, currency, cart_digest, status, expires_at
       FROM credit_reservation
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, command.idempotencyKey],
    );

    if (existingRes.rows.length > 0) {
      const row = existingRes.rows[0]!;
      const expiresStr = row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at);
      return {
        reservationId: row.id,
        debtorAccountId: command.debtorAccountId,
        amount: formatMoney(parseMoney(String(row.amount))),
        currency: row.currency,
        cartDigest: row.cart_digest,
        status: row.status === "reserved" ? "reserved" : "blocked",
        approved: row.status === "reserved",
        exposureAfter: formatMoney(reqUnits),
        expiresAt: expiresStr,
        isDuplicate: true,
      };
    }

    // 3. Status check: hold, stopped, or closed blocks immediately
    if (debtor.status !== "active") {
      return {
        reservationId: "",
        debtorAccountId: command.debtorAccountId,
        amount: formatMoney(reqUnits),
        currency: command.currency,
        cartDigest: command.cartDigest,
        status: "blocked",
        approved: false,
        exposureAfter: "0.0000",
        expiresAt: "",
        isDuplicate: false,
      };
    }

    // 4. Calculate live posted net balance
    const docBalRes = await tx.query<{
      debits: string | number;
      credits: string | number;
    }>(
      `SELECT 
         COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0) AS debits,
         COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS credits
       FROM document
       WHERE tenant_id = $1 AND debtor_account_id = $2`,
      [tenantId, command.debtorAccountId],
    );
    const postedDebits = parseMoney(String(docBalRes.rows[0]?.debits ?? 0));
    const postedCredits = parseMoney(String(docBalRes.rows[0]?.credits ?? 0));
    const postedNetUnits = postedDebits - postedCredits;

    // 5. Calculate pending reservations (status in reserved, submitting, uncertain; active and approved)
    const resvBalRes = await tx.query<{ pending: string | number }>(
      `SELECT COALESCE(SUM(amount), 0) AS pending
       FROM credit_reservation
       WHERE tenant_id = $1 
         AND debtor_account_id = $2
         AND status IN ('reserved', 'submitting', 'uncertain')
         AND (status <> 'reserved' OR expires_at > now())
         AND approved = true`,
      [tenantId, command.debtorAccountId],
    );
    const pendingUnits = parseMoney(String(resvBalRes.rows[0]?.pending ?? 0));

    // 6. Evaluate Credit
    const decision = evaluateCredit({
      status: debtor.status,
      limit: formatMoney(parseMoney(String(debtor.credit_limit))),
      netBalance: formatMoney(postedNetUnits),
      pendingReservations: formatMoney(pendingUnits),
      requestedCredit: formatMoney(reqUnits),
      confirmedDeposit: formatMoney(depositUnits),
    });

    if (decision.kind === "blocked") {
      return {
        reservationId: "",
        debtorAccountId: command.debtorAccountId,
        amount: formatMoney(reqUnits),
        currency: command.currency,
        cartDigest: command.cartDigest,
        status: "blocked",
        approved: false,
        exposureAfter: "0.0000",
        expiresAt: "",
        isDuplicate: false,
      };
    }

    // Insert credit reservation
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const statusVal = "reserved";
    const isApproved = decision.kind === "approved";

    const insRes = await tx.query<{ id: string; created_at: string | Date }>(
      `INSERT INTO credit_reservation (
        tenant_id, debtor_account_id, actor_id, location_id,
        amount, currency, cart_digest, idempotency_key,
        status, expires_at, policy_version, approved
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12
      ) RETURNING id, created_at`,
      [
        tenantId,
        command.debtorAccountId,
        command.actorId,
        command.locationId,
        formatMoney(reqUnits),
        command.currency,
        command.cartDigest,
        command.idempotencyKey,
        statusVal,
        expiresAt.toISOString(),
        debtor.policy_version,
        isApproved,
      ],
    );
    const reservationId = insRes.rows[0]!.id;

    // Outbox & Audit
    await tx.query(
      `INSERT INTO outbox (tenant_id, kind, aggregate_id, idempotency_key, payload)
       VALUES ($1, 'ledger/credit_reserved', $2, $3, $4)`,
      [
        tenantId,
        reservationId,
        `outbox:reservation:${reservationId}`,
        JSON.stringify({
          reservationId,
          debtorAccountId: command.debtorAccountId,
          amount: formatMoney(reqUnits),
          status: decision.kind === "approved" ? "reserved" : "requires_override",
          exposureAfter: decision.exposureAfter,
        }),
      ],
    );

    if (decision.kind === "requires_override") {
      return {
        reservationId,
        debtorAccountId: command.debtorAccountId,
        amount: formatMoney(reqUnits),
        currency: command.currency,
        cartDigest: command.cartDigest,
        status: "requires_override",
        approved: false,
        shortfall: decision.shortfall,
        exposureAfter: decision.exposureAfter,
        expiresAt: expiresAt.toISOString(),
        isDuplicate: false,
      };
    }

    return {
      reservationId,
      debtorAccountId: command.debtorAccountId,
      amount: formatMoney(reqUnits),
      currency: command.currency,
      cartDigest: command.cartDigest,
      status: "reserved",
      approved: true,
      availableAfter: decision.availableAfter,
      exposureAfter: decision.exposureAfter,
      expiresAt: expiresAt.toISOString(),
      isDuplicate: false,
    };
  });
}

/**
 * Records a supervisor override for a credit reservation that exceeded limit.
 */
export async function recordSupervisorOverride(
  db: DbClient,
  tenantId: string,
  command: SupervisorOverrideCommand,
): Promise<SupervisorOverrideResult> {
  const approvedUnits = requirePositive(command.approvedAmount, "Approved override amount");
  const ttlSeconds = command.ttlSeconds ?? 120;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  return withTenantContext(db, tenantId, async (tx) => {
    // 1. Fetch reservation
    const resvRes = await tx.query<{
      id: string;
      debtor_account_id: string;
      cart_digest: string;
      status: string;
      amount: string | number;
    }>(
      `SELECT id, debtor_account_id, cart_digest, status, amount
       FROM credit_reservation
       WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, command.creditReservationId],
    );
    if (resvRes.rows.length === 0) {
      throw new Error(`Credit reservation ${command.creditReservationId} not found`);
    }
    const resv = resvRes.rows[0]!;

    if (resv.cart_digest !== command.cartDigest) {
      throw new RangeError("Cart digest mismatch: cart has been modified since reservation was initiated");
    }

    // 2. Lock debtor account FOR UPDATE
    const debtorRes = await tx.query<{ status: AccountStatus }>(
      "SELECT status FROM debtor_account WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [tenantId, resv.debtor_account_id],
    );
    if (debtorRes.rows[0]?.status === "closed") {
      throw new Error("Cannot override credit limit for closed debtor account");
    }

    // 3. Insert supervisor override (triggers check_supervisor_override)
    const insRes = await tx.query<{ id: string }>(
      `INSERT INTO supervisor_override (
        tenant_id, credit_reservation_id, actor_id, reason,
        approved_amount, cart_digest, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
      [
        tenantId,
        command.creditReservationId,
        command.supervisorActorId,
        command.reason,
        formatMoney(approvedUnits),
        command.cartDigest,
        expiresAt.toISOString(),
      ],
    );
    const overrideId = insRes.rows[0]!.id;

    // Extend reservation expiry to match supervisor approval and mark approved
    await tx.query(
      "UPDATE credit_reservation SET approved = true, expires_at = $1 WHERE tenant_id = $2 AND id = $3",
      [expiresAt.toISOString(), tenantId, resv.id],
    );

    // Outbox & Audit
    await tx.query(
      `INSERT INTO audit_event (
        tenant_id, actor_id, action, entity_type, entity_id, correlation_id, details
      ) VALUES ($1, $2, 'override', 'credit_reservation', $3, gen_random_uuid(), $4)`,
      [
        tenantId,
        command.supervisorActorId,
        resv.id,
        JSON.stringify({
          overrideId,
          reason: command.reason,
          approvedAmount: formatMoney(approvedUnits),
        }),
      ],
    );

    return {
      overrideId,
      creditReservationId: resv.id,
      supervisorActorId: command.supervisorActorId,
      approvedAmount: formatMoney(approvedUnits),
      expiresAt: expiresAt.toISOString(),
    };
  });
}

/**
 * Transitions reservation from 'reserved' to 'submitting'.
 * Re-validates that cart digest is unchanged and debtor account is not on hold.
 */
export async function confirmReservationSubmission(
  db: DbClient,
  tenantId: string,
  command: ConfirmReservationCommand,
): Promise<{ reservationId: string; status: "submitting" }> {
  return withTenantContext(db, tenantId, async (tx) => {
    // 1. Lock reservation FOR UPDATE
    const resvRes = await tx.query<{
      id: string;
      debtor_account_id: string;
      cart_digest: string;
      status: string;
      expires_at: string | Date;
    }>(
      `SELECT id, debtor_account_id, cart_digest, status, expires_at
       FROM credit_reservation
       WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, command.reservationId],
    );
    if (resvRes.rows.length === 0) {
      throw new Error(`Credit reservation ${command.reservationId} not found`);
    }
    const resv = resvRes.rows[0]!;

    if (resv.status !== "reserved") {
      throw new Error(`Reservation is not in reserved status (current: ${resv.status})`);
    }

    // 2. Validate Cart Digest: changed cart invalidates approval!
    if (resv.cart_digest !== command.currentCartDigest) {
      throw new RangeError("Cart digest mismatch: cart has been modified since approval");
    }

    // 3. Lock debtor account: hold invalidates approval!
    const debtorRes = await tx.query<{ status: AccountStatus }>(
      "SELECT status FROM debtor_account WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [tenantId, resv.debtor_account_id],
    );
    if (debtorRes.rows[0]?.status !== "active") {
      throw new Error(`Debtor account is on ${debtorRes.rows[0]?.status}: cannot confirm reservation`);
    }

    // 4. Update status to submitting
    await tx.query(
      "UPDATE credit_reservation SET status = 'submitting' WHERE tenant_id = $1 AND id = $2",
      [tenantId, resv.id],
    );

    return { reservationId: resv.id, status: "submitting" };
  });
}

/**
 * Marks reservation as 'uncertain' when a remote API call times out or returns ambiguous status.
 * Reservations with 'uncertain' status DO NOT expire on a timer and retain credit exposure!
 */
export async function markReservationUncertain(
  db: DbClient,
  tenantId: string,
  reservationId: string,
): Promise<void> {
  await withTenantContext(db, tenantId, async (tx) => {
    await tx.query(
      "UPDATE credit_reservation SET status = 'uncertain' WHERE tenant_id = $1 AND id = $2",
      [tenantId, reservationId],
    );

    await tx.query(
      `INSERT INTO outbox (tenant_id, kind, aggregate_id, idempotency_key, payload)
       VALUES ($1, 'ledger/reservation_uncertain', $2, $3, $4)`,
      [
        tenantId,
        reservationId,
        `outbox:uncertain:${reservationId}`,
        JSON.stringify({ reservationId }),
      ],
    );
  });
}

/**
 * Atomically consumes a credit reservation and posts the corresponding financial journal/document.
 * Done in a single transaction so credit exposure smoothly transitions from reservation to posted document
 * without ever disappearing or doubling.
 */
export async function consumeReservationWithPosting(
  db: DbClient,
  tenantId: string,
  command: ConsumeReservationCommand,
): Promise<ConsumeReservationResult> {
  return withTenantContext(db, tenantId, async (tx) => {
    // 1. Lock reservation FOR UPDATE
    const resvRes = await tx.query<{
      id: string;
      debtor_account_id: string;
      cart_digest: string;
      status: string;
    }>(
      `SELECT id, debtor_account_id, cart_digest, status
       FROM credit_reservation
       WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, command.reservationId],
    );
    if (resvRes.rows.length === 0) {
      throw new Error(`Credit reservation ${command.reservationId} not found`);
    }
    const resv = resvRes.rows[0]!;

    if (!["reserved", "submitting", "uncertain"].includes(resv.status)) {
      throw new Error(`Reservation cannot be consumed from status: ${resv.status}`);
    }

    if (resv.cart_digest !== command.currentCartDigest) {
      throw new RangeError("Cart digest mismatch: cart has been modified since reservation was initiated");
    }

    // 2. Lock debtor account FOR UPDATE
    const debtorRes = await tx.query<{ status: AccountStatus }>(
      "SELECT status FROM debtor_account WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [tenantId, resv.debtor_account_id],
    );
    if (debtorRes.rows[0]?.status !== "active") {
      throw new Error(`Debtor account is on ${debtorRes.rows[0]?.status}: cannot consume reservation`);
    }

    // 3. Mark reservation consumed
    await tx.query(
      "UPDATE credit_reservation SET status = 'consumed' WHERE tenant_id = $1 AND id = $2",
      [tenantId, resv.id],
    );

    // 4. Post journal in same transaction
    const postRes = await postJournal(tx, tenantId, command.postingBundle);

    return {
      reservationId: resv.id,
      postingResult: postRes,
    };
  });
}
