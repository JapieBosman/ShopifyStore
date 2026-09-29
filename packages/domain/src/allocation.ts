import type { DbClient } from "../../database/tenant-context.ts";
import { withTenantContext } from "../../database/tenant-context.ts";
import { formatMoney, parseMoney, requireNonnegative, requirePositive } from "./money.ts";

export interface OpenDocument {
  id: string;
  debtorAccountId: string;
  currency: string;
  issuedOn: string;
  documentNumber: string;
  remaining: string;
}

export interface AllocationLine {
  debitDocumentId: string;
  amount: string;
}

export interface AllocationPlan {
  lines: readonly AllocationLine[];
  unappliedCredit: string;
  remainingDebit?: string;
  netBalance?: string;
}

function validateDocuments(
  credit: OpenDocument,
  debits: readonly OpenDocument[],
): void {
  const uniqueIds = new Set<string>();
  for (const debit of debits) {
    if (
      !debit.id ||
      debit.id === credit.id ||
      uniqueIds.has(debit.id) ||
      debit.debtorAccountId !== credit.debtorAccountId ||
      debit.currency !== credit.currency
    ) {
      throw new RangeError("Allocations require distinct documents on one account and currency");
    }
    uniqueIds.add(debit.id);
    requireNonnegative(debit.remaining, "Open debit");
  }
}

export function planOldestFirstAllocation(
  credit: OpenDocument,
  debits: readonly OpenDocument[],
): AllocationPlan {
  validateDocuments(credit, debits);
  let available = requirePositive(credit.remaining, "Available credit");
  const sorted = [...debits].sort(
    (first, second) =>
      first.issuedOn.localeCompare(second.issuedOn) ||
      first.documentNumber.localeCompare(second.documentNumber) ||
      first.id.localeCompare(second.id),
  );
  const lines: AllocationLine[] = [];
  let totalRemainingDebit = 0n;

  for (const debit of sorted) {
    const outstanding = parseMoney(debit.remaining);
    const applied = outstanding < available ? outstanding : available;
    if (applied > 0n) {
      lines.push({ debitDocumentId: debit.id, amount: formatMoney(applied) });
      available -= applied;
      totalRemainingDebit += outstanding - applied;
    } else {
      totalRemainingDebit += outstanding;
    }
  }

  const unappliedCreditStr = formatMoney(available);
  const remainingDebitStr = formatMoney(totalRemainingDebit);
  // Net balance = remaining debits - unapplied credits
  const netBalanceStr = formatMoney(totalRemainingDebit - available);

  return {
    lines,
    unappliedCredit: unappliedCreditStr,
  };
}

export function planExplicitAllocation(
  credit: OpenDocument,
  debit: OpenDocument,
  amount: string,
): AllocationLine {
  validateDocuments(credit, [debit]);
  const requested = requirePositive(amount, "Allocation amount");
  if (
    requested > requireNonnegative(credit.remaining, "Available credit") ||
    requested > requireNonnegative(debit.remaining, "Open debit")
  ) {
    throw new RangeError("Allocation exceeds an open document");
  }
  return { debitDocumentId: debit.id, amount: formatMoney(requested) };
}

// ---------------------------------------------------------------------------
// Database Transactional Execution
// ---------------------------------------------------------------------------

export interface DocumentWithAllocation {
  id: string;
  debtorAccountId: string;
  documentNumber: string;
  kind: string;
  direction: "debit" | "credit";
  amount: string;
  currency: string;
  issuedOn: string;
  dueOn: string | null;
  allocatedAmount: string;
  remainingAmount: string;
}

export interface DebtorBalanceSummary {
  debtorAccountId: string;
  currency: string;
  ledgerVersion: number;
  totalDebit: string;
  totalCredit: string;
  totalOpenDebit: string;
  unappliedCredit: string;
  netBalance: string;
  openDebits: DocumentWithAllocation[];
  openCredits: DocumentWithAllocation[];
}

export interface ExplicitAllocationCommand {
  actorId: string;
  debtorAccountId: string;
  debitDocumentId: string;
  creditDocumentId: string;
  amount: string;
  effectiveDate: string; // YYYY-MM-DD
  idempotencyKey: string;
}

