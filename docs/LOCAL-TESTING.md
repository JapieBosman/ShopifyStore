# Start and test DisplayDeck Trade Suite

Run these commands in PowerShell on a machine with Node.js 24 and pnpm 11 installed. The app is a Shopify development app linked to `displaydeck.myshopify.com`; the person running it needs access to the Shopify Partner organisation and that development store.

```powershell
Set-Location C:\Github\Shopify
pnpm install --frozen-lockfile
npm ci --prefix apps/shopify/genesis-trade-suite
pnpm test
pnpm shopify:typecheck
pnpm build
pnpm shopify:dev
```

Keep the last command's terminal open. Shopify CLI may open a browser to sign in or ask which Partner account/app to use. Use the existing **Genesis Trade Suite** app and **DisplayDeck** development store; do not create another app. Wait for `Ready, watching for changes in your app`, then open the **Preview URL printed by that CLI run** in a browser signed into the same Shopify account. The URL can contain an app ID and `?dev-console=show`; do not rely on an older bookmarked `/apps/genesis-trade-suite/app` URL. If the page was already open, refresh it. Stop the preview with `Ctrl+C` when finished; its tunnel URL is temporary.

The visible App Home should identify `displaydeck.myshopify.com` and show the **Synthetic demonstration** banner. The fictional account sale of R 1,200 should be approved with R 5,550 remaining. These numbers prove only the embedded page and shared credit formula; they do not prove a Shopify order, payment, debtor posting or POS device flow.

To test the POS extension, use Shopify POS on an authorised test device connected to DisplayDeck. The extension build alone does not prove the tile renders on a physical device. Record the device, POS version, store plan, tile/modal result, and any order/payment observations in `docs/evidence/api-capabilities.md`. Do not process a real customer sale for this test.

## Durable PostgreSQL Runtime & Architecture

DisplayDeck Trade Suite uses PostgreSQL connection pooling with strict tenant isolation, connection pinning, and a non-owner runtime role (`app_runtime`):
- **Connection Pinning:** Transactions (`withTenantContext`) checkout a dedicated connection from the pool and pin all statements (including nested savepoints) to that exact connection.
- **Tenant Isolation:** Tenant context is set per connection via `SELECT set_config('app.tenant_id', $1, true)`. Row-Level Security (RLS) guarantees concurrent tenants never share state or leak data.
- **Non-Owner Privileges:** Subledgers (`journal`, `journal_line`, `document`, `audit_event`) are strictly append-only for `app_runtime`; `UPDATE` and `DELETE` operations fail closed.
- **Leak-Free Releases:** Checked-out connections are guaranteed to be released back to the pool across `BEGIN`, query, business logic, or `ROLLBACK` errors.

### Database Engine Options

#### Option A: Embedded / Persisted PGlite (Zero-Install Default)
By default, the API initializes an in-process PostgreSQL engine via `@electric-sql/pglite`.
- To persist data across process restarts, specify a data directory:
  ```powershell
  $env:PG_DATA_DIR = "C:\Github\Shopify\.data\pglite"
  ```
- Migrations are tracked idempotently in `schema_migrations`; restarting the process preserves all tenants, debtor accounts, and ledger balances without schema conflicts.

#### Option B: External PostgreSQL (Docker Parity)
For staging or local parity with production PostgreSQL 16+:

1. **Launch PostgreSQL in Docker:**
   ```powershell
   docker run -d `
     --name genesis-postgres `
     -e POSTGRES_PASSWORD=postgres `
     -e POSTGRES_DB=genesis `
     -p 5432:5432 `
     postgres:16
   ```

2. **Create Non-Owner Runtime Role:**
   ```powershell
   docker exec -i genesis-postgres psql -U postgres -d genesis -c "CREATE ROLE app_runtime WITH LOGIN PASSWORD 'runtime_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;"
   ```

3. **Configure Environment Variables:**
   ```powershell
   $env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/genesis"
   $env:PG_RUNTIME_ROLE = "app_runtime"
   ```

---

## Starting Application Services

### 1. Start the Durable Financial API Server
The API server exposes REST endpoints for trade accounts, credit checks, journal posting, and statement generation.

```powershell
# Development mode with file watching:
pnpm --filter @genesis-shopify/api dev

