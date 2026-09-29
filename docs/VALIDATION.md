# Design-package validation
Checked 2026-09-28.

| Check | Result |
|---|---|
| Plan task declarations match JSON tracker | Passed: 38 tasks |
| Duplicate declaration IDs | None |
| Missing/cyclic task dependencies | None; all dependencies reference earlier declared tasks |
| Required implementation-plan sections | All eight present |
| Broken relative Markdown artifact links | None |
| SQL table definitions | 44 |
| Foreign-key table targets | All reference declared tables |
| Forced tenant RLS policies | Present for all 44 tables |
| Application implementation statuses | TASK-004 and TASK-006 In progress; remaining tasks Planned |
| PostgreSQL execution | Reference DDL executed in PGlite; tenant role/RLS and composite-FK tests passed. External PostgreSQL server not yet run |
| Production posting/permission/concurrency tests | Not run; future implementation tasks |
| Shopify live device/plan tests | Not run; Phase 0 evidence gate |
| Merchant demand validation | Not performed; owner-led Phase 0 gate |
| Exploratory rule proof | 44 synthetic cases; 47 Node tests passed on 2026-09-28; finance review pending |
| API/domain/database checks | 3 API, 9 domain and 2 PGlite tests passed; workspace TypeScript check passed |
| Webhook behavior | Raw-body HMAC verified; invalid requests return 401 and verified requests return 503 pending durable inbox |
| Shopify CLI configuration | 4.8.2 linked to Genesis Trade Suite; config validation passed, stable 2026-07 webhook version and DisplayDeck dev store set; app installed, but no live Admin API or POS transaction test yet |
| Embedded app preview | Official React Router scaffold typecheck/build passed; Shopify CLI reported installed and preview ready on DisplayDeck. Owner screenshot confirms browser rendering and fictional credit decision. POS workflow remains unobserved |
| POS extension | CLI-generated smart-grid tile/modal passed Shopify component validation and `shopify app build`; device rendering and account-sale transaction untested |

These checks do not establish production PostgreSQL correctness, business demand, accounting parity or Shopify approval. The reference schema must become tested migrations with posting/allocation procedures and restricted grants described in docs/05-schema-guide.md before financial use.
