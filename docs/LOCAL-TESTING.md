# Start and test Genesis Trade Suite

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

An agent using another computer needs their own Shopify CLI sign-in and local install. Never send them passwords, API secrets, `.env` files, `.shopify` state or a copied local session database. The repository's task instructions are in [the execution handoff](../plan/agent-execution-handoff.md), with statuses in [tracking.json](../plan/tracking.json). Ask the agent to run the checks above and report exact command results and evidence before changing a task to Completed.
