---
goal: Select Genesis-derived Shopify features with a measurable competitive advantage
version: 1.0
date_created: 2026-09-29
last_updated: 2026-09-29
owner: Genesis Retail Solutions
status: In progress
tags: [architecture, genesis-rules, product-strategy, competitive-validation]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

The owner directs feature selection to start from the working Genesis desktop product and favour workflows that can outperform current Shopify options. This plan supersedes the broad expansion plan's feature priority, not its runtime work or one-app/one-subscription boundary. The expansion catalogue is a candidate backlog, not an instruction to implement everything.

Initial read-only discovery captured **1,378 form captions** across the seven requested modules in [the source inventory](../docs/evidence/genesis-module-inventory.json). This is a count of discovered form files, not unique features, active menu entries or verified formulas. The on-disk till module is `genTIL`. Shared System/Classes units and report definitions must be traced by the tasks below.

## 1. Requirements & Constraints

- **REQ-201**: Start with genTIL, genCOF, genDEB, genREP, genPOS, genSTK and genCRD; do not assume module purpose from abbreviations alone.
- **REQ-202**: Label each candidate as source-discovered, rule-traced, fixture-tested, finance/domain-reviewed, Shopify-proven and merchant-validated independently. A DFM caption establishes only source discovery.
- **REQ-203**: Record source path, procedure/query, line anchors, SHA256, inputs, outputs, exception/reversal behaviour and expected money/quantity effects for every adopted rule.
- **REQ-204**: Classify the product design as Genesis-derived, adapted for Shopify, or new proposal. State which part of a mixed feature falls in each class.
- **CON-201**: No legacy binary, database schema, SQL Server or OnlineVersion runtime integration. Genesis remains read-only.
- **CON-202**: No claim that a competitor lacks a feature based on missing marketing text. Use unknown until tested or explicitly documented.
- **SEC-201**: Do not copy customer data or credentials into fixtures. Counter permissions, tender integrity, immutable audit and tenant controls remain mandatory.
- **PAT-201**: Select a connected trade-counter-to-accounts-to-cash-office workflow before expanding into generic retail modules. Validate platform feasibility separately from source correctness.

### Ranked hypotheses to prove

| Rank | Candidate advantage | Genesis starting point | Demonstration and measurable outcome |
|---|---|---|---|
| 1 | Reliable trade-account control at a busy counter | genTIL + genDEB | Two tills each request 80 against 100 available; one approval, valid supervisor exception, expired temporary limit rejected, uncertain sale retains exposure. Compare enforced behaviour and cashier steps. |
| 2 | Traceable cash custody through daily close | genCOF + genPOS + genREP | Follow float, pickup, cash drop, petty cash, cash refund and card settlement to a -5 shortage; identify source movements without spreadsheet reconstruction. Measure close/investigation time. |
| 3 | Proper handling of complicated customer payments | genDEB + genREP | One receipt against several invoices, unapplied credit, settlement discount, reversal and reproducible statement. Measure manual allocations, correction time and reconciled totals. |
| 4 | Trade pricing with explainable exceptions | genTIL + genDEB + genSTK | Account deals, quantity/pack boundaries and last-price context; show why a price applied and preserve approved tax/rounding. Compare decision accuracy and override audit. |
| 5 | Supplier claims and recovery of missed credits | genCRD + genSTK + genREP | Link short/damaged goods or return to claim and supplier credit; track unresolved value without creating a second accounting authority. Formula and demand proof still required. |

These are product hypotheses, not proven gaps. The first three are the recommended combined demonstration. Ordinary quotes, dashboards, reminders, stock counts and portals remain supporting capabilities unless benchmark evidence identifies a specific shortfall.

### Current published overlap — checked 2026-09-29

