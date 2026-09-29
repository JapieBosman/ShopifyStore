# Agent execution handoff — Genesis Trade Suite

Updated 2026-09-29. [tracking.json](tracking.json) is the only task-status authority. The [original plan](architecture-shopify-trade-accounts-1.md) defines TASK-001–038; the [suite expansion plan](feature-trade-suite-expansion-1.md) defines TASK-039–063. New tasks are planned, not implemented.

## Current starting point

- The installed development app is Genesis Trade Suite on `displaydeck.myshopify.com`; installed embedded routes live in `apps/shopify/genesis-trade-suite`.
- Foundation and multiple financial modules are recorded complete in the tracker. TASK-004/011 formula work and TASK-017/019 embedded UX/delivery remain In progress. This is tracker state, not independent recertification of all code.
- Recent local delivery changes distinguish explicit provider absence from an unavailable lookup. External-provider, real PostgreSQL concurrency and physical POS evidence must be inspected before claiming live readiness.
- There are no pilot merchants. Synthetic tests and dev stores support engineering; they do not establish demand, willingness to pay or public-release readiness.
- The original 2026-09-28 screenshot proves the initial embedded demo rendered. It does not prove current order/payment/stock/device workflows.
- Owner screenshots dated 2026-09-29 now show Trade Accounts, Allocation Workbench and Onboarding rendering in the DisplayDeck embedded app. See `docs/evidence/development-store.md`. The workbench is explicitly in-memory demo mode; no receipt submission or durable posting has been observed yet.
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
4. **Finish TASK-017/019 and TASK-042 — owner demo.** Produce a repeatable embedded account/receipt/allocation/statement walkthrough. Real email provider acceptance, Shopify orders and POS-device outcomes remain separate evidence; the synthetic demo can use a local gateway.
   The next browser acceptance step is one synthetic ACC-002 receipt/allocation, balance refresh and reversal, followed by onboarding steps 2–4 and an account detail view. Do not present the current screenshot of a proposed allocation as proof it was posted.
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