export interface ExplicitAllocationResult {
  allocationId: string;
  debtorAccountId: string;
  debitDocumentId: string;
  creditDocumentId: string;
  amount: string;
  isDuplicate: boolean;
  unappliedCredit: string;
  netBalance: string;
}

export interface OldestFirstAllocationCommand {
  actorId: string;
  debtorAccountId: string;
  creditDocumentId: string;
  effectiveDate: string; // YYYY-MM-DD
  idempotencyKeyPrefix: string;
}

export interface OldestFirstAllocationResult {
  allocations: Array<{
    allocationId: string;
    debitDocumentId: string;
    amount: string;
  }>;
  totalAllocated: string;
  unappliedCredit: string;
  netBalance: string;
}

export interface ReverseAllocationCommand {
  actorId: string;
  allocationId: string;
  effectiveDate: string; // YYYY-MM-DD
  reason: string;
}

export interface ReverseAllocationResult {
  reversalId: string;
  allocationId: string;
  amount: string;
  effectiveDate: string;
}

/**
 * Retrieves the live debtor balance summary, calculating open debit documents,
 * unapplied credits, and the signed net balance (open debits - unapplied credits).
 */
export async function getDebtorBalanceSummary(
  db: DbClient,
  tenantId: string,
  debtorAccountId: string,
): Promise<DebtorBalanceSummary> {
  return withTenantContext(db, tenantId, async (tx) => {
    const debtorRes = await tx.query<{ currency: string; ledger_version: string | number }>(
      "SELECT currency, ledger_version FROM debtor_account WHERE tenant_id = $1 AND id = $2",
      [tenantId, debtorAccountId],
    );
    if (debtorRes.rows.length === 0) {
      throw new Error(`Debtor account ${debtorAccountId} not found`);
    }
    const currency = debtorRes.rows[0]!.currency;
    const ledgerVersion = Number(debtorRes.rows[0]!.ledger_version);

    // Query all documents with their active (unreversed) allocated sum
    const docQuery = `
      SELECT 
        d.id,
        d.debtor_account_id,
        d.document_number,
        d.kind,
        d.direction,
        d.amount,
        d.currency,
        d.issued_on,
        d.due_on,
        COALESCE(SUM(a.amount), 0) AS allocated_amount
      FROM document d
      LEFT JOIN allocation a ON (
        a.tenant_id = d.tenant_id 
        AND (
          (d.direction = 'debit' AND a.debit_document_id = d.id) OR
          (d.direction = 'credit' AND a.credit_document_id = d.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM allocation_reversal ar 
          WHERE ar.tenant_id = a.tenant_id AND ar.allocation_id = a.id
        )
      )
      WHERE d.tenant_id = $1 AND d.debtor_account_id = $2
      GROUP BY d.id, d.debtor_account_id, d.document_number, d.kind, d.direction, d.amount, d.currency, d.issued_on, d.due_on
      ORDER BY d.issued_on ASC, d.document_number ASC, d.id ASC
    `;

    const docRes = await tx.query<{
      id: string;
      debtor_account_id: string;
      document_number: string;
      kind: string;
      direction: "debit" | "credit";
      amount: string | number;
      currency: string;
      issued_on: string | Date;
      due_on: string | Date | null;
      allocated_amount: string | number;
    }>(docQuery, [tenantId, debtorAccountId]);

    let totalDebitUnits = 0n;
    let totalCreditUnits = 0n;
    let totalOpenDebitUnits = 0n;
    let unappliedCreditUnits = 0n;

    const openDebits: DocumentWithAllocation[] = [];
    const openCredits: DocumentWithAllocation[] = [];

    for (const r of docRes.rows) {
      const docAmountUnits = parseMoney(String(r.amount));
      const allocatedUnits = parseMoney(String(r.allocated_amount));
      const remainingUnits = docAmountUnits - allocatedUnits;
      const docFormatted: DocumentWithAllocation = {
        id: r.id,
        debtorAccountId: r.debtor_account_id,
        documentNumber: r.document_number,
        kind: r.kind,
        direction: r.direction,
        amount: formatMoney(docAmountUnits),
        currency: r.currency,
        issuedOn: r.issued_on instanceof Date ? r.issued_on.toISOString().slice(0, 10) : String(r.issued_on),
        dueOn: r.due_on ? (r.due_on instanceof Date ? r.due_on.toISOString().slice(0, 10) : String(r.due_on)) : null,
        allocatedAmount: formatMoney(allocatedUnits),
        remainingAmount: formatMoney(remainingUnits),
      };

      if (r.direction === "debit") {
        totalDebitUnits += docAmountUnits;
        if (remainingUnits > 0n) {
          totalOpenDebitUnits += remainingUnits;
          openDebits.push(docFormatted);
        }
      } else {
        totalCreditUnits += docAmountUnits;
        if (remainingUnits > 0n) {
          unappliedCreditUnits += remainingUnits;
          openCredits.push(docFormatted);
        }
      }
    }

    // Net balance = total open debit - unapplied credit
    const netBalanceUnits = totalOpenDebitUnits - unappliedCreditUnits;

    return {
      debtorAccountId,
      currency,
      ledgerVersion,
      totalDebit: formatMoney(totalDebitUnits),
      totalCredit: formatMoney(totalCreditUnits),
      totalOpenDebit: formatMoney(totalOpenDebitUnits),
      unappliedCredit: formatMoney(unappliedCreditUnits),
      netBalance: formatMoney(netBalanceUnits),
      openDebits,
      openCredits,
    };
  });
}

