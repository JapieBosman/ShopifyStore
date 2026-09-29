import { createHash } from "node:crypto";
import { formatMoney, parseMoney } from "./money.ts";
import { bucketForDueDate, type BucketName } from "./terms.ts";

export interface StatementAgingSummary {
  basis: "due_date" | "calendar_period";
  asOfDate: string;
  current: string;
  d030: string;
  d060: string;
  d090: string;
  d120: string;
  d150: string;
  d180: string;
  over: string;
  total: string;
  unappliedCredit: string;
  netBalance: string;
}

export interface StatementDocumentItem {
  id: string;
  documentNumber: string;
  documentType: "invoice" | "credit_note" | "payment" | "journal";
  direction: "debit" | "credit";
  issuedOn: string;
  dueOn: string;
  recordedAt: string; // ISO timestamp
  amount: string;
  allocatedAmount: string;
  openAmount: string;
  currency: string;
  reference?: string;
}

export interface StatementTotals {
  openingBalance: string;
  totalDebits: string;
  totalCredits: string;
  closingBalance: string;
  currency: string;
}

export interface StatementMerchantInfo {
  businessName: string;
  tradingAddress: string;
  taxNumber?: string;
  contactEmail: string;
  contactPhone: string;
  bankDetails: {
    bankName: string;
    accountNumber: string;
    branchCode: string;
    accountType: string;
    reference: string;
  };
}

export interface StatementCustomerInfo {
  debtorAccountId: string;
  accountNumber: string;
  name: string;
  shopifyCustomerId: string;
  contactEmail: string;
  contactPhone: string;
  billingAddress?: string;
}

export interface StatementData {
  statementId: string;
  statementRunId: string;
  periodFrom: string;
  periodTo: string;
  cutoffRecordedAt: string;
  generation: number;
  merchant: StatementMerchantInfo;
  customer: StatementCustomerInfo;
  totals: StatementTotals;
  aging: StatementAgingSummary;
  items: StatementDocumentItem[];
  ledgerVersion: number;
  policyVersion: number;
  pdfSha256: string;
  createdAt: string;
}

/**
 * Filters documents for a statement run based on date interval and cutoff timestamp.
 * Invariant: Any document recorded after cutoffRecordedAt is excluded, ensuring
 * historical statement snapshots remain immutable even if transactions are backdated later.
 */
export function filterDocumentsForStatement(
  allDocuments: StatementDocumentItem[],
  periodFrom: string,
  periodTo: string,
  cutoffRecordedAt: string,
): {
  openingItems: StatementDocumentItem[];
  periodItems: StatementDocumentItem[];
} {
  const cutoffTime = new Date(cutoffRecordedAt).getTime();

  // Valid documents up to cutoff
  const eligible = allDocuments.filter((doc) => {
    const recTime = new Date(doc.recordedAt).getTime();
    return recTime <= cutoffTime;
  });

  const openingItems: StatementDocumentItem[] = [];
  const periodItems: StatementDocumentItem[] = [];

  for (const doc of eligible) {
    if (doc.issuedOn < periodFrom) {
      openingItems.push(doc);
    } else if (doc.issuedOn <= periodTo) {
      periodItems.push(doc);
    }
    // Items issued after periodTo are excluded
  }

  // Sort period items chronologically
  periodItems.sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.documentNumber.localeCompare(b.documentNumber));

  return { openingItems, periodItems };
}

/**
 * Calculates opening, debit, credit, and closing totals.
 * Invariant: closingBalance = openingBalance + debits - credits
 */
export function calculateStatementTotals(
  openingItems: StatementDocumentItem[],
  periodItems: StatementDocumentItem[],
  currency: string,
): StatementTotals {
  let openingUnits = 0n;
  for (const item of openingItems) {
    const units = parseMoney(item.amount);
    if (item.direction === "debit") {
      openingUnits += units;
    } else {
      openingUnits -= units;
    }
  }

  let debitsUnits = 0n;
  let creditsUnits = 0n;

  for (const item of periodItems) {
    const units = parseMoney(item.amount);
    if (item.direction === "debit") {
      debitsUnits += units;
    } else {
      creditsUnits += units;
    }
  }

  const closingUnits = openingUnits + debitsUnits - creditsUnits;

  return {
    openingBalance: formatMoney(openingUnits),
    totalDebits: formatMoney(debitsUnits),
    totalCredits: formatMoney(creditsUnits),
    closingBalance: formatMoney(closingUnits),
    currency,
  };
}

