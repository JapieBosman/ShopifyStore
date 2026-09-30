# Repeatable synthetic owner demo

## Scope

The embedded guide is available at `/app/demo` in the installed React Router Shopify app. It walks through the debtor directory, account detail, receipt and allocation workbench, reversal history and statement delivery page. The fixtures represent internal ledger obligations. They are not Shopify orders, Shopify payments or a physical POS sale.

The durable API mode is configured with `TRADE_API_URL`. The guide labels in-memory preview actions as simulated and warns that they disappear on restart. Do not describe preview receipts as posted or preview email as sent.

## Start and seed

For the installed embedded walkthrough, use the combined launcher in [Local Testing](../LOCAL-TESTING.md):

```powershell
$env:TRADE_DEMO_USER_ID = '<your verified Shopify user subject>'
$env:TRADE_DEMO_DATA_DIR = '.data/owner-demo-fresh-01'
pnpm shopify:dev
```

Choose a new unused data directory for the initial figures below. The launcher seeds before starting the API, configures genuine Shopify token verification using CLI credentials and starts both API and embedded preview. Reuse the same directory to check restart persistence. Reseeding an existing directory retains its receipts, reversals and accounts; it does not reset the financial scenario. Never start a separate seeder or API against a PGlite directory already open by another process.

For a standalone API demonstration, stop the API before seeding. From `C:\Github\Shopify`, configure app credentials as documented in Local Testing, then seed:

```powershell
$env:PG_DATA_DIR = "C:\Github\Shopify\.data\owner-demo"
pnpm seed:demo
```

After the seed process exits, start the API with the same directory:

```powershell
Set-Location C:\Github\Shopify
$env:PG_DATA_DIR = "C:\Github\Shopify\.data\owner-demo"
$env:PORT = "3001"
pnpm --filter @genesis-shopify/api dev
```

The seed command prints the statement ID and artifact hash. Keep the ID for the embedded Statements page. Configure the Shopify app's `TRADE_API_URL` to the API origin, then start its preview using `pnpm shopify:dev`. The actual logged-in Shopify user must have an active actor record in the seeded tenant; the demo seed does not grant the current user a role.

## Embedded walkthrough and expected figures

Open the owner demo guide in the embedded app and follow its links. The repeatable lifecycle proof uses ACC-001, Ubuntu Hardware Trade, with a R 25,000 credit limit and R 6,300 initial net balance. Its internal synthetic obligations are INV-2026-001 (R 3,200), INV-2026-002 (R 1,500), INV-2026-003 (R 2,800), and RCT-2026-001 (R 1,200 allocated to the first invoice). ACC-003, Highveld Industrial Tools, is on hold with a R 10,000 limit.

The lifecycle scenario then:

1. Posts synthetic external receipt EFT-DEMO-01 for R 2,000 and allocates it oldest-first. This clears the R 2,000 remainder on INV-2026-001; R 4,300 remains open.
2. Posts EFT-DEMO-02 for R 6,000 and allocates R 4,300 to the remaining invoices. R 1,700 remains as unapplied credit; net balance is R 1,700 credit.
3. Reverses the allocation against INV-2026-003. The invoice reopens at R 2,800, unapplied credit becomes R 4,500, and net balance remains R 1,700 credit.
4. Build a fresh immutable statement for 2026-09-01 through 2026-09-30 from the embedded Statements page after the receipt and reversal flow. The account PDF's closing balance is -R 1,700; the exact downloaded bytes match the stored SHA-256. The seed command also builds an earlier baseline statement. The statement-run API builds tenant snapshots with a selected account result and uses an idempotency key to make action retries return the same result.
5. Sends the statement to a local capture provider. The test asserts one captured email and confirms that delivery state and the PDF hash survive a database restart. Do not use the embedded send action unless `STATEMENT_EMAIL_WEBHOOK_URL` points to a local test gateway.

## Verification evidence

`tests/e2e/trade-demo.spec.ts` runs the full lifecycle through the API and worker against a temporary persisted PGlite database. It verifies seed idempotency, initial balances and aging, credit hold/limit outcomes, both receipts, FIFO allocations, overpayment remainder, immutable reversal, PDF bytes/hash, one local captured email, tenant isolation, and post-restart persistence.

The automated lifecycle test verifies the fresh-directory scenario, including local email capture. The signed-in browser walkthrough is recorded in [the 2026-09-30 evidence](browser-walkthrough-2026-09-30.md), with durable account/reversal, onboarding, restart and statement screenshots. The owner confirmed PDF download, account/policy persistence, stale-write rejection, search and keyboard account navigation. No real recipient receives a message in the E2E run.

The existing `.data/embedded-browser-demo` session follows a different recorded branch: its R2000 partial-receipt allocation was reversed before any R6000 receipt. Net balance is therefore R4300, open invoices R6300 and unapplied credit R2000. Its September statement closes at R4300 and its verified PDF SHA-256 is `81cb9db36be748a847844c2fb7542108cf4daf93e45e279efd7faa2a30144152`. These figures match the recorded actions; do not expect the fresh-scenario R1700 credit in this existing directory. The owner's TEST-017-01 account is also retained there.

## Remaining external checks

- TASK-017 completed on 2026-09-30 with signed-in browser and owner acceptance evidence.
- TASK-019 remains in progress until delivery is verified with an actual configured email provider or its sandbox, including authenticated callback behavior. The local gateway proves retry and uncertainty handling only. Preview startup and browser PDF routing have been repaired.
- Shopify order and physical POS-device flows remain outside this demo and require their own TASK-020/platform evidence.
