import type { DbClient } from "../../database/tenant-context.ts";
import { withTenantContext } from "../../database/tenant-context.ts";
import { formatMoney, parseMoney, requireNonnegative } from "./money.ts";

export const BUCKETS = [
  "current",
  "d030",
  "d060",
  "d090",
  "d120",
  "d150",
  "d180",
  "over",
] as const;

export type Bucket = (typeof BUCKETS)[number];

export interface OpenItem {
  documentId: string;
  remaining: string;
  dueOn: string;
  periodOrdinal: number;
}

export interface AgingInput {
  basis: "due_date" | "calendar_period";
  asOfDate: string;
  asOfPeriodOrdinal: number;
  openItems: readonly OpenItem[];
  unappliedCredit: string;
}

export interface AgingResult {
  buckets: Record<Bucket, string>;
  openDebits: string;
  unappliedCredit: string;
  netBalance: string;
}

export interface AgingSnapshotRecord {
  id: string;
  debtorAccountId: string;
  asOfDate: string;
  ledgerVersion: number;
  basis: "due_date" | "calendar_period";
  policyVersion: number;
  unappliedCredit: string;
  netBalance: string;
  openDebits: string;
  buckets: Record<Bucket, string>;
  createdAt: string;
}

export interface BuildAgingSnapshotParams {
  debtorAccountId: string;
  asOfDate: string; // YYYY-MM-DD
  asOfPeriodOrdinal?: number;
  basis?: "due_date" | "calendar_period";
  policyVersion?: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_IN_MS = 86_400_000;

function utcDay(value: string): number {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw new RangeError("Date must be YYYY-MM-DD");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError("Invalid calendar date");
  }
  return timestamp;
}

function dueDateBucket(dueOn: string, asOfDate: string): Bucket {
  const days = Math.floor((utcDay(asOfDate) - utcDay(dueOn)) / DAY_IN_MS);
  if (days <= 0) {
    return "current";
  }
  return BUCKETS[Math.min(Math.ceil(days / 30), BUCKETS.length - 1)]!;
}

function periodBucket(ordinal: number, asOfOrdinal: number): Bucket {
  if (
    !Number.isSafeInteger(ordinal) ||
    !Number.isSafeInteger(asOfOrdinal) ||
    ordinal > asOfOrdinal
  ) {
    throw new RangeError("Invalid accounting-period cutoff");
  }
  return BUCKETS[Math.min(asOfOrdinal - ordinal, BUCKETS.length - 1)]!;
}

/**
 * Calculates in-memory 8-bucket aging from open debit items and unapplied credit.
 * Net balance is strictly calculated as: openDebits - unappliedCredit.
 */
export function calculateAging(input: AgingInput): AgingResult {
  const credit = requireNonnegative(input.unappliedCredit, "Unapplied credit");
  const buckets = Object.fromEntries(
    BUCKETS.map((bucket) => [bucket, 0n]),
  ) as Record<Bucket, bigint>;

  for (const item of input.openItems) {
    const remaining = requireNonnegative(item.remaining, "Open debit");
    const bucket =
      input.basis === "due_date"
        ? dueDateBucket(item.dueOn, input.asOfDate)
        : periodBucket(item.periodOrdinal, input.asOfPeriodOrdinal);
    buckets[bucket] += remaining;
  }

  const openDebits = BUCKETS.reduce(
    (total, bucket) => total + buckets[bucket],
    0n,
  );
  return {
    buckets: Object.fromEntries(
      BUCKETS.map((bucket) => [bucket, formatMoney(buckets[bucket])]),
    ) as Record<Bucket, string>,
    openDebits: formatMoney(openDebits),
    unappliedCredit: formatMoney(credit),
    netBalance: formatMoney(openDebits - credit),
  };
}

/**
 * Checks whether an aging snapshot is fresh against the debtor's current ledger version.
 * If snapshot ledger version is less than account ledger version, it is stale.
 */
export function isAgingSnapshotFresh(
  snapshotLedgerVersion: number | bigint,
  currentAccountLedgerVersion: number | bigint,
): boolean {
  return BigInt(snapshotLedgerVersion) === BigInt(currentAccountLedgerVersion);
}

