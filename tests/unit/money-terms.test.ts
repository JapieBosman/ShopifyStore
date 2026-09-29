import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMoney,
  formatMoney,
  requireNonnegative,
  requirePositive,
  quantizeMoney,
  quantizeForCurrency,
  formatDisplayCurrency,
  validateCurrency,
  assertSingleCurrency,
  SUPPORTED_CURRENCIES,
} from "../../packages/domain/src/money.ts";
import {
  calculateDueDate,
  getEndOfMonth,
  addDays,
  isLeapYear,
  getDaysInMonth,
  parseIsoDate,
  calculateDaysOverdue,
  bucketForDueDate,
  bucketForCalendarPeriod,
  assignAgingBucket,
  AGING_BUCKETS,
  type PaymentTerm,
} from "../../packages/domain/src/terms.ts";

test("decimal-string money parsing, formatting, and boundary guards", () => {
  // Plain decimal parsing with up to 4 places
  assert.equal(parseMoney("100"), 1000000n);
  assert.equal(parseMoney("100.5"), 1005000n);
  assert.equal(parseMoney("100.55"), 1005500n);
  assert.equal(parseMoney("100.555"), 1005550n);
  assert.equal(parseMoney("100.5555"), 1005555n);
  assert.equal(parseMoney("-100.5555"), -1005555n);
  assert.equal(formatMoney(1005555n), "100.5555");
  assert.equal(formatMoney(-1005555n), "-100.5555");

  // Exact arithmetic well above Number.MAX_SAFE_INTEGER
  const hugeUnits = parseMoney("9007199254740993.1700");
  assert.equal(formatMoney(hugeUnits), "9007199254740993.1700");

  // Rejection of invalid decimal formats
  assert.throws(() => parseMoney("100.12345"), RangeError); // 5 decimals
  assert.throws(() => parseMoney("NaN"), RangeError);
  assert.throws(() => parseMoney("1e5"), RangeError);
  assert.throws(() => parseMoney(""), RangeError);
  assert.throws(() => parseMoney("abc"), RangeError);

  // Nonnegative & Positive assertions
  assert.equal(requireNonnegative("0.0000", "Balance"), 0n);
  assert.equal(requireNonnegative("10.0000", "Balance"), 100000n);
  assert.throws(() => requireNonnegative("-0.0001", "Balance"), RangeError);

  assert.equal(requirePositive("0.0001", "Limit"), 1n);
  assert.throws(() => requirePositive("0.0000", "Limit"), RangeError);
  assert.throws(() => requirePositive("-10.0000", "Limit"), RangeError);
});

test("currency quantisation handles zero, two, and three-decimal ISO currencies", () => {
  // Two-decimal currencies (ZAR, USD, EUR, GBP)
  assert.equal(quantizeForCurrency("1.0040", "ZAR"), "1.0000");
  assert.equal(quantizeForCurrency("1.0050", "ZAR"), "1.0100");
  assert.equal(quantizeForCurrency("-1.0050", "USD"), "-1.0100");
  assert.equal(formatDisplayCurrency(parseMoney("1250.5000"), "USD"), "1250.50");

  // Zero-decimal currencies (JPY, KRW, VND)
  assert.equal(quantizeForCurrency("1250.4000", "JPY"), "1250.0000");
  assert.equal(quantizeForCurrency("1250.5000", "JPY"), "1251.0000");
  assert.equal(quantizeForCurrency("-1250.5000", "KRW"), "-1251.0000");
  assert.equal(formatDisplayCurrency(parseMoney("1250.0000"), "JPY"), "1250");

  // Three-decimal currencies (BHD, KWD, OMR)
  assert.equal(quantizeForCurrency("1.2344", "BHD"), "1.2340");
  assert.equal(quantizeForCurrency("1.2345", "BHD"), "1.2350");
  assert.equal(quantizeForCurrency("-1.2345", "KWD"), "-1.2350");
  assert.equal(formatDisplayCurrency(parseMoney("1.2350"), "BHD"), "1.235");
});

test("unsupported v1 currencies and mixed-currency operations are strictly rejected", () => {
  // Validate single currency helper
  assert.equal(assertSingleCurrency(["ZAR", "ZAR", "ZAR"]), "ZAR");
  assert.equal(assertSingleCurrency(["USD"]), "USD");

  // Mixed currency rejection
  assert.throws(
    () => assertSingleCurrency(["USD", "EUR"]),
    /Mixed-currency transaction rejected/,
  );
  assert.throws(
    () => assertSingleCurrency(["ZAR", "USD"]),
    /Mixed-currency transaction rejected/,
  );

  // Unsupported or invalid currency code rejection
  assert.throws(() => validateCurrency("BTC"), /Unsupported currency/);
  assert.throws(() => validateCurrency("USDD"), /Invalid currency code/);
  assert.throws(() => validateCurrency("12"), /Invalid currency code/);
  assert.throws(() => validateCurrency(""), /Invalid currency code/);
});