| Alternative | Published overlap | What remains to benchmark |
|---|---|---|
| Molsoft B2B POS + OnAccount | Counter B2B orders, credit summary and deposit requirements; [vendor order guide](https://molsoft.crisp.help/en/article/place-b2b-orders-at-pos-6eyod3/) and [integration guide](https://molsoft.crisp.help/en/article/integrations-dyprp1/) | Concurrent limit reservation, uncertain-outcome handling, exception audit and complete close workflow; untested here |
| AReceivables | Reminders, periodic statements, unpaid-order dashboard and invoices; [listing](https://apps.shopify.com/areceivables) | Allocation/reversal/discount control and reproducible historical accounting; untested here |
| Shopify register sessions | Existing cash-session workflow and reason codes; [official guide](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/register-sessions-in-shopify-pos) | Cross-movement custody, blind count, tender settlement and discrepancy investigation depth |
| Shopify POS inventory counts | Native count/review workflow; [official guide](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/inventory-management/planning-an-inventory-count) | Trade-specific pack/kit/serial exceptions, if supported and valuable |
| Broader wholesale suites | Established wholesale offerings, including [SparkLayer](https://apps.shopify.com/sparklayer) | Full scenario fit and total operating cost; no broad superiority claim |

One subscription may simplify buying and support. It is not sufficient differentiation by itself. No fresh hands-on competitor trial or merchant interview was performed during this initial source scan.

## 2. Implementation Steps

### Implementation Phase 12

- **GOAL-212**: Trace the seven modules and select only source-backed, platform-feasible, competitively justified features.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-64 | **genTIL: Counter workflow and pricing. Owner:** Source-analysis agent. **Files:** read-only C:/Github/GENESIS/genTIL/Forms/ (VTILL001.pas;VTILL002D.dfm;VTILL002L.dfm;VTILL039.dfm); outputs docs/source-rules/genTIL.md and tests/fixtures/genesis-gentil-rules.json. **Action:** Trace account approval, supervisor exception, quote import, deposits, split tenders and pricing precedence. Follow called shared units; document which Shopify surface could support each rule. **Depends:** none. **Pass:** Enumerate active menu families, trace at least five priority rules through handlers/shared code and create at least ten sanitised boundary/reversal fixtures with hashes; label unresolved items and do not claim executable parity from inspection alone. | No | — |
| TASK-65 | **genCOF: Cash custody and reconciliation. Owner:** Source-analysis agent. **Files:** read-only C:/Github/GENESIS/genCOF/Forms/ (COF010.dfm;COF060.dfm;COF110.dfm;COF220.pas;COF420.dfm); outputs docs/source-rules/genCOF.md and tests/fixtures/genesis-gencof-rules.json. **Action:** Trace float, pickup, cash-drop verification, disbursement, blind count, cashup variance and card settlement. Preserve tender boundaries and identify transaction-to-variance drill-down requirements. **Depends:** none. **Pass:** Enumerate active menu families, trace at least five priority rules through handlers/shared code and create at least ten sanitised boundary/reversal fixtures with hashes; label unresolved items and do not claim executable parity from inspection alone. | No | — |
| TASK-66 | **genDEB: Trade debtor control. Owner:** Source-analysis agent. **Files:** read-only C:/Github/GENESIS/genDEB/Forms/ (DEB032.dfm;DEB032B.dfm;DEB060.dfm;DEB103.pas;DEB113.dfm); outputs docs/source-rules/genDEB.md and tests/fixtures/genesis-gendeb-rules.json. **Action:** Trace bulk receipts, allocation/reversal, claims, temporary limit validity, last price paid and account-specific deals. Reuse prior ageing source evidence and distinguish proposed collections UX. **Depends:** none. **Pass:** Enumerate active menu families, trace at least five priority rules through handlers/shared code and create at least ten sanitised boundary/reversal fixtures with hashes; label unresolved items and do not claim executable parity from inspection alone. | No | — |
| TASK-67 | **genREP: Exception reports and control totals. Owner:** Source-analysis agent. **Files:** read-only C:/Github/GENESIS/genREP/Forms/ (RPS/RPS001.dfm;RPS/RPS014.dfm;RDR/RDR009.dfm;RPU/RPU008.dfm); outputs docs/source-rules/genREP.md and tests/fixtures/genesis-genrep-rules.json. **Action:** Trace report queries and definitions into daily tender summaries, discount exceptions, debtor receipts and delivery strike rate; record grouping, exclusions, signs and reconciliation totals. Rank decisions supported, not chart count. **Depends:** none. **Pass:** Enumerate active menu families, trace at least five priority rules through handlers/shared code and create at least ten sanitised boundary/reversal fixtures with hashes; label unresolved items and do not claim executable parity from inspection alone. | No | — |
| TASK-68 | **genPOS: Back-office sales audit. Owner:** Source-analysis agent. **Files:** read-only C:/Github/GENESIS/genPOS/Forms/ (POS010C.dfm;POS022.dfm); outputs docs/source-rules/genPOS.md and tests/fixtures/genesis-genpos-rules.json. **Action:** Inventory the actual genPOS menu and handlers separately from genTIL. Trace till audit and sales/return statistics and identify document, refund and authorisation reconciliation links. **Depends:** none. **Pass:** Enumerate active menu families, trace at least five priority rules through handlers/shared code and create at least ten sanitised boundary/reversal fixtures with hashes; label unresolved items and do not claim executable parity from inspection alone. | No | — |
| TASK-69 | **genSTK: Trade stock rules. Owner:** Source-analysis agent. **Files:** read-only C:/Github/GENESIS/genSTK/Forms/ (STK011.dfm;STK111.dfm;STK127.dfm;STK136B.dfm;STK139.dfm); outputs docs/source-rules/genSTK.md and tests/fixtures/genesis-genstk-rules.json. **Action:** Trace packs/unit conversions, kits, transfer states, serial audit, cost/selling-price controls and stock corrections. Establish source formula fixtures; map native Shopify overlap before proposing writes. **Depends:** none. **Pass:** Enumerate active menu families, trace at least five priority rules through handlers/shared code and create at least ten sanitised boundary/reversal fixtures with hashes; label unresolved items and do not claim executable parity from inspection alone. | No | — |
| TASK-70 | **genCRD: Supplier claims and terms. Owner:** Source-analysis agent. **Files:** read-only C:/Github/GENESIS/genCRD/Forms/ (CRD070.dfm;CRD080.dfm;CRD108.dfm;CRD052.dfm); outputs docs/source-rules/genCRD.md and tests/fixtures/genesis-gencrd-rules.json. **Action:** Trace supplier claims, goods receipt/returns posting, rebates, remittances and payment terms including System/CRD/SysCRDPayDueDate.pas. Separate useful supplier exception workflows from full AP/bank-file execution, which remains outside the initial build. **Depends:** none. **Pass:** Enumerate active menu families, trace at least five priority rules through handlers/shared code and create at least ten sanitised boundary/reversal fixtures with hashes; label unresolved items and do not claim executable parity from inspection alone. | No | — |
| TASK-071 | **Competitive selection and source-to-roadmap mapping. Owner:** Product/implementation agent. **Files:** docs/evidence/competitive-scenarios.md; docs/source-rules/feature-map.json; plan/tracking.json. **Action:** Map each expansion feature to rule IDs and provenance. Benchmark the five ranked hypotheses against current native/vendor documentation and, when access exists, identical sandbox scenarios. **Depends:** TASK-064–070. **Pass:** Select at most three differentiating workflow packages for the next release; record rejected/deferred candidates, platform blockers, evidence confidence and measurable pass criteria. Without trial access mark comparisons unknown and use provisional priority, not a superiority claim. | No | — |

## 3. Alternatives

- **ALT-201**: Port every desktop screen rejected; mature desktop breadth does not automatically create a Shopify advantage.
- **ALT-202**: Build generic features first rejected as the default order because the published alternatives already overlap.
- **ALT-203**: Abandon existing durable runtime work rejected; source-first selection can proceed independently of TASK-039–042.

## 4. Dependencies

- **DEP-201**: The original source and shared units must be available read-only; source hashes anchor the observation.
- **DEP-202**: Finance/domain review validates intended behaviour where source code is ambiguous or faulty. Running legacy infrastructure is not required by the new product.
- **DEP-203**: Shopify capability proofs and real-device evidence remain required for adopted counter/stock/payment features.
- **DEP-204**: Competitor trials and merchant interviews improve evidence later. No messages, installs, charges or trial registrations are authorised merely by this plan.

## 5. Files

- **FILE-201**: docs/evidence/genesis-module-inventory.json — initial form-caption inventory with line anchors and DFM hashes.
- **FILE-202**: docs/source-rules/ — per-module rule catalogues and feature provenance mapping to be produced.
- **FILE-203**: plan/tracking.json — TASK-064–071 and prerequisite links to existing expansion tasks.
- **FILE-204**: docs/evidence/competitive-scenarios.md — future comparable scenarios with recorded outcomes, not feature-checkbox guesses.

## 6. Testing

- **TEST-201**: Verify every source path/hash and procedure anchor; follow calls beyond the screen into shared units and SQL/report definitions.
- **TEST-202**: Use independent expected values for zero/negative/boundary inputs, dates, rounding, reversal, expired authority and concurrent operations.
- **TEST-203**: For comparisons record exact scenario, date, app/version/plan/device, observed result and unavailable checks. Never count unavailable tests as competitor failures.
- **TEST-204**: Validate tracker IDs, dependency existence/cycles and plan declaration coverage after adding source prerequisites.

## 7. Risks & Assumptions

- **RISK-201**: Duplicate/dead forms or misleading captions inflate an inventory; inspect active project/menu wiring.
- **RISK-202**: Working desktop routines may contain bugs or assumptions inappropriate to concurrent multi-tenant web use.
- **RISK-203**: Supplier payments, rebates and pack/kit accounting can increase scope substantially; discovery does not authorise banking or a full AP module.
- **ASSUMPTION-201**: Owner experience is valuable domain input; it does not replace an explicit source-to-fixture contract.
- **ASSUMPTION-202**: A connected counter/receivables/cash-office workflow is the leading hypothesis; superiority and demand remain unproven.

## 8. Related Specifications / Further Reading

[Original rule assessment](../docs/02-genesis-rule-extraction.md) · [Expansion candidate backlog](feature-trade-suite-expansion-1.md) · [Current tracker](tracking.json) · [Agent handoff](agent-execution-handoff.md)

A new source observation: System/CRD/SysCRDPayDueDate.pas, cpd_CalcPayDueDate, inspected 2026-09-29, branches on invoice versus statement basis, weekly/monthly handling and extension settings. This establishes rule complexity, not reviewed financial parity. The per-module task must capture its complete callees and fixtures.

