# Agent execution handoff — DisplayDeck Trade Suite

Updated 2026-09-30. [tracking.json](tracking.json) is the only task-status authority. The [original plan](architecture-shopify-trade-accounts-1.md) defines TASK-001–038; the [suite expansion plan](feature-trade-suite-expansion-1.md) defines TASK-039–063.

## Current starting point

- The installed development app is Genesis Trade Suite on `displaydeck.myshopify.com`; installed embedded routes live in `apps/shopify/genesis-trade-suite`.
- TASK-017 and TASK-042 completed on 2026-09-30 with signed-in durable browser/owner acceptance and repeatable synthetic lifecycle proof. TASK-003 platform/device, TASK-004/011 finance and TASK-019 actual email-provider acceptance remain open.
- Recent local delivery changes distinguish explicit provider absence from an unavailable lookup. External-provider, real PostgreSQL concurrency and physical POS evidence must be inspected before claiming live readiness.
- There are no pilot merchants. Synthetic tests and dev stores support engineering; they do not establish demand, willingness to pay or public-release readiness.
- The original 2026-09-28 screenshot proves the initial embedded demo rendered. It does not prove current order/payment/stock/device workflows.
- Current screenshots and owner confirmations are recorded in `docs/evidence/browser-walkthrough-2026-09-30.md`. A synthetic receipt and reversal persisted, onboarding survived restart, the owner verified account/policy/search/keyboard behavior, and PDF download works. Fresh-directory lifecycle and the existing R4300 browser branch are distinguished in `docs/evidence/synthetic-demo.md`.
- TASK-039 reconciles historical evidence and inconsistent dependency completion. Do not restart completed foundation work solely because an older summary suggested it.

## Canonical paths and commands

| Purpose | Path or command |
|---|---|
| Installed embedded app | `apps/shopify/genesis-trade-suite/` |
| Shopify configuration | `apps/shopify/genesis-trade-suite/shopify.app.toml` |
| Embedded routes | `apps/shopify/genesis-trade-suite/app/routes/` |
| POS extension | `apps/shopify/genesis-trade-suite/extensions/trade-account/` |
| Domain services | `packages/domain/src/` |
| API and worker | `apps/api/src/`, `apps/worker/src/` |
| Migrations | `packages/database/migrations/`; allocate next unused number |
| Prototype only | `apps/admin/`; do not implement new production screens here |
| Validation from C:/Github/Shopify | `pnpm test`, `pnpm typecheck`, `pnpm shopify:typecheck`, `pnpm build` |
| Shopify preview | `pnpm shopify:dev`; tunnel must remain running |

