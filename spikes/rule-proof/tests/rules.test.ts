import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  allocateLegacyCreditsOldestFirst,
  bucketDebitsByAccountingPeriod,
  bucketForDaysOverdue,
  expectedCash,
  formatCents,
  parseCents,
  reverseSignedBalance,
  type BucketAmounts,
  type CashExpectedInput,
  type PeriodDebit,
} from "../src/rules.ts";

type Fixture =
  | {
      id: string;
      kind: "legacy_oldest_first";
      input: { debits: BucketAmounts; credit: string };
      expected: {
        buckets: BucketAmounts;
        unappliedCredit: string;
        netBalance: string;
      };
    }
  | {
      id: string;
      kind: "accounting_period";
      input: { asOfOrdinal: number; debits: PeriodDebit[] };
      expected: { buckets: BucketAmounts };
    }
  | {
      id: string;
      kind: "due_date_policy";
      input: { dueDate: string; asOfDate: string };
      expected: { bucket: string };
    }
  | {
      id: string;
      kind: "cash_expected_policy";
      input: CashExpectedInput;
      expected: { amount: string };
    }
  | {
      id: string;
      kind: "signed_reversal_policy";
      input: { originalBalance: string; reversalAmount: string };
      expected: { balance: string };
    };

const fixturePath = fileURLToPath(
  new URL("../../../tests/fixtures/genesis-rules.json", import.meta.url),
);
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  cases: Fixture[];
};

for (const fixture of fixtures.cases) {
  test(fixture.id, () => {
    switch (fixture.kind) {
      case "legacy_oldest_first":
        assert.deepStrictEqual(
          allocateLegacyCreditsOldestFirst(fixture.input),
          fixture.expected,
        );
        break;
      case "accounting_period":
        assert.deepStrictEqual(
          { buckets: bucketDebitsByAccountingPeriod(
            fixture.input.asOfOrdinal,
            fixture.input.debits,
          ) },
          fixture.expected,
        );
        break;
      case "due_date_policy":
        assert.equal(
          bucketForDaysOverdue(
            fixture.input.dueDate,
            fixture.input.asOfDate,
          ),
          fixture.expected.bucket,
        );
        break;
      case "cash_expected_policy":
        assert.deepStrictEqual(
          { amount: expectedCash(fixture.input) },
          fixture.expected,
        );
        break;
      case "signed_reversal_policy":
        assert.deepStrictEqual(
          { balance: reverseSignedBalance(
            fixture.input.originalBalance,
            fixture.input.reversalAmount,
          ) },
          fixture.expected,
        );
        break;
      default:
        assert.fail("Unknown fixture kind");
    }
  });
}

test("money stays exact above the safe JavaScript number range", () => {
  assert.equal(
    formatCents(parseCents("9007199254740993.17")),
    "9007199254740993.17",
  );
});

test("invalid money, future periods, and invalid dates fail closed", () => {
  assert.throws(() => parseCents("1.001"), RangeError);
  assert.throws(() => parseCents("1e3"), RangeError);
  assert.throws(
    () => bucketDebitsByAccountingPeriod(12, [{ ordinal: 13, amount: "1.00" }]),
    RangeError,
  );
  assert.throws(() => bucketForDaysOverdue("2026-02-30", "2026-03-01"), RangeError);
});

test("negative credit and debit buckets fail closed", () => {
  const zero = Object.fromEntries(
    ["current", "d030", "d060", "d090", "d120", "d150", "d180", "over"]
      .map((bucket) => [bucket, "0.00"]),
  ) as BucketAmounts;
  assert.throws(
    () => allocateLegacyCreditsOldestFirst({ debits: zero, credit: "-1.00" }),
    RangeError,
  );
  assert.throws(
    () => allocateLegacyCreditsOldestFirst({
      debits: { ...zero, over: "-1.00" },
      credit: "0.00",
    }),
    RangeError,
  );
});

