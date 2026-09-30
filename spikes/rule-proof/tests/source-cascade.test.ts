import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allocateLegacyCreditsOldestFirst, BUCKETS, formatCents, parseCents, type BucketAmounts } from "../src/rules.ts";

// Literal signed-credit cascade from SysDEBBalance_ReCalc.pas:320-399.
function sourceCascade(debits: BucketAmounts, positiveCredit: string): BucketAmounts {
  let carriedCredit = -parseCents(positiveCredit);
  const result = {} as BucketAmounts;
  for (const bucket of [...BUCKETS].reverse()) {
    const remainder = carriedCredit + parseCents(debits[bucket]);
    result[bucket] = formatCents(remainder < 0n ? 0n : remainder);
    carriedCredit = remainder < 0n ? remainder : 0n;
  }
  result.current = formatCents(parseCents(result.current) + carriedCredit);
  return result;
}

test("all AGE fixtures agree with the observed signed-credit source cascade", () => {
  const fixtureFile = new URL("../../../tests/fixtures/genesis-rules.json", import.meta.url);
  const fixtures = JSON.parse(readFileSync(fixtureFile, "utf8")) as {
    cases: Array<{ id: string; kind: string; input: { debits: BucketAmounts; credit: string }; expected: { buckets: BucketAmounts; netBalance: string } }>;
  };
  const ageCases = fixtures.cases.filter((fixture) => fixture.kind === "legacy_oldest_first");
  assert.ok(ageCases.length > 0);
  for (const fixture of ageCases) {
    const observed = sourceCascade(fixture.input.debits, fixture.input.credit);
    assert.deepEqual(observed, fixture.expected.buckets, fixture.id);
    assert.deepEqual(allocateLegacyCreditsOldestFirst(fixture.input).buckets, observed, fixture.id);
    const net = BUCKETS.reduce((sum, bucket) => sum + parseCents(fixture.input.debits[bucket]), -parseCents(fixture.input.credit));
    assert.equal(formatCents(net), fixture.expected.netBalance, `${fixture.id}: conservation`);
  }
});

test("source cascade and proof agree across mixed bucket boundaries", () => {
  for (let scenario = 0; scenario < 128; scenario++) {
    const debits = Object.fromEntries(BUCKETS.map((bucket, index) => [bucket, formatCents(BigInt((scenario * 137 + index * 271) % 3000))])) as BucketAmounts;
    for (const credit of ["0.00", "0.01", "50.00", "500.00"]) {
      assert.deepEqual(allocateLegacyCreditsOldestFirst({ debits, credit }).buckets, sourceCascade(debits, credit));
    }
  }
});
