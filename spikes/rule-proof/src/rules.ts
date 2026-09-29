export const BUCKETS = [
  "current", "d030", "d060", "d090", "d120", "d150", "d180", "over",
] as const;

export type Bucket = (typeof BUCKETS)[number];
export type BucketAmounts = Record<Bucket, string>;
type CentsByBucket = Record<Bucket, bigint>;

const MONEY_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

export function parseCents(amount: string): bigint {
  if (!MONEY_PATTERN.test(amount)) {
    throw new RangeError(`Invalid two-decimal money amount: ${amount}`);
  }

  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole, fraction = ""] = unsigned.split(".");
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -cents : cents;
}

export function formatCents(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  const sign = cents < 0n ? "-" : "";
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function emptyBuckets(): CentsByBucket {
  return Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0n])) as CentsByBucket;
}

function formatBuckets(amounts: CentsByBucket): BucketAmounts {
  return Object.fromEntries(
    BUCKETS.map((bucket) => [bucket, formatCents(amounts[bucket])]),
  ) as BucketAmounts;
}

export interface LegacyAllocationInput {
  debits: BucketAmounts;
  credit: string;
}

export interface LegacyAllocationResult {
  buckets: BucketAmounts;
  unappliedCredit: string;
  netBalance: string;
}

export function allocateLegacyCreditsOldestFirst(
  input: LegacyAllocationInput,
): LegacyAllocationResult {
  let remainingCredit = parseCents(input.credit);
  if (remainingCredit < 0n) {
    throw new RangeError("Credit must be nonnegative");
  }

  const balances = emptyBuckets();
  for (const bucket of [...BUCKETS].reverse()) {
    const debit = parseCents(input.debits[bucket]);
    if (debit < 0n) {
      throw new RangeError(`Debit bucket ${bucket} must be nonnegative`);
    }

    const applied = debit < remainingCredit ? debit : remainingCredit;
    balances[bucket] = debit - applied;
    remainingCredit -= applied;
  }

  const netBalance = BUCKETS.reduce(
    (total, bucket) => total + balances[bucket],
    -remainingCredit,
  );
  balances.current -= remainingCredit;

  return {
    buckets: formatBuckets(balances),
    unappliedCredit: formatCents(remainingCredit),
    netBalance: formatCents(netBalance),
  };
}

export interface PeriodDebit {
  ordinal: number;
  amount: string;
}

export function bucketDebitsByAccountingPeriod(
  asOfOrdinal: number,
  debits: PeriodDebit[],
): BucketAmounts {
  if (!Number.isSafeInteger(asOfOrdinal)) {
    throw new RangeError("Accounting period ordinal must be a safe integer");
  }

  const balances = emptyBuckets();
  for (const entry of debits) {
    if (!Number.isSafeInteger(entry.ordinal) || entry.ordinal > asOfOrdinal) {
      throw new RangeError("Debit period must be a safe integer at or before cutoff");
    }
    const debit = parseCents(entry.amount);
    if (debit < 0n) {
      throw new RangeError("Debit must be nonnegative");
    }

    const age = Math.min(asOfOrdinal - entry.ordinal, BUCKETS.length - 1);
    balances[BUCKETS[age]!] += debit;
  }
  return formatBuckets(balances);
}

function parseIsoDate(value: string): number {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`Invalid ISO date: ${value}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const parsed = new Date(utc);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return utc;
}

export function bucketForDaysOverdue(
  dueDate: string,
  asOfDate: string,
): Bucket {
  const due = parseIsoDate(dueDate);
  const asOf = parseIsoDate(asOfDate);
  const daysOverdue = Math.floor((asOf - due) / MILLISECONDS_PER_DAY);
  if (daysOverdue <= 0) {
    return "current";
  }
  return BUCKETS[Math.min(Math.ceil(daysOverdue / 30), BUCKETS.length - 1)]!;
}

export interface CashExpectedInput {
  openingFloat: string;
  cashSales: string;
  cashReceipts: string;
  paidIn: string;
  cashRefunds: string;
  paidOut: string;
  cashDrops: string;
}

export function expectedCash(input: CashExpectedInput): string {
  const positive = [
    input.openingFloat, input.cashSales, input.cashReceipts, input.paidIn,
  ].reduce((total, amount) => total + parseCents(amount), 0n);
  const negative = [
    input.cashRefunds, input.paidOut, input.cashDrops,
  ].reduce((total, amount) => total + parseCents(amount), 0n);
  return formatCents(positive - negative);
}

export function reverseSignedBalance(
  originalBalance: string,
  reversalAmount: string,
): string {
  return formatCents(parseCents(originalBalance) - parseCents(reversalAmount));
}