/**
 * Asserts that a snapshot is fresh for credit authorization, throwing an error if stale.
 */
export function assertAgingSnapshotFresh(
  snapshotLedgerVersion: number | bigint,
  currentAccountLedgerVersion: number | bigint,
): void {
  if (!isAgingSnapshotFresh(snapshotLedgerVersion, currentAccountLedgerVersion)) {
    throw new Error(
      `Stale aging snapshot: snapshot version ${snapshotLedgerVersion} < current ledger version ${currentAccountLedgerVersion}`,
    );
  }
}

/**
 * Builds or retrieves a versioned aging snapshot for a debtor account.
 * Persists the snapshot in aging_snapshot and its 8 buckets in aging_bucket.
 */
export async function buildAgingSnapshot(
  db: DbClient,
  tenantId: string,
  params: BuildAgingSnapshotParams,
): Promise<AgingSnapshotRecord> {
  const policyVersion = params.policyVersion ?? 1;

  return withTenantContext(db, tenantId, async (tx) => {
    // 1. Fetch debtor account to get current ledger_version and aging_basis
    const debtorRes = await tx.query<{
      id: string;
      ledger_version: string | number;
      aging_basis: "due_date" | "calendar_period";
    }>(
      "SELECT id, ledger_version, aging_basis FROM debtor_account WHERE tenant_id = $1 AND id = $2",
      [tenantId, params.debtorAccountId],
    );
    if (debtorRes.rows.length === 0) {
      throw new Error(`Debtor account ${params.debtorAccountId} not found`);
    }

    const debtor = debtorRes.rows[0]!;
    const ledgerVersion = Number(debtor.ledger_version);
    const basis = params.basis ?? debtor.aging_basis ?? "due_date";

    // 2. Check if identical snapshot already exists
    const existingSnapRes = await tx.query<{
      id: string;
      debtor_account_id: string;
      as_of_date: string | Date;
      ledger_version: string | number;
      basis: "due_date" | "calendar_period";
      policy_version: number;
      unapplied_credit: string | number;
      net_balance: string | number;
      created_at: string | Date;
    }>(
      `SELECT id, debtor_account_id, as_of_date, ledger_version, basis, policy_version, unapplied_credit, net_balance, created_at
       FROM aging_snapshot
       WHERE tenant_id = $1
         AND debtor_account_id = $2
         AND as_of_date = $3
         AND ledger_version = $4
         AND basis = $5
         AND policy_version = $6`,
      [tenantId, params.debtorAccountId, params.asOfDate, ledgerVersion, basis, policyVersion],
    );

    if (existingSnapRes.rows.length > 0) {
      const snap = existingSnapRes.rows[0]!;
      const bucketsRes = await tx.query<{
        bucket: number;
        open_debit: string | number;
      }>(
        "SELECT bucket, open_debit FROM aging_bucket WHERE tenant_id = $1 AND aging_snapshot_id = $2 ORDER BY bucket ASC",
        [tenantId, snap.id],
      );

      const bucketRecord = Object.fromEntries(
        BUCKETS.map((b) => [b, "0.0000"]),
      ) as Record<Bucket, string>;

      let openDebitsTotal = 0n;
      for (const bRow of bucketsRes.rows) {
        const bName = BUCKETS[bRow.bucket];
        if (bName) {
          const val = formatMoney(parseMoney(String(bRow.open_debit)));
          bucketRecord[bName] = val;
          openDebitsTotal += parseMoney(val);
        }
      }

      return {
        id: snap.id,
        debtorAccountId: snap.debtor_account_id,
        asOfDate: snap.as_of_date instanceof Date ? snap.as_of_date.toISOString().slice(0, 10) : String(snap.as_of_date),
        ledgerVersion: Number(snap.ledger_version),
        basis: snap.basis,
        policyVersion: snap.policy_version,
        unappliedCredit: formatMoney(parseMoney(String(snap.unapplied_credit))),
        netBalance: formatMoney(parseMoney(String(snap.net_balance))),
        openDebits: formatMoney(openDebitsTotal),
        buckets: bucketRecord,
        createdAt: snap.created_at instanceof Date ? snap.created_at.toISOString() : String(snap.created_at),
      };
    }

    // 3. Query all documents up to asOfDate and active allocations effective on or before asOfDate
    const docQuery = `
      SELECT 
        d.id,
        d.direction,
        d.amount,
        d.due_on,
        d.issued_on,
        COALESCE(SUM(a.amount), 0) AS allocated_amount
      FROM document d
      LEFT JOIN allocation a ON (
        a.tenant_id = d.tenant_id AND
        (
          (d.direction = 'debit' AND a.debit_document_id = d.id) OR
          (d.direction = 'credit' AND a.credit_document_id = d.id)
        ) AND
        a.effective_date <= $3::date AND
        NOT EXISTS (
          SELECT 1 FROM allocation_reversal ar
          WHERE ar.tenant_id = a.tenant_id 
            AND ar.allocation_id = a.id
            AND ar.effective_date <= $3::date
        )
      )
      WHERE d.tenant_id = $1 
        AND d.debtor_account_id = $2 
        AND d.issued_on <= $3::date
      GROUP BY d.id, d.direction, d.amount, d.due_on, d.issued_on
      ORDER BY d.issued_on ASC, d.id ASC
    `;

    const docRes = await tx.query<{
      id: string;
      direction: "debit" | "credit";
      amount: string | number;
      due_on: string | Date | null;
      issued_on: string | Date;
      allocated_amount: string | number;
    }>(docQuery, [tenantId, params.debtorAccountId, params.asOfDate]);

    const openItems: OpenItem[] = [];
    let unappliedCreditUnits = 0n;

    for (const r of docRes.rows) {
      const docAmountUnits = parseMoney(String(r.amount));
      const allocatedUnits = parseMoney(String(r.allocated_amount));
      const remainingUnits = docAmountUnits - allocatedUnits;

      if (remainingUnits <= 0n) continue;

      if (r.direction === "debit") {
        const issuedStr = r.issued_on instanceof Date ? r.issued_on.toISOString().slice(0, 10) : String(r.issued_on);
        const dueStr = r.due_on
          ? (r.due_on instanceof Date ? r.due_on.toISOString().slice(0, 10) : String(r.due_on))
          : issuedStr;

        // Derive accounting period ordinal from issued date (year * 12 + month)
        const issuedDate = new Date(utcDay(issuedStr));
        const periodOrdinal = issuedDate.getUTCFullYear() * 12 + (issuedDate.getUTCMonth() + 1);

        openItems.push({
          documentId: r.id,
          remaining: formatMoney(remainingUnits),
          dueOn: dueStr,
          periodOrdinal,
        });
      } else {
        unappliedCreditUnits += remainingUnits;
      }
    }

    // Default asOfPeriodOrdinal
    const asOfDateObj = new Date(utcDay(params.asOfDate));
    const asOfPeriodOrdinal =
      params.asOfPeriodOrdinal ??
      asOfDateObj.getUTCFullYear() * 12 + (asOfDateObj.getUTCMonth() + 1);

    // 4. Calculate aging buckets
    const agingResult = calculateAging({
      basis,
      asOfDate: params.asOfDate,
      asOfPeriodOrdinal,
      openItems,
      unappliedCredit: formatMoney(unappliedCreditUnits),
    });

    // 5. Insert aging_snapshot
    const insSnap = await tx.query<{ id: string; created_at: string | Date }>(
      `INSERT INTO aging_snapshot (
        tenant_id, debtor_account_id, as_of_date, ledger_version,
        basis, policy_version, unapplied_credit, net_balance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, created_at`,
      [
        tenantId,
        params.debtorAccountId,
        params.asOfDate,
        ledgerVersion,
        basis,
        policyVersion,
        agingResult.unappliedCredit,
        agingResult.netBalance,
      ],
    );
    const snapshotId = insSnap.rows[0]!.id;
    const createdAtStr =
      insSnap.rows[0]!.created_at instanceof Date
        ? insSnap.rows[0]!.created_at.toISOString()
        : String(insSnap.rows[0]!.created_at);

    // 6. Insert 8 aging_bucket rows
    for (let bIndex = 0; bIndex < BUCKETS.length; bIndex++) {
      const bKey = BUCKETS[bIndex]!;
      const amount = agingResult.buckets[bKey]!;
      await tx.query(
        `INSERT INTO aging_bucket (
          tenant_id, aging_snapshot_id, bucket, open_debit
        ) VALUES ($1, $2, $3, $4)`,
        [tenantId, snapshotId, bIndex, amount],
      );
    }

    // 7. Atomic Outbox Event
    await tx.query(
      `INSERT INTO outbox (tenant_id, kind, aggregate_id, idempotency_key, payload)
       VALUES ($1, 'ledger/aging_snapshot_created', $2, $3, $4)`,
      [
        tenantId,
        snapshotId,
        `outbox:aging:${snapshotId}`,
        JSON.stringify({
          snapshotId,
          debtorAccountId: params.debtorAccountId,
          asOfDate: params.asOfDate,
          ledgerVersion,
          basis,
          openDebits: agingResult.openDebits,
          unappliedCredit: agingResult.unappliedCredit,
          netBalance: agingResult.netBalance,
        }),
      ],
    );

    return {
      id: snapshotId,
      debtorAccountId: params.debtorAccountId,
      asOfDate: params.asOfDate,
      ledgerVersion,
      basis,
      policyVersion,
      unappliedCredit: agingResult.unappliedCredit,
      netBalance: agingResult.netBalance,
      openDebits: agingResult.openDebits,
      buckets: agingResult.buckets,
      createdAt: createdAtStr,
    };
  });
}