/**
 * Calculates 8-bucket due-date aging for open documents as of periodTo.
 */
export function calculateStatementAging(
  openDocuments: StatementDocumentItem[],
  periodTo: string,
): StatementAgingSummary {
  const buckets: Record<BucketName, bigint> = {
    current: 0n,
    d030: 0n,
    d060: 0n,
    d090: 0n,
    d120: 0n,
    d150: 0n,
    d180: 0n,
    over: 0n,
  };

  let unappliedUnits = 0n;
  let totalDebitsUnits = 0n;

  for (const doc of openDocuments) {
    const openUnits = parseMoney(doc.openAmount);
    if (openUnits <= 0n) continue;

    if (doc.direction === "credit") {
      unappliedUnits += openUnits;
    } else {
      totalDebitsUnits += openUnits;
      const bucket = bucketForDueDate(doc.dueOn, periodTo);
      buckets[bucket] = (buckets[bucket] ?? 0n) + openUnits;
    }
  }

  const netUnits = totalDebitsUnits - unappliedUnits;

  return {
    basis: "due_date",
    asOfDate: periodTo,
    current: formatMoney(buckets.current),
    d030: formatMoney(buckets.d030),
    d060: formatMoney(buckets.d060),
    d090: formatMoney(buckets.d090),
    d120: formatMoney(buckets.d120),
    d150: formatMoney(buckets.d150),
    d180: formatMoney(buckets.d180),
    over: formatMoney(buckets.over),
    total: formatMoney(totalDebitsUnits),
    unappliedCredit: formatMoney(unappliedUnits),
    netBalance: formatMoney(netUnits),
  };
}

/**
 * Computes a deterministic SHA-256 hash for the statement payload and rendered artifact.
 */
export function computeStatementSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Assembles and verifies full statement data with control invariants.
 */
export function buildStatementData(params: {
  statementId: string;
  statementRunId: string;
  periodFrom: string;
  periodTo: string;
  cutoffRecordedAt: string;
  generation: number;
  merchant: StatementMerchantInfo;
  customer: StatementCustomerInfo;
  allDocuments: StatementDocumentItem[];
  openDocumentsAtCutoff: StatementDocumentItem[];
  ledgerVersion: number;
  policyVersion: number;
  currency: string;
}): StatementData {
  const { openingItems, periodItems } = filterDocumentsForStatement(
    params.allDocuments,
    params.periodFrom,
    params.periodTo,
    params.cutoffRecordedAt,
  );

  const totals = calculateStatementTotals(openingItems, periodItems, params.currency);
  const aging = calculateStatementAging(params.openDocumentsAtCutoff, params.periodTo);

  // Invariant verification: closingBalance = opening + debits - credits
  const op = parseMoney(totals.openingBalance);
  const deb = parseMoney(totals.totalDebits);
  const cred = parseMoney(totals.totalCredits);
  const close = parseMoney(totals.closingBalance);
  if (close !== op + deb - cred) {
    throw new RangeError("Statement control balance invariant failed: closing != opening + debits - credits");
  }

  // Canonical payload for deterministic hash
  const canonicalPayload = JSON.stringify({
    statementId: params.statementId,
    debtorAccountId: params.customer.debtorAccountId,
    accountNumber: params.customer.accountNumber,
    periodFrom: params.periodFrom,
    periodTo: params.periodTo,
    cutoffRecordedAt: params.cutoffRecordedAt,
    generation: params.generation,
    totals,
    aging,
    itemCount: periodItems.length,
    ledgerVersion: params.ledgerVersion,
  });

  const pdfSha256 = computeStatementSha256(canonicalPayload);

  return {
    statementId: params.statementId,
    statementRunId: params.statementRunId,
    periodFrom: params.periodFrom,
    periodTo: params.periodTo,
    cutoffRecordedAt: params.cutoffRecordedAt,
    generation: params.generation,
    merchant: params.merchant,
    customer: params.customer,
    totals,
    aging,
    items: periodItems,
    ledgerVersion: params.ledgerVersion,
    policyVersion: params.policyVersion,
    pdfSha256,
    createdAt: new Date().toISOString(),
  };
}
