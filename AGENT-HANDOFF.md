# Agent handoff

## Mission
Build a completely new web application in the Shopify ecosystem. Use Genesis source only to learn proven business rules and formulas. Do not integrate with Delphi binaries, Genesis SQL Server, branch services, or the existing OnlineVersion runtime. The owner explicitly clarified this boundary during planning.

Work exclusively in C:/Github/Shopify unless the owner directs otherwise. Genesis and OnlineVersion are read-only reference sources. A development app is installed on DisplayDeck; see [current execution handoff](plan/agent-execution-handoff.md) for its verified state and canonical paths.

## Start
1. Read README.md and docs/01-business-case.md through docs/05-schema-guide.md.
2. Read plan/agent-execution-handoff.md, plan/architecture-shopify-trade-accounts-1.md and plan/tracking.json.
3. Review the user's latest scope instructions before selecting work.
4. Read plan/feature-trade-suite-expansion-1.md. Start TASK-039 (evidence audit), then TASK-040 (durable runtime proof); continue TASK-017/019 and independent TASK-003/004 work. TASK-006 is recorded Completed. Use tracking.json, not historical handoff snapshots, for current status.
5. If merchant/device/access information is missing, record the precise dependency and continue independent work. Never invent interviews, API responses, financial parity or review approval.

## Tracking protocol
tracking.json is the task-state authority. Valid statuses: Planned, In progress, Blocked, Completed, Deferred.

Before work, set status and started_at (ISO timestamp), and name the actual owner. On completion, record evidence paths, test commands/results, commit or file hashes where available, completed_at and next_action. Update the Markdown plan's Completed/Date columns in the same change. If a task is split, allocate new unique TASK IDs, preserve the original dependency chain and update both files.

Completed means the acceptance test passed. Generated code, mock-only tests, a schema file or a checkbox alone are not acceptance evidence. For external gates, record the actual decision, date and evidence; do not claim approval from absence of objections.

Every work session should leave a short dated entry in docs/PROGRESS.md: task IDs, changed files, validations, blockers and exact next step. Do not overwrite prior entries.

## Critical implementation traps
- Excess-credit sign in the OnlineVersion debtor helper differs from Delphi; copying its tests would preserve the discrepancy.
- Due-date ageing and Genesis accounting-period ageing are separate strategies.
- Statements must not rewrite financial allocations.
- A tile is not a payment tender. Build only the supported Shopify order flow demonstrated by the spike.
- Partial-payment write-back has Shopify plan restrictions. Do not conceal native/app balance differences.
- API timeout after a remote order mutation is an uncertain result, not permission to create another order.
- Credit reservations need database locking and must remain in exposure during uncertain completion.
- Never count account sales as cash or move card refunds into cash.
- Reference SQL does not yet enforce aggregate posting/allocation invariants; implement the procedures and grants before financial use.
- No public replacement browser POS until its actual distribution path is permitted. This does not block the embedded Shopify web dashboard.

## Scope discipline
Commercial model: one installed app, one subscription and access to every module that has shipped. Feature flags support safe rollout, not paid tiers. The candidate price is $249/month, pending merchant validation.

MVP: debtor accounts, validated financial engine, embedded administration, supported Shopify POS account workflow, statements, receipt/refund reconciliation, billing and operations.

Expansion: cash office/pricing/workshop retain TASK-030–038. TASK-043–063 add collections, quotations, buyer/project controls, customer portal, generic imports, accounting exports/connectors, reporting, returns, stock, purchasing and dispatch. All are modules of the same subscription. Follow their explicit contracts and capability gates; automatic interest remains deferred. No Genesis migration is included.

Do not send merchant/Shopify messages, incur subscription charges, publish or submit an app merely because a task describes that eventual step. Prepare concrete reviewable artifacts and follow the user's actual authorisation.

## Resume prompt
“Read C:/Github/Shopify/AGENT-HANDOFF.md, plan/agent-execution-handoff.md, the implementation plan and tracker. Continue the assigned unblocked task in the installed Shopify React Router app or shared packages. Genesis is a read-only formula reference. Preserve that boundary, record evidence and update tracking after every completed task.”

## Source-first priority update — 2026-09-29

Read [the Genesis advantage plan](plan/architecture-genesis-advantage-1.md) before choosing additional features. TASK-064–070 trace genTIL, genCOF, genDEB, genREP, genPOS, genSTK and genCRD; TASK-071 selects competitively justified workflow packages. All 71 tasks are tracked centrally. Runtime work continues independently; the broad expansion list is a candidate backlog. Label each feature Genesis-derived, adapted or new, with its actual evidence level.
