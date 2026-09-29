import assert from "node:assert/strict";
import test from "node:test";
import { calculateAging } from "../src/aging.ts";
import {
  planExplicitAllocation,
  planOldestFirstAllocation,
  type OpenDocument,
} from "../src/allocation.ts";
import { evaluateCredit } from "../src/credit.ts";
import { validateJournal } from "../src/journal.ts";
import { formatMoney, parseMoney, quantizeMoney } from "../src/money.ts";

const accountId = "account-1";
const creditDocument: OpenDocument = {
  id: "payment-1",
  debtorAccountId: accountId,
  currency: "ZAR",
  issuedOn: "2026-09-01",
  documentNumber: "PMT-1",
  remaining: "40.0000",
};

test("money uses exact decimal units and explicit rounding", () => {
  assert.equal(
    formatMoney(parseMoney("9007199254740993.17")),
    "9007199254740993.1700",
  );
  assert.equal(formatMoney(quantizeMoney(parseMoney("1.0050"), 2)), "1.0100");
  assert.equal(formatMoney(quantizeMoney(parseMoney("-1.0050"), 2)), "-1.0100");
  assert.throws(() => parseMoney("NaN"), RangeError);
  assert.throws(() => parseMoney("1.00001"), RangeError);
});

test("a credit sale posts a balanced receivable journal", () => {
  const journal = validateJournal({
    currency: "ZAR",
    sourceKey: "shopify-order-1",
    lines: [
      { accountCode: "AR", debit: "115.00", credit: "0" },
      { accountCode: "SALES_CLEARING", debit: "0", credit: "115.00" },
    ],
  });
  assert.equal(journal.total, "115.0000");
});

test("an unbalanced or double-sided journal is rejected", () => {
  assert.throws(() => validateJournal({
    currency: "ZAR",
    sourceKey: "bad",
    lines: [
      { accountCode: "AR", debit: "115.00", credit: "0" },
      { accountCode: "SALES_CLEARING", debit: "0", credit: "114.99" },
    ],
  }), /balance/);
  assert.throws(() => validateJournal({
    currency: "ZAR",
    sourceKey: "bad",
    lines: [
      { accountCode: "AR", debit: "1", credit: "1" },
      { accountCode: "SALES_CLEARING", debit: "0", credit: "1" },
    ],
  }), /exactly one/);
});

test("oldest-first allocation retains overpayment as unapplied credit", () => {
  const invoices: OpenDocument[] = [
    { id: "new", debtorAccountId: accountId, currency: "ZAR", issuedOn: "2026-09-03", documentNumber: "INV-2", remaining: "20.00" },
    { id: "old", debtorAccountId: accountId, currency: "ZAR", issuedOn: "2026-09-01", documentNumber: "INV-1", remaining: "10.00" },
  ];
  const plan = planOldestFirstAllocation(creditDocument, invoices);
  assert.deepStrictEqual(plan, {
    lines: [
      { debitDocumentId: "old", amount: "10.0000" },
      { debitDocumentId: "new", amount: "20.0000" },
    ],
    unappliedCredit: "10.0000",
  });
});

test("allocation rejects cross-account and excessive amounts", () => {
  const invoice = { id: "invoice-1", debtorAccountId: accountId, currency: "ZAR", issuedOn: "2026-09-01", documentNumber: "INV-1", remaining: "10.00" };
  assert.throws(
    () => planExplicitAllocation(creditDocument, invoice, "11.00"),
    /exceeds/,
  );
  assert.throws(
    () => planExplicitAllocation(
      creditDocument,
      { ...invoice, debtorAccountId: "other-account" },
      "1.00",
    ),
    /one account/,
  );
});

test("ageing keeps open debit and unapplied credit separate", () => {
  const result = calculateAging({
    basis: "due_date",
    asOfDate: "2026-09-28",
    asOfPeriodOrdinal: 9,
    openItems: [
      { documentId: "old", remaining: "10.00", dueOn: "2026-08-28", periodOrdinal: 8 },
      { documentId: "current", remaining: "20.00", dueOn: "2026-10-01", periodOrdinal: 9 },
    ],
    unappliedCredit: "40.00",
  });
  assert.equal(result.buckets.d060, "10.0000");
  assert.equal(result.buckets.current, "20.0000");
  assert.equal(result.netBalance, "-10.0000");
  assert.equal(result.unappliedCredit, "40.0000");
});

test("calendar period ageing is independent of due-date ageing", () => {
  const result = calculateAging({
    basis: "calendar_period",
    asOfDate: "2026-09-28",
    asOfPeriodOrdinal: 9,
    openItems: [
      { documentId: "invoice", remaining: "12.00", dueOn: "2026-12-01", periodOrdinal: 7 },
    ],
    unappliedCredit: "0",
  });
  assert.equal(result.buckets.d060, "12.0000");
  assert.equal(result.buckets.current, "0.0000");
});

test("credit exposure includes reservations and only confirmed deposits", () => {
  const decision = evaluateCredit({
    status: "active",
    limit: "100.00",
    netBalance: "20.00",
    pendingReservations: "30.00",
    requestedCredit: "60.00",
    confirmedDeposit: "5.00",
  });
  assert.deepStrictEqual(decision, {
    kind: "requires_override",
    shortfall: "5.0000",
    exposureAfter: "105.0000",
  });
});

test("verified account credit offsets exposure, while a hold blocks sale", () => {
  const base = {
    status: "active" as const,
    limit: "100.00",
    netBalance: "-30.00",
    pendingReservations: "0",
    requestedCredit: "110.00",
    confirmedDeposit: "0",
  };
  assert.deepStrictEqual(evaluateCredit(base), {
    kind: "approved",
    availableAfter: "20.0000",
    exposureAfter: "80.0000",
  });
  assert.deepStrictEqual(evaluateCredit({ ...base, status: "hold" }), {
    kind: "blocked",
    reason: "hold",
  });
});

