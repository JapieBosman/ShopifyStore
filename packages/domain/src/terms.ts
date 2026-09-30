const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

export type PaymentTermKind = "cod" | "net_days" | "end_of_month";

export interface PaymentTerm {
  code: string;
  kind: PaymentTermKind;
  days: number;
}

export type AgingBasis = "due_date" | "calendar_period";

export const AGING_BUCKETS = [
  "current",
  "d030",
  "d060",
  "d090",
  "d120",
  "d150",
  "d180",
  "over",
] as const;

export type BucketName = (typeof AGING_BUCKETS)[number];

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    throw new RangeError(`Month must be between 1 and 12, got ${month}`);
  }
  const daysMap = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return daysMap[month - 1]!;
}

export function parseIsoDate(dateStr: string): {
  year: number;
  month: number;
  day: number;
  utc: number;
} {
  const match = ISO_DATE_PATTERN.exec(dateStr);
  if (!match) {
    throw new RangeError(`Invalid ISO date format: '${dateStr}'. Expected YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1) {
    throw new RangeError(`Invalid year in date '${dateStr}': must be 0001-9999`);
  }

  if (month < 1 || month > 12) {
    throw new RangeError(`Invalid month in date '${dateStr}': must be 01-12`);
  }

  const maxDays = getDaysInMonth(year, month);
  if (day < 1 || day > maxDays) {
    throw new RangeError(
      `Invalid day in date '${dateStr}': month ${month} has ${maxDays} days`,
    );
  }

  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(0, 0, 0, 0);
  const utc = parsed.getTime();
  return { year, month, day, utc };
}

export function formatIsoDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr: string, days: number): string {
  if (!Number.isSafeInteger(days)) {
    throw new RangeError("Day offset must be a safe integer");
  }
  const { utc } = parseIsoDate(dateStr);
  const targetUtc = utc + days * MILLISECONDS_PER_DAY;
  const target = new Date(targetUtc);
  if (!Number.isFinite(targetUtc) || target.getUTCFullYear() < 1 || target.getUTCFullYear() > 9999) {
    throw new RangeError("Resulting date must be within 0001-9999");
  }
  return formatIsoDate(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
  );
}

/**
 * Returns the last calendar date of the month for the given date.
 */
export function getEndOfMonth(dateStr: string): string {
  const { year, month } = parseIsoDate(dateStr);
  const lastDay = getDaysInMonth(year, month);
  return formatIsoDate(year, month, lastDay);
}

/**
 * Calculates due date based on payment terms:
 * - 'cod': due immediately on the issued date (days must be 0)
 * - 'net_days': issued date + days
 * - 'end_of_month': last day of issued month + days
 */
export function calculateDueDate(issuedDate: string, term: PaymentTerm): string {
  parseIsoDate(issuedDate);
  if (!Number.isSafeInteger(term.days)) {
    throw new RangeError("Payment term days must be a safe integer");
  }
  if (term.days < 0) {
    throw new RangeError(`Payment term days cannot be negative: ${term.days}`);
  }

  switch (term.kind) {
    case "cod":
      if (term.days !== 0) {
        throw new RangeError(`COD payment terms must have 0 days, got ${term.days}`);
      }
      return issuedDate;

    case "net_days":
      return addDays(issuedDate, term.days);

    case "end_of_month": {
      const eom = getEndOfMonth(issuedDate);
      return addDays(eom, term.days);
    }

    default: {
      const invalidKind: never = term.kind;
      throw new RangeError(`Unsupported payment term kind: '${invalidKind}'`);
    }
  }
}

/**
 * Calculates elapsed days overdue between a due date and an as-of cutoff date.
 * Returns <= 0 if the invoice is not yet due (or due today).
 */
export function calculateDaysOverdue(dueDate: string, asOfDate: string): number {
  const due = parseIsoDate(dueDate);
  const asOf = parseIsoDate(asOfDate);
  return Math.floor((asOf.utc - due.utc) / MILLISECONDS_PER_DAY);
}

/**
 * Assigns an invoice to one of the 8 standard due-date aging buckets.
 */
export function bucketForDueDate(dueDate: string, asOfDate: string): BucketName {
  const daysOverdue = calculateDaysOverdue(dueDate, asOfDate);
  if (daysOverdue <= 0) {
    return "current";
  }
  const index = Math.min(Math.ceil(daysOverdue / 30), AGING_BUCKETS.length - 1);
  return AGING_BUCKETS[index]!;
}

/**
 * Assigns an entry to an aging bucket based on accounting calendar period ordinals.
 */
export function bucketForCalendarPeriod(entryOrdinal: number, asOfOrdinal: number): BucketName {
  if (!Number.isSafeInteger(entryOrdinal) || !Number.isSafeInteger(asOfOrdinal)) {
    throw new RangeError("Period ordinals must be safe integers");
  }
  if (entryOrdinal > asOfOrdinal) {
    throw new RangeError(`Entry period (${entryOrdinal}) cannot be after cutoff (${asOfOrdinal})`);
  }
  const diff = asOfOrdinal - entryOrdinal;
  const index = Math.min(diff, AGING_BUCKETS.length - 1);
  return AGING_BUCKETS[index]!;
}

/**
 * Versioned aging assignment supporting both due-date and calendar-period aging basis.
 */
export function assignAgingBucket(
  options:
    | { basis: "due_date"; dueDate: string; asOfDate: string }
    | { basis: "calendar_period"; entryOrdinal: number; asOfOrdinal: number },
): BucketName {
  if (options.basis === "due_date") {
    return bucketForDueDate(options.dueDate, options.asOfDate);
  }
  return bucketForCalendarPeriod(options.entryOrdinal, options.asOfOrdinal);
}
