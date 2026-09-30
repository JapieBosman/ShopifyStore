# Debtor rules review brief

Prepared 2026-09-30. Independent approval remains pending.

Ask your existing bookkeeper/accountant for a debtor ledger review, or find a South African accountant at https://www.saipa.co.za/find-an-accountant/. Someone familiar with Genesis can confirm the legacy interpretation. Shopify programming knowledge is unnecessary.

Suggested request: Please review the synthetic debtor examples, balance signs, receipt allocation, reversals, ageing and rounding policies below. Record corrections and a dated decision before real merchant financial posting.

| Scenario | Expected outcome |
|---|---|
| Invoice R10; receipt R40 | Net -R30, unapplied credit R30, no negative open invoice |
| Older invoice R100; newer R80; receipt R120 | Older cleared, newer R60 outstanding |
| Reverse R20 allocation | Invoice and unapplied credit each increase R20; net unchanged |
| Due today / 1 / 30 / 31 / 180 / 181 days overdue | Current / 30 / 30 / 60 / 180 / over |
| Accounting period age 0 / 1 / 7+ | Current / 30 / over; separate from elapsed-day ageing |
| NET30 issued 2026-01-31 | Due 2026-03-02 |
| EOM30 issued 2024-01-15 | Due 2024-03-01 |
| ZAR 1.0050 / -1.0050 | 1.01 / -1.01; half away from zero |
| Float100 + cash sales50 - cash refund10 - drop20 | Expected120; count115 is shortage -5; card refunds excluded |

Detailed fixtures: tests/fixtures/genesis-rules.json. Source hashes: docs/evidence/formula-parity.md. DUE/CASH/REV are new product policies, not exact Delphi parity. Automatic interest and unresolved legacy reversal rules remain excluded.

Record reviewer name/role, date, fixture IDs reviewed, corrections, approved policies and exclusions. Automated tests and AI inspection do not constitute independent financial approval.