Follow [LOCAL-TESTING.md](../docs/LOCAL-TESTING.md) for setup. TASK-040 must bring these instructions up to date with API, worker and real PostgreSQL startup. The preview is [Genesis Trade Suite in DisplayDeck](https://admin.shopify.com/store/displaydeck/apps/genesis-trade-suite/app). Authentication is local; do not copy secrets, CLI state or session databases to another agent.

## Immediate sequence

1. **TASK-039 — evidence audit.** Compare original completion claims to acceptance, missing dependencies and actual evidence. Correct unsupported states only with a recorded reason.
2. **TASK-040 — durable runtime proof.** Test real PostgreSQL restricted roles, pooled transaction ownership, concurrent tenants, failure cleanup and restart persistence. Record reproducible start commands.
3. **TASK-041 — delivery runtime.** Prove actual scheduled dispatch/reconciliation against a local HTTP gateway with a durable message log. Test crashes, unavailable status lookups, duplicate billing contacts and slow active batches; unknown status must never authorise resend. This does not itself close live-provider acceptance under TASK-019.
4. **Continue TASK-019 — actual provider acceptance.** TASK-017/042 are complete. Select the owner's email provider, implement/configure its sandbox adapter and authenticate callbacks, then prove send, bounce and uncertain-result handling. Local captured-email proof is recorded; actual provider acceptance remains separate from it and from Shopify orders/POS-device results.
5. **In parallel where files do not overlap:** continue TASK-003 platform/device feasibility and TASK-004/011 finance/formula review. Then implement TASK-020–023 using the proven platform path.
6. **First feature additions:** module registry TASK-043, collections TASK-044, quote capability TASK-045, buyer/project controls TASK-047, exports TASK-051 and reports TASK-054 after their listed dependencies.
7. **Later modules:** portal, accounting connector, returns, stock, purchasing and dispatch follow their capability tasks. Cash office/pricing/workshop use existing TASK-030–038 with the revised local versus release gates.

Task number alone is not execution order. Follow each `depends_on` list. `release_dependencies` restrict live activation rather than local synthetic engineering. Every released module needs the TASK-063 release record and applicable original launch gates.

## Work packages for owner-assigned agents

| Package | Task scope | Main acceptance |
|---|---|---|
| Current build | TASK-039–042 and unfinished TASK-017/019 | Reproducible durable demo, honest external-evidence gaps |
| Platform and finance proof | TASK-003/004/011 then TASK-020–023 | Supported Shopify/device operations and reviewed formulas |
| Trade desk | TASK-043–047, TASK-054 | One suite navigation, collections, quotes, buyer controls and reconciled reports |
| Customer self-service | TASK-048–049 | Verified customer identity and account-scoped documents |
| Bookkeeper workflows | TASK-050–053 | Safe imports, balanced exports, one sandbox-proven connector |
| Service and delivery | TASK-055, TASK-060–061, existing TASK-036–037 | Case/job/dispatch workflows without duplicate financial effects |
| Stock and purchasing | TASK-056–059 | Proven native authority, counts/transfers/receipts applied once |
| Automation and release | TASK-062–063 with TASK-024–029 | Authorised reminders, single subscription and per-module release evidence |

Assign only the ready subset of a package. Separate packages can share files and dependencies; use isolated checkouts or sequential integration. One integrator updates the tracker. These packages do not authorise automatic creation of other agents or chats.

## Copyable first assignment

> Work in C:/Github/Shopify. Read AGENT-HANDOFF.md, plan/agent-execution-handoff.md, both implementation plans and plan/tracking.json. Take TASK-039 only. Audit recorded completion and acceptance evidence, including dependencies, real PostgreSQL, finance review, POS/device proof and statement delivery. Do not invent evidence or restart finished work blindly. Write docs/evidence/readiness-audit.md, update unsupported task states with reasons in tracker and corresponding plan rows, and append docs/PROGRESS.md. Return the next ready task and exact remaining external checks.

After that audit, assign TASK-040, then TASK-041. For another package, substitute explicit task IDs after verifying dependencies.

## Tracking and boundaries

- Set actual owner, status and start time before implementation. Complete only when the stated acceptance passes; retain evidence paths and command/environment results.
- Update corresponding plan rows and tracker in the same change; add a dated PROGRESS entry. New schema migrations use the next unused number.
- One Shopify app and one subscription cover all shipped modules. Rollout flags and permissions are operational, not paid tiers.
- Genesis and OnlineVersion are read-only rule references; no Delphi, SQL Server or legacy runtime integration.
- Do not claim a generated extension or mock test proves device/payment support. Do not claim roadmap modules are already available.
- Follow the user's actual authorisation for external messages, charges, production writes and publication. Planning an eventual release is not permission to perform those actions.

## Source-first priority update — 2026-09-29

Read [architecture-genesis-advantage-1.md](architecture-genesis-advantage-1.md) before choosing additional features. TASK-064–070 trace genTIL, genCOF, genDEB, genREP, genPOS, genSTK and genCRD; TASK-071 selects competitively justified workflow packages. All 71 tasks are tracked centrally. Runtime work continues independently; the broad expansion list is a candidate backlog. Label each feature Genesis-derived, adapted or new, with its actual evidence level.

## Owner email deferral — 2026-09-30

TASK-019 is Deferred at the owner's explicit request until an email provider is selected. Continue TASK-003 and TASK-004/011 technical work. PDF download acceptance remains recorded; actual provider delivery is unverified. Platform matrix: docs/evidence/api-capabilities.md. Formula proof now has 49 passing tests plus 9 money/terms tests; independent financial approval remains pending.

## Product rename — 2026-09-30

The owner selected DisplayDeck Trade Suite. Local app heading, Shopify configuration, onboarding, current product documentation and tracker use this name. The installed Shopify label has not been verified or updated remotely. Existing directory and app URL identifiers remain the linked development app identifiers. Genesis references in financial provenance and historical evidence describe the original source and observations.