/**
 * Executes an explicit allocation between a credit document and a debit document.
 * Follows strict lock ordering:
 * 1. debtor_account FOR UPDATE
 * 2. documents in deterministic UUID order FOR UPDATE
 */
export async function executeExplicitAllocation(
  db: DbClient,
  tenantId: string,
  command: ExplicitAllocationCommand,
): Promise<ExplicitAllocationResult> {
  const amountUnits = requirePositive(command.amount, "Allocation amount");

  return withTenantContext(db, tenantId, async (tx) => {
    // 1. Lock debtor account FOR UPDATE
    const debtorRes = await tx.query<{ currency: string; ledger_version: string | number }>(
      "SELECT currency, ledger_version FROM debtor_account WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [tenantId, command.debtorAccountId],
    );
    if (debtorRes.rows.length === 0) {
      throw new Error(`Debtor account ${command.debtorAccountId} not found`);
    }

    // 2. Check idempotency
    const existing = await tx.query<{
      id: string;
      debtor_account_id: string;
      debit_document_id: string;
      credit_document_id: string;
      amount: string | number;
    }>(
      `SELECT id, debtor_account_id, debit_document_id, credit_document_id, amount
       FROM allocation
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, command.idempotencyKey],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0]!;
      const summary = await getDebtorBalanceSummary(db, tenantId, command.debtorAccountId);
      return {
        allocationId: row.id,
        debtorAccountId: row.debtor_account_id,
        debitDocumentId: row.debit_document_id,
        creditDocumentId: row.credit_document_id,
        amount: formatMoney(parseMoney(String(row.amount))),
        isDuplicate: true,
        unappliedCredit: summary.unappliedCredit,
        netBalance: summary.netBalance,
      };
    }

    if (command.debitDocumentId === command.creditDocumentId) {
      throw new RangeError("Debit and credit documents must be distinct");
    }

    // 3. Lock both documents in deterministic UUID order to prevent deadlocks
    const docIds = [command.debitDocumentId, command.creditDocumentId].sort();
    const docRes = await tx.query<{
      id: string;
      debtor_account_id: string;
      direction: "debit" | "credit";
      amount: string | number;
      currency: string;
    }>(
      `SELECT id, debtor_account_id, direction, amount, currency
       FROM document
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])
       ORDER BY id FOR UPDATE`,
      [tenantId, docIds],
    );

    if (docRes.rows.length !== 2) {
      throw new Error("One or both documents not found for allocation");
    }

    const debitDoc = docRes.rows.find((d) => d.id === command.debitDocumentId);
    const creditDoc = docRes.rows.find((d) => d.id === command.creditDocumentId);

    if (!debitDoc || debitDoc.direction !== "debit") {
      throw new RangeError(`Document ${command.debitDocumentId} is not a valid debit document`);
    }
    if (!creditDoc || creditDoc.direction !== "credit") {
      throw new RangeError(`Document ${command.creditDocumentId} is not a valid credit document`);
    }

    if (
      debitDoc.debtor_account_id !== command.debtorAccountId ||
      creditDoc.debtor_account_id !== command.debtorAccountId
    ) {
      throw new RangeError("Allocations require documents belonging to the same debtor account");
    }

    if (debitDoc.currency !== creditDoc.currency) {
      throw new RangeError(`Cannot allocate across different currencies: ${debitDoc.currency} vs ${creditDoc.currency}`);
    }

    // 4. Check remaining open amount on both documents
    const allocSums = await tx.query<{
      document_id: string;
      allocated: string | number;
    }>(
      `SELECT 
         d.id AS document_id,
         COALESCE(SUM(a.amount), 0) AS allocated
       FROM document d
       LEFT JOIN allocation a ON (
         a.tenant_id = d.tenant_id AND
         (
           (d.direction = 'debit' AND a.debit_document_id = d.id) OR
           (d.direction = 'credit' AND a.credit_document_id = d.id)
         ) AND
         NOT EXISTS (
           SELECT 1 FROM allocation_reversal ar
           WHERE ar.tenant_id = a.tenant_id AND ar.allocation_id = a.id
         )
       )
       WHERE d.tenant_id = $1 AND d.id = ANY($2::uuid[])
       GROUP BY d.id`,
      [tenantId, docIds],
    );

    const debitAlloc = allocSums.rows.find((r) => r.document_id === debitDoc.id);
    const creditAlloc = allocSums.rows.find((r) => r.document_id === creditDoc.id);

    const debitTotalUnits = parseMoney(String(debitDoc.amount));
    const debitAllocUnits = parseMoney(String(debitAlloc?.allocated ?? 0));
    const debitRemainingUnits = debitTotalUnits - debitAllocUnits;

    const creditTotalUnits = parseMoney(String(creditDoc.amount));
    const creditAllocUnits = parseMoney(String(creditAlloc?.allocated ?? 0));
    const creditRemainingUnits = creditTotalUnits - creditAllocUnits;

    if (amountUnits > debitRemainingUnits) {
      throw new RangeError(
        `Allocation amount ${formatMoney(amountUnits)} exceeds remaining debit ${formatMoney(debitRemainingUnits)}`,
      );
    }
    if (amountUnits > creditRemainingUnits) {
      throw new RangeError(
        `Allocation amount ${formatMoney(amountUnits)} exceeds available credit ${formatMoney(creditRemainingUnits)}`,
      );
    }

    // 5. Insert allocation record
    const insertRes = await tx.query<{ id: string }>(
      `INSERT INTO allocation (
        tenant_id, debtor_account_id, debit_document_id, credit_document_id,
        amount, effective_date, actor_id, idempotency_key
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8
      ) RETURNING id`,
      [
        tenantId,
        command.debtorAccountId,
        command.debitDocumentId,
        command.creditDocumentId,
        formatMoney(amountUnits),
        command.effectiveDate,
        command.actorId,
        command.idempotencyKey,
      ],
    );
    const allocationId = insertRes.rows[0]!.id;

    // 6. Update debtor account ledger_version
    await tx.query(
      `UPDATE debtor_account 
       SET ledger_version = ledger_version + 1 
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, command.debtorAccountId],
    );

    // 7. Atomic Outbox and Audit Event
    await tx.query(
      `INSERT INTO outbox (tenant_id, kind, aggregate_id, idempotency_key, payload)
       VALUES ($1, 'ledger/allocation_created', $2, $3, $4)`,
      [
        tenantId,
        allocationId,
        `outbox:allocation:${allocationId}`,
        JSON.stringify({
          allocationId,
          debtorAccountId: command.debtorAccountId,
          debitDocumentId: command.debitDocumentId,
          creditDocumentId: command.creditDocumentId,
          amount: formatMoney(amountUnits),
        }),
      ],
    );

    await tx.query(
      `INSERT INTO audit_event (
        tenant_id, actor_id, action, entity_type, entity_id, correlation_id, details
      ) VALUES (
        $1, $2, 'allocate', 'allocation', $3, gen_random_uuid(), $4
      )`,
      [
        tenantId,
        command.actorId,
        allocationId,
        JSON.stringify({
          debitDocumentId: command.debitDocumentId,
          creditDocumentId: command.creditDocumentId,
          amount: formatMoney(amountUnits),
        }),
      ],
    );

    const summary = await getDebtorBalanceSummary(db, tenantId, command.debtorAccountId);

    return {
      allocationId,
      debtorAccountId: command.debtorAccountId,
      debitDocumentId: command.debitDocumentId,
      creditDocumentId: command.creditDocumentId,
      amount: formatMoney(amountUnits),
      isDuplicate: false,
      unappliedCredit: summary.unappliedCredit,
      netBalance: summary.netBalance,
    };
  });
}