test("strict calendar date validation and leap year logic", () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2028), true);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2023), false);
  assert.equal(isLeapYear(2026), false);

  assert.equal(getDaysInMonth(2024, 2), 29);
  assert.equal(getDaysInMonth(2023, 2), 28);
  assert.equal(getDaysInMonth(2026, 4), 30);
  assert.equal(getDaysInMonth(2026, 1), 31);

  // Valid dates
  assert.doesNotThrow(() => parseIsoDate("2024-02-29")); // leap year
  assert.doesNotThrow(() => parseIsoDate("2026-04-30")); // 30-day month
  assert.doesNotThrow(() => parseIsoDate("2026-12-31")); // 31-day month

  // Invalid dates fail closed
  assert.throws(() => parseIsoDate("2023-02-29"), /month 2 has 28 days/);
  assert.throws(() => parseIsoDate("2026-04-31"), /month 4 has 30 days/);
  assert.throws(() => parseIsoDate("2026-02-30"), /month 2 has 28 days/);
  assert.throws(() => parseIsoDate("2026-13-01"), /Invalid month/);
  assert.throws(() => parseIsoDate("2026-00-10"), /Invalid month/);
  assert.throws(() => parseIsoDate("not-a-date"), /Invalid ISO date format/);
});

test("payment terms due date calculation across Net, COD, and EOM", () => {
  // 1. COD (Cash on Delivery)
  const codTerm: PaymentTerm = { code: "COD", kind: "cod", days: 0 };
  assert.equal(calculateDueDate("2026-03-15", codTerm), "2026-03-15");
  assert.throws(
    () => calculateDueDate("2026-03-15", { code: "BAD_COD", kind: "cod", days: 5 }),
    /COD payment terms must have 0 days/,
  );

  // 2. Net Days
  const net30: PaymentTerm = { code: "NET30", kind: "net_days", days: 30 };
  assert.equal(calculateDueDate("2026-01-15", net30), "2026-02-14");

  // Net days crossing February in non-leap year (2026)
  assert.equal(calculateDueDate("2026-01-31", net30), "2026-03-02");

  // Net days crossing February in leap year (2024)
  const net1: PaymentTerm = { code: "NET1", kind: "net_days", days: 1 };
  assert.equal(calculateDueDate("2024-02-28", net1), "2024-02-29"); // leap day
  assert.equal(calculateDueDate("2024-02-29", net1), "2024-03-01");
  assert.equal(calculateDueDate("2023-02-28", net1), "2023-03-01"); // non-leap

  // 3. End of Month (EOM)
  const eom0: PaymentTerm = { code: "EOM", kind: "end_of_month", days: 0 };
  assert.equal(calculateDueDate("2026-01-15", eom0), "2026-01-31");
  assert.equal(calculateDueDate("2026-04-10", eom0), "2026-04-30");
  assert.equal(calculateDueDate("2024-02-05", eom0), "2024-02-29"); // leap year Feb
  assert.equal(calculateDueDate("2023-02-05", eom0), "2023-02-28"); // non-leap Feb

  // EOM + 30 days
  const eom30: PaymentTerm = { code: "EOM30", kind: "end_of_month", days: 30 };
  // Non-leap year: Jan 31 + 30 days = March 2, 2026
  assert.equal(calculateDueDate("2026-01-15", eom30), "2026-03-02");
  // Leap year: Jan 31 + 30 days = March 1, 2024
  assert.equal(calculateDueDate("2024-01-15", eom30), "2024-03-01");
});

test("due-date aging buckets match all Genesis parity test fixtures (DUE-001..DUE-010)", () => {
  // DUE-001: Due in future -> current
  assert.equal(bucketForDueDate("2026-02-28", "2026-02-01"), "current");

  // DUE-002: Due today -> current
  assert.equal(bucketForDueDate("2026-02-28", "2026-02-28"), "current");

  // DUE-003: 1 day overdue -> d030
  assert.equal(bucketForDueDate("2026-02-28", "2026-03-01"), "d030");

  // DUE-004: 30 days overdue -> d030
  assert.equal(bucketForDueDate("2026-01-01", "2026-01-31"), "d030");

  // DUE-005: 31 days overdue -> d060
  assert.equal(bucketForDueDate("2026-01-01", "2026-02-01"), "d060");

  // DUE-006: 60 days overdue -> d060
  assert.equal(bucketForDueDate("2026-01-01", "2026-03-02"), "d060");

  // DUE-007: 61 days overdue -> d090
  assert.equal(bucketForDueDate("2026-01-01", "2026-03-03"), "d090");

  // DUE-008: 180 days overdue -> d180
  assert.equal(bucketForDueDate("2026-01-01", "2026-06-30"), "d180");

  // DUE-009: 181 days overdue -> over
  assert.equal(bucketForDueDate("2026-01-01", "2026-07-01"), "over");

  // DUE-010: 2024 leap year boundary (Feb 29 -> March 01 = 1 day overdue) -> d030
  assert.equal(bucketForDueDate("2024-02-29", "2024-03-01"), "d030");
});

test("versioned aging basis supports both due-date and calendar-period profiles", () => {
  // Due-date basis
  const dueResult = assignAgingBucket({
    basis: "due_date",
    dueDate: "2026-01-01",
    asOfDate: "2026-02-01",
  });
  assert.equal(dueResult, "d060");

  // Calendar-period basis
  const periodCurrent = assignAgingBucket({
    basis: "calendar_period",
    entryOrdinal: 10,
    asOfOrdinal: 10,
  });
  assert.equal(periodCurrent, "current");

  const period30 = assignAgingBucket({
    basis: "calendar_period",
    entryOrdinal: 9,
    asOfOrdinal: 10,
  });
  assert.equal(period30, "d030");

  const periodOver = assignAgingBucket({
    basis: "calendar_period",
    entryOrdinal: 1,
    asOfOrdinal: 10,
  });
  assert.equal(periodOver, "over");

  // Reject future periods
  assert.throws(
    () =>
      assignAgingBucket({
        basis: "calendar_period",
        entryOrdinal: 11,
        asOfOrdinal: 10,
      }),
    /cannot be after cutoff/,
  );
});
