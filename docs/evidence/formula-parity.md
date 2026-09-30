# Formula proof evidence
Started 2026-09-28. All examples are synthetic and include no merchant data. Finance review is pending; TASK-004 remains In progress.

## Frozen reference files
Genesis repository HEAD observed for this reference inspection: f425fbc92f8f5b93f22012f170ea47d9abbe5850. The hashes identify file contents, including any working-tree changes.

| Source path relative to C:/Github/GENESIS | SHA-256 | Anchor |
|---|---|---|
| System/DEB/SysDEBBalance_ReCalc.pas | 2a14e72897ab97dca3abee4c88067abc271bb8636d043c69bc609b87b046af52 | dbal_Calc_Period_Balances, lines 209–402 |
| System/DEB/SysDEBCalcAgeing.pas | bb732ed77c1a10a04d97d678b7b9c6773f5fbd3b6f61f53916b5cb69d2167ea3 | sdca_ProcessTxans, lines 98–221 |
| System/DEB/SysDEBCalcBalance.pas | d8b6daeef90b742606181bc6ebd40eb6b4d21b3973138125310a9567dee2a899 | roll-forward and backdating |
| System/DEB/SysDEBPayments.pas | bbf1b52850aa43ad82341042deee782805b12b9aa7f213514aa8082dca25a3d3 | payment posting |
| genTIL/Forms/VTILL001.pas | 15a121da40d1b92e6f4897371354ad4923aa80be108aa2f068e90387ec981033 | hold and credit checks, lines 757–1013; PO rule, 1275–1290 |
| genCOF/Forms/COF010.pas | 096ee159e2a4c31ef751171e97e4674f94f548baa75eea9fd8eb12821912bb15 | tender and pickup arithmetic, lines 233–264 |
| genCOF/Forms/COF220.pas | 2d4fc130228bc5f4b3a14f5a0173f44ec5c2bc0230be669b8a9d7becb716fd0e | shortage handling, lines 6116–6257 |

## Implemented exploratory proof
- [Fixture file](../../tests/fixtures/genesis-rules.json): 44 hand-specified synthetic cases.
- [Rule harness](../../spikes/rule-proof/src/rules.ts): integer-cent arithmetic and pure functions; no database, server or Shopify dependencies.
- [Runner](../../spikes/rule-proof/tests/rules.test.ts): Node built-in test framework. From spikes/rule-proof run `npm test`.
- Result on Node v24.21.0: 47 passed, 0 failed on 2026-09-28.

AGE and PER scenarios directly check the observed legacy oldest-first credit cascade and eight period buckets. The overpayment example is invoice 10, payment 40, legacy current -30, with separate unapplied credit 30. DUE, CASH and REV scenarios are **new product policies**, not claims of exact Delphi parity. The production ledger should hold unapplied credit separately and calculate net -30; it should not store a negative invoice as an open item.

## Review still required
A Genesis finance/domain reviewer must verify the source interpretation, expected outputs and any policy changes, especially statement newest-first presentation versus immutable allocation, rounding at three versus two decimals, credit notes, partial payment, interest and tender-integrity refunds. The prototype supports two-decimal currencies only; production money design supports currency-specific precision. No production posting code or database migration was created in this step.

The old OnlineVersion test expected a positive current amount after excess payment. That conflicts with the observed Delphi cascade at line 399 and with the new product signed balance convention. This proof intentionally expects -30.

# Technical source review — 2026-09-30

All seven recorded Genesis source SHA256 values were recomputed and still match. The 44 fixtures comprise 27 source-derived cases (17 AGE and 10 PER) and 17 proposed product-policy cases (10 DUE, 4 CASH, 3 REV). Independent financial approval remains pending.

`spikes/rule-proof/tests/source-cascade.test.ts` implements a separate signed-credit cascade from `SysDEBBalance_ReCalc.pas` lines 320–399. It checks all AGE fixtures plus 512 generated comparisons and net conservation. Excess credit remains negative in the current bucket/net balance. Validation: `npm test --prefix spikes/rule-proof` passed 49 tests; `node --test tests/unit/money-terms.test.ts` passed 9 tests.

`SysDEBCalcAgeing.pas` lines 98–222 reconstructs balances newest first and updates legacy transaction Balance/PaidAmount fields. That is evidence of legacy reconstruction, not permission to mutate the new immutable ledger during statement generation.

`COF010.pas` lines 233–264 calculates all-tender availability separately from cash remaining. CASH fixtures define a cash-only product policy and cannot be presented as exact parity with that all-tender calculation. Due-date ageing also remains distinct from Genesis accounting-period ageing. Unresolved legacy reversals and automatic interest remain excluded.