# Or production start:
pnpm --filter @genesis-shopify/api start
```
The API boots, applies pending migrations idempotently, seeds initial fixtures if configured (`SEED_DEMO_DATA=true`), and listens on port 3000 (configurable via `PORT`).

### 2. Start the Background Worker
The worker processes asynchronous jobs, including batch statement generation, delivery dispatch, and webhook processing.

```powershell
pnpm --filter @genesis-shopify/worker start
```

---

## Running Test & Verification Suites

### 1. Full Monorepo Test Suite
Runs unit tests, domain proofs, database migration tests, worker tests, and all integration tests:
```powershell
pnpm test
```

### 2. Dedicated PostgreSQL Runtime & Concurrency Suite
Tests multi-connection pooling, tenant concurrency, transaction savepoints, connection leak prevention, and disk-persisted restart survival:
```powershell
node --test tests/integration/postgres-runtime.test.ts
```

### 3. Type Checking & Production Build
```powershell
pnpm typecheck
pnpm shopify:typecheck
pnpm build
```

---

An agent using another computer needs their own Shopify CLI sign-in and local install. Never send them passwords, API secrets, `.env` files, `.shopify` state or a copied local session database. The repository's task instructions are in [the execution handoff](../plan/agent-execution-handoff.md), with statuses in [tracking.json](../plan/tracking.json). Ask the agent to run the checks above and report exact command results and evidence before changing a task to Completed.

## Repeatable embedded owner demo

For a signed-in DisplayDeck browser walkthrough, obtain your own Shopify user subject from the verified authentication context, then start the combined local runtime:

```powershell
$env:TRADE_DEMO_USER_ID='<your Shopify user subject>'
pnpm shopify:dev
```

The launcher starts the API on `127.0.0.1:3001`, uses the CLI-provided app credentials to verify real Shopify session tokens, seeds synthetic fixtures, and assigns that user an owner role only in the local synthetic tenant. It stores ledger records and tenant onboarding preferences in `.data/embedded-browser-demo`. Restart with the same directory to preserve postings and preferences. This mode refuses `NODE_ENV=production` or `DATABASE_URL`. Omit `TRADE_DEMO_USER_ID` to use your separately configured API. Do not run a second API on port 3001.

To reproduce the guide's initial figures without altering existing demo records, set `TRADE_DEMO_DATA_DIR` to a new unused directory, for example `.data/owner-demo-fresh-01`, before starting. Reuse that directory on restart. Existing directories retain financial actions; they are never automatically reset.

Use the guide at `/app/demo` in the embedded app. For the durable scenario, configure the same `PG_DATA_DIR` in the API and seed terminals, then run `pnpm seed:demo` as documented in [the synthetic demo evidence](evidence/synthetic-demo.md). The seed output includes the statement ID for `/app/statements?statementId=<id>`. Set `TRADE_API_URL` in the Shopify app runtime to the API origin and confirm the logged-in Shopify user has an actor record in the seeded tenant. The guide explicitly labels invoices and receipts as internal synthetic obligations; they are not Shopify orders or payments.

`pnpm test:e2e` runs the complete isolated receipt/allocation/reversal/statement/email-capture lifecycle, including restart persistence. It creates a temporary PGlite database and sends mail only to the in-process capture provider. It does not prove a browser session, Shopify order or POS device, or real email provider. See [synthetic demo evidence](evidence/synthetic-demo.md) for expected totals and remaining external checks.

In durable embedded mode, the Statements page can build a new statement snapshot for the selected account and period. The API accepts `POST /v1/statements/run`, requires the `run_statements` permission and an `Idempotency-Key`, and returns the selected immutable statement ID. Preview memory mode disables statement building.