/**
 * Retrieves the latest aging snapshot for a debtor account.
 */
export async function getLatestAgingSnapshot(
  db: DbClient,
  tenantId: string,
  debtorAccountId: string,
): Promise<AgingSnapshotRecord | null> {
  return withTenantContext(db, tenantId, async (tx) => {
    const snapRes = await tx.query<{
      id: string;
      debtor_account_id: string;
      as_of_date: string | Date;
      ledger_version: string | number;
      basis: "due_date" | "calendar_period";
      policy_version: number;
      unapplied_credit: string | number;
      net_balance: string | number;
      created_at: string | Date;
    }>(
      `SELECT id, debtor_account_id, as_of_date, ledger_version, basis, policy_version, unapplied_credit, net_balance, created_at
       FROM aging_snapshot
       WHERE tenant_id = $1 AND debtor_account_id = $2
       ORDER BY as_of_date DESC, ledger_version DESC, created_at DESC
       LIMIT 1`,
      [tenantId, debtorAccountId],
    );

    if (snapRes.rows.length === 0) {
      return null;
    }

    const snap = snapRes.rows[0]!;
    const bucketsRes = await tx.query<{
      bucket: number;
      open_debit: string | number;
    }>(
      "SELECT bucket, open_debit FROM aging_bucket WHERE tenant_id = $1 AND aging_snapshot_id = $2 ORDER BY bucket ASC",
      [tenantId, snap.id],
    );

    const bucketRecord = Object.fromEntries(
      BUCKETS.map((b) => [b, "0.0000"]),
    ) as Record<Bucket, string>;

    let openDebitsTotal = 0n;
    for (const bRow of bucketsRes.rows) {
      const bName = BUCKETS[bRow.bucket];
      if (bName) {
        const val = formatMoney(parseMoney(String(bRow.open_debit)));
        bucketRecord[bName] = val;
        openDebitsTotal += parseMoney(val);
      }
    }

    return {
      id: snap.id,
      debtorAccountId: snap.debtor_account_id,
      asOfDate: snap.as_of_date instanceof Date ? snap.as_of_date.toISOString().slice(0, 10) : String(snap.as_of_date),
      ledgerVersion: Number(snap.ledger_version),
      basis: snap.basis,
      policyVersion: snap.policy_version,
      unappliedCredit: formatMoney(parseMoney(String(snap.unapplied_credit))),
      netBalance: formatMoney(parseMoney(String(snap.net_balance))),
      openDebits: formatMoney(openDebitsTotal),
      buckets: bucketRecord,
      createdAt: snap.created_at instanceof Date ? snap.created_at.toISOString() : String(snap.created_at),
    };
  });
}