/**
 * Executes automatic oldest-issued-first allocation for a credit document across all open debit documents.
 * Sorts open debits by issued_on ASC, document_number ASC, id ASC.
 */
export async function executeOldestFirstAllocation(
  db: DbClient,
  tenantId: string,
  command: OldestFirstAllocationCommand,
): Promise<OldestFirstAllocationResult> {
  return withTenantContext(db, tenantId, async (tx) => {
    // 1. Lock debtor account FOR UPDATE
    const debtorRes = await tx.query<{ currency: string; ledger_version: string | number }>(
      "SELECT currency, ledger_version FROM debtor_account WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [tenantId, command.debtorAccountId],
    );
    if (debtorRes.rows.length === 0) {
      throw new Error(`Debtor account ${command.debtorAccountId} not found`);
    }

    // 2. Fetch and lock credit document
    const creditDocRes = await tx.query<{
      id: string;
      debtor_account_id: string;
      direction: "debit" | "credit";
      amount: string | number;
      currency: string;
    }>(
      `SELECT id, debtor_account_id, direction, amount, currency
       FROM document
       WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, command.creditDocumentId],
    );
    if (creditDocRes.rows.length === 0) {
      throw new Error(`Credit document ${command.creditDocumentId} not found`);
    }
    const creditDoc = creditDocRes.rows[0]!;
    if (creditDoc.direction !== "credit") {
      throw new RangeError(`Document ${command.creditDocumentId} is not a credit document`);
    }
    if (creditDoc.debtor_account_id !== command.debtorAccountId) {
      throw new RangeError("Credit document does not belong to specified debtor account");
    }

    // Check existing allocated sum on credit document
    const creditAllocRes = await tx.query<{ allocated: string | number }>(
      `SELECT COALESCE(SUM(a.amount), 0) AS allocated
       FROM allocation a
       WHERE a.tenant_id = $1 AND a.credit_document_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM allocation_reversal ar
           WHERE ar.tenant_id = a.tenant_id AND ar.allocation_id = a.id
         )`,
      [tenantId, creditDoc.id],
    );
    const creditTotalUnits = parseMoney(String(creditDoc.amount));
    const creditAllocUnits = parseMoney(String(creditAllocRes.rows[0]!.allocated));
    let availableCreditUnits = creditTotalUnits - creditAllocUnits;

    if (availableCreditUnits <= 0n) {
      const summary = await getDebtorBalanceSummary(db, tenantId, command.debtorAccountId);
      return {
        allocations: [],
        totalAllocated: "0.0000",
        unappliedCredit: summary.unappliedCredit,
        netBalance: summary.netBalance,
      };
    }

    // 3. Fetch all debit documents for this debtor account, locked FOR UPDATE in deterministic order
    const debitDocsRes = await tx.query<{
      id: string;
      document_number: string;
      amount: string | number;
      issued_on: string | Date;
    }>(
      `SELECT id, document_number, amount, issued_on
       FROM document
       WHERE tenant_id = $1 AND debtor_account_id = $2 AND direction = 'debit'
       ORDER BY issued_on ASC, document_number ASC, id ASC
       FOR UPDATE`,
      [tenantId, command.debtorAccountId],
    );

    if (debitDocsRes.rows.length === 0) {
      const summary = await getDebtorBalanceSummary(db, tenantId, command.debtorAccountId);
      return {
        allocations: [],
        totalAllocated: "0.0000",
        unappliedCredit: summary.unappliedCredit,
        netBalance: summary.netBalance,
      };
    }

    // 4. Calculate remaining balance for each debit document
    const debitDocIds = debitDocsRes.rows.map((d) => d.id);
    const debitAllocRes = await tx.query<{
      debit_document_id: string;
      allocated: string | number;
    }>(
      `SELECT debit_document_id, COALESCE(SUM(amount), 0) AS allocated
       FROM allocation a
       WHERE tenant_id = $1 AND debit_document_id = ANY($2::uuid[])
         AND NOT EXISTS (
           SELECT 1 FROM allocation_reversal ar
           WHERE ar.tenant_id = a.tenant_id AND ar.allocation_id = a.id
         )
       GROUP BY debit_document_id`,
      [tenantId, debitDocIds],
    );

    const debitAllocMap = new Map<string, bigint>();
    for (const r of debitAllocRes.rows) {
      debitAllocMap.set(r.debit_document_id, parseMoney(String(r.allocated)));
    }

    const createdAllocations: Array<{
      allocationId: string;
      debitDocumentId: string;
      amount: string;
    }> = [];
    let totalAllocatedUnits = 0n;

    for (const debitDoc of debitDocsRes.rows) {
      if (availableCreditUnits <= 0n) break;

      const totalDocUnits = parseMoney(String(debitDoc.amount));
      const alreadyAllocated = debitAllocMap.get(debitDoc.id) ?? 0n;
      const remainingDocUnits = totalDocUnits - alreadyAllocated;

      if (remainingDocUnits <= 0n) continue;

      const toAllocate = remainingDocUnits < availableCreditUnits ? remainingDocUnits : availableCreditUnits;
      const idempotencyKey = `${command.idempotencyKeyPrefix}:${creditDoc.id}:${debitDoc.id}`;

      // Insert allocation
      const insRes = await tx.query<{ id: string }>(
        `INSERT INTO allocation (
          tenant_id, debtor_account_id, debit_document_id, credit_document_id,
          amount, effective_date, actor_id, idempotency_key
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
        ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET amount = EXCLUDED.amount
        RETURNING id`,
        [
          tenantId,
          command.debtorAccountId,
          debitDoc.id,
          creditDoc.id,
          formatMoney(toAllocate),
          command.effectiveDate,
          command.actorId,
          idempotencyKey,
        ],
      );

      const allocationId = insRes.rows[0]!.id;
      createdAllocations.push({
        allocationId,
        debitDocumentId: debitDoc.id,
        amount: formatMoney(toAllocate),
      });

      availableCreditUnits -= toAllocate;
      totalAllocatedUnits += toAllocate;
    }

    if (createdAllocations.length > 0) {
      // 5. Increment debtor account ledger_version
      await tx.query(
        `UPDATE debtor_account 
         SET ledger_version = ledger_version + 1 
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, command.debtorAccountId],
      );

      // 6. Outbox and Audit
      for (const a of createdAllocations) {
        await tx.query(
          `INSERT INTO outbox (tenant_id, kind, aggregate_id, idempotency_key, payload)
           VALUES ($1, 'ledger/allocation_created', $2, $3, $4)`,
          [
            tenantId,
            a.allocationId,
            `outbox:allocation:${a.allocationId}`,
            JSON.stringify({
              allocationId: a.allocationId,
              debtorAccountId: command.debtorAccountId,
              debitDocumentId: a.debitDocumentId,
              creditDocumentId: creditDoc.id,
              amount: a.amount,
            }),
          ],
        );
      }

      await tx.query(
        `INSERT INTO audit_event (
          tenant_id, actor_id, action, entity_type, entity_id, correlation_id, details
        ) VALUES (
          $1, $2, 'allocate_oldest_first', 'debtor_account', $3, gen_random_uuid(), $4
        )`,
        [
          tenantId,
          command.actorId,
          command.debtorAccountId,
          JSON.stringify({
            creditDocumentId: creditDoc.id,
            allocationCount: createdAllocations.length,
            totalAllocated: formatMoney(totalAllocatedUnits),
          }),
        ],
      );
    }

    const summary = await getDebtorBalanceSummary(db, tenantId, command.debtorAccountId);

    return {
      allocations: createdAllocations,
      totalAllocated: formatMoney(totalAllocatedUnits),
      unappliedCredit: summary.unappliedCredit,
      netBalance: summary.netBalance,
    };
  });
}

