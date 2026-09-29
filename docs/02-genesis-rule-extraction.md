# Genesis reuse and business-rule extraction
Inspected 2026-09-26. Genesis HEAD: f425fbc92f8f5b93f22012f170ea47d9abbe5850. Working files, not a frozen release, were inspected; capture file hashes with parity evidence. No Delphi binary or production SQL Server comparison was run.

## What exists
- C:/Github/GENESIS: Delphi retail ERP including genTIL, genDEB, genCOF and shared System/DEB.
- C:/Github/Worktree/OnlineVersion: separate Django/DRF + Next.js rebuild. README explicitly describes API access over existing SQL Server.
- OnlineVersion/docs/deconstruction/rule-catalog.md: valuable prior analysis covering debtor ageing, pricing, financial integrity and integration.
- OnlineVersion/backend/apps/debtors/models.py: unmanaged legacy DEBMaster/DEBBalance models. This is not the new SaaS persistence layer.
- OnlineVersion/backend/apps/pos/ops.py: pickup/park/supervisor flow knowledge, but legacy table names and numeric conversions remain.
- OnlineVersion/docs/stage-status.md marks multiple stages completed while noting reconciliation still awaiting a database copy. Treat this as prior tracking, not independent production-readiness evidence.

**Reuse requirements, fixtures and flow knowledge. Rewrite persistence, tenant scoping, authorisation, financial arithmetic and Shopify adapters.** Do not copy the entire OnlineVersion project.

## Source-backed extraction map
Paths below are relative to C:/Github/GENESIS unless prefixed OnlineVersion.

| Rule | Source / observed anchor | Target and evidence requirement |
|---|---|---|
| Eight ageing buckets; credits applied oldest first | System/DEB/SysDEBBalance_ReCalc.pas:209 dbal_Calc_Period_Balances; cascade 320–402 | domain/aging.ts; fixtures across all eight buckets, excess credits, missing periods and backdates |
| Excess credits remain negative in current | Same unit:390–402; wAmount is negative credit remainder | Unapplied credit stays separate; net display may be negative. Never convert overpayment to new debt. |
| Statement balance reconstructed newest first | System/DEB/SysDEBCalcAgeing.pas:98 sdca_ProcessTxans; ordering at 128; sdca_Update_Aging at 226 | Preserve output via compatibility projection, not by rewriting posted invoice allocations during statement rendering |
| Period roll-forward/backdating | System/DEB/SysDEBCalcBalance.pas sdbc_GetPrevAPBalance and sdbc_ReCalc_BackDated_Balances | Immutable transactions and reproducible as-of reports; do not copy mutable legacy bucket tables |
| Receipt cash and discount legs | System/DEB/SysDEBPayments.pas:49 spm_WriteServerPayment, spm_Read_Payment:122 and spm_Write_DebTxan | domain/posting.ts; cash settlement and settlement discount are separate ledger entries |
| Hold/stop supervisor control | genTIL/Forms/VTILL001.pas:757–770 | domain/credit.ts; distinguish hold, stopped, closed; closed account cannot transact |
| Credit limits, overdue controls | VTILL001.pas:972–1013; supervisor procedure:1433 | Include basket tax/shipping and outstanding reservations; role-specific override with reason |
| Customer PO requirement has exceptions | VTILL001.pas:1275–1290 | Account-configured requirement; returns exempt in observed flow. “Mandatory everywhere” would change working behaviour. |
| Pricing pipeline | genTIL/System/SysPriceGrid.pas:54 spg_LoadPriceGrid; default:120; spg_PickLowestPrice:1045 | Later domain/pricing.ts; precedence is richer than simple lowest-price wins; use prior catalogue then verify actual source |
| Cash office opening float, pickups, separate tenders | genCOF/Forms/COF010.pas:233–264 and 330–340 | domain/cashoffice.ts; pickups remain separate movements by tender |
| Cash office shortages and settlement posting | genCOF/Forms/COF220.pas:4157, 5870, 6116–6126, 6254–6257 | Explain variance without mutating the original sale; period-close audit |
| Tender-integrity refunds | OnlineVersion/docs/deconstruction/till-proof.md and rule-catalog.md reference POS100B, SysPOSCalcTillValues, SysPrtClosingSlip | Prior analysis only in this review; locate and trace complete refund path before claiming parity |
| Interest eligibility | genDEB/Forms/DEB101.pas:770, 1128, 3665 show configurable Interest field | Exact 60+ calculation, rate basis and rounding were NOT verified. Defer automatic charges until formula and merchant authorisation are proved. |
| Blind denomination count; drop reason codes; signatures/job reference | Brief requirement; partial cash-office evidence only | Treat as explicit new-product requirements, not fully verified source behaviour |

## Concrete discrepancy in the web port
OnlineVersion/backend/apps/debtors/services.py converts inputs to float and adds positive excess credit to current. Its test test_leftover_added_to_curr explicitly expects +30 for debit 10 / credit 40. Delphi's negative-credit cascade gives -30. For the new app:
- Invoice 10, payment 40, allocation 10.
- Open invoices 0, unapplied credit 30, net account balance -30.
- Available credit may increase by that verified credit according to a documented merchant policy.
- The new suite must reject +30 as debt. Passing old tests is insufficient.

This is a source-level finding; no changes were made to OnlineVersion. It is not a conclusion that all of that implementation is wrong.

## Ageing semantics require an explicit choice
Genesis accounting-period ageing and invoice due-date ageing answer different questions. An invoice dated January 31 with Net 30 terms must not silently be treated as 30 days overdue on February 1.

Default new accounts to due-date ageing; imported Genesis accounts can select a versioned calendar-period compatibility profile only after parity sign-off. Due-date buckets: current includes not-yet-due and due today; 1–30, 31–60, 61–90, 91–120, 121–150, 151–180, 181+ days overdue. Labels Current/30/60/90/120/150/180/Over. Use shop-local date. For compatibility, use explicit accounting-period ordinals, never numeric YYYYMM subtraction or count-only transaction periods.

Keep open-item allocation independent from historical balance-forward presentation. A statement's newest-first reconstruction is not a new instruction to reallocate real payments newest-first.

## Formula extraction workflow for the new product
1. Freeze source hash and name each rule; collect sanitised inputs and expected outputs from a Genesis test copy.
2. Encode decimal-domain fixtures with dates, terms, sign convention and expected journals/allocations.
3. Implement pure domain functions behind new repositories; no old SQL/table dependencies.
4. Compare results; record intentional changes as versioned decisions with merchant/finance review.
5. Build synthetic Shopify-native account/invoice/payment scenarios using those formulas; Genesis data import is not required.
6. Compare expected debit/credit totals, aged buckets and statement examples before pilot activation.
7. Run a full statement cycle on the pilot's Shopify workflows and reconcile to its bookkeeper's records. Any future generic opening-item import must avoid duplicating Shopify obligations.

Genesis executables, SQL Server and installed services have no role in production, deployment or onboarding. The user confirmed this greenfield Shopify-only product boundary during this design.

