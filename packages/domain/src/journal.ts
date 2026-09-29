import { formatMoney, requireNonnegative, requirePositive } from "./money.ts";

export interface JournalLineInput {
  accountCode: string;
  debit: string;
  credit: string;
}

export interface JournalInput {
  currency: string;
  sourceKey: string;
  lines: readonly JournalLineInput[];
}

export interface ValidatedJournal {
  currency: string;
  sourceKey: string;
  lines: readonly JournalLineInput[];
  total: string;
}

export function validateJournal(input: JournalInput): ValidatedJournal {
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new RangeError("Journal currency must be a three-letter ISO code");
  }
  if (!input.sourceKey.trim() || input.lines.length < 2) {
    throw new RangeError("Journal needs a source key and at least two lines");
  }

  let debits = 0n;
  let credits = 0n;
  for (const line of input.lines) {
    if (!line.accountCode.trim()) {
      throw new RangeError("Journal account code is required");
    }
    const debit = requireNonnegative(line.debit, "Debit");
    const credit = requireNonnegative(line.credit, "Credit");
    if ((debit > 0n) === (credit > 0n)) {
      throw new RangeError("Each line must have exactly one positive debit or credit");
    }
    debits += debit;
    credits += credit;
  }

  if (debits !== credits) {
    throw new RangeError("Journal debits and credits must balance");
  }
  return {
    currency: input.currency,
    sourceKey: input.sourceKey,
    lines: input.lines,
    total: formatMoney(requirePositive(formatMoney(debits), "Journal total")),
  };
}