/**
 * Reverses an allocation via append-only allocation_reversal record.
 */
export async function reverseAllocation(
  db: DbClient,
  tenantId: string,
  command: ReverseAllocationCommand,
): Promise<ReverseAllocationResult> {
  return withTenantContext(db, tenantId, async (tx) => {
    // 1. Fetch and lock allocation
    const allocRes = await tx.query<{
      id: string;
      debtor_account_id: string;
      debit_document_id: string;
      credit_document_id: string;
      amount: string | number;
    }>(
      `SELECT id, debtor_account_id, debit_document_id, credit_document_id, amount
       FROM allocation
       WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, command.allocationId],
    );

    if (allocRes.rows.length === 0) {
      throw new Error(`Allocation ${command.allocationId} not found`);
    }
    const alloc = allocRes.rows[0]!;

    // 2. Lock debtor account FOR UPDATE
    await tx.query(
      "SELECT id, ledger_version FROM debtor_account WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [tenantId, alloc.debtor_account_id],
    );

    // 3. Verify allocation is not already reversed
    const revCheck = await tx.query<{ id: string }>(
      "SELECT id FROM allocation_reversal WHERE tenant_id = $1 AND allocation_id = $2",
      [tenantId, alloc.id],
    );
    if (revCheck.rows.length > 0) {
      throw new Error(`Allocation ${command.allocationId} has already been reversed`);
    }

    // 4. Insert allocation_reversal
    const revRes = await tx.query<{ id: string }>(
      `INSERT INTO allocation_reversal (
        tenant_id, allocation_id, effective_date, actor_id, reason
      ) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, alloc.id, command.effectiveDate, command.actorId, command.reason],
    );
    const reversalId = revRes.rows[0]!.id;

    // 5. Increment debtor account ledger_version
    await tx.query(
      `UPDATE debtor_account 
       SET ledger_version = ledger_version + 1 
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, alloc.debtor_account_id],
    );

    // 6. Outbox and Audit
    await tx.query(
      `INSERT INTO outbox (tenant_id, kind, aggregate_id, idempotency_key, payload)
       VALUES ($1, 'ledger/allocation_reversed', $2, $3, $4)`,
      [
        tenantId,
        reversalId,
        `outbox:allocation_reversal:${reversalId}`,
        JSON.stringify({
          reversalId,
          allocationId: alloc.id,
          debtorAccountId: alloc.debtor_account_id,
          amount: formatMoney(parseMoney(String(alloc.amount))),
          reason: command.reason,
        }),
      ],
    );

    await tx.query(
      `INSERT INTO audit_event (
        tenant_id, actor_id, action, entity_type, entity_id, correlation_id, details
      ) VALUES (
        $1, $2, 'reverse', 'allocation', $3, gen_random_uuid(), $4
      )`,
      [
        tenantId,
        command.actorId,
        alloc.id,
        JSON.stringify({
          reversalId,
          reason: command.reason,
          amount: formatMoney(parseMoney(String(alloc.amount))),
        }),
      ],
    );

    return {
      reversalId,
      allocationId: alloc.id,
      amount: formatMoney(parseMoney(String(alloc.amount))),
      effectiveDate: command.effectiveDate,
    };
  });
}
