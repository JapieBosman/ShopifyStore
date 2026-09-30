import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getStorageMode } from "../trade-accounts.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return {
    shop: session.shop,
    storageMode: getStorageMode(),
  };
};

export default function OwnerDemoGuide() {
  const { shop, storageMode } = useLoaderData<typeof loader>();
  const isDurable = storageMode === "durable_api";
  const demoAccountId = isDurable
    ? "11111111-1111-4111-8111-111111111111"
    : "acc-001";

  return (
    <main className="trade-container">
      <header className="trade-header">
        <div className="trade-header-title">
          <h1>Repeatable Owner Demo</h1>
          <p>Guided synthetic account, receipt, allocation and statement walkthrough for {shop}</p>
        </div>
      </header>

      <div className="trade-banner trade-banner-info" role="note">
        <div>
          <strong>{isDurable ? "Durable API mode configured" : "In-memory preview"}.</strong>{" "}
          {isDurable
            ? "Confirm the seeded account loads before continuing. Fixture invoices and receipts are internal synthetic obligations, not Shopify orders or payments."
            : "Actions in this preview are simulated in memory and disappear when the app process restarts. They do not create Shopify orders or payments."}
        </div>
      </div>

      <section className="trade-card" aria-labelledby="demo-start-heading">
        <h2 id="demo-start-heading" className="trade-card-title">Before you start</h2>
        <ol>
          <li>Use the synthetic fixtures from <code>pnpm seed:demo</code> with the persistent database configured as described in Local Testing.</li>
          <li>Open this page in the embedded Shopify app after the API is connected. Confirm the banner says <strong>Durable API mode configured</strong>.</li>
          <li>Use a fresh demo database for the starting figures below. An existing demo retains earlier receipts and reversals; compare its actual balance before posting again.</li>
          <li>Keep every account number and invoice reference below labelled as synthetic. No Shopify test order is created by this walkthrough.</li>
        </ol>
        <p>
          <Link className="trade-btn trade-btn-secondary" to="/app/onboarding">Review Shopify setup</Link>
        </p>
      </section>

      <section className="trade-card" aria-labelledby="demo-steps-heading">
        <h2 id="demo-steps-heading" className="trade-card-title">Walkthrough</h2>
        <ol>
          <li>
            <strong>Inspect the debtor and credit policy.</strong> In <Link to="/app/accounts">Trade Accounts</Link>, open ACC-001, Ubuntu Hardware Trade. The synthetic fixture starts with a R 25,000 limit and R 6,300 open balance. Review the visible invoice remainders and eight aging buckets. ACC-003 is separately seeded on hold with a R 10,000 limit.
          </li>
          <li>
            <strong>Record a partial receipt.</strong> In the <Link to={`/app/allocations?accountId=${demoAccountId}`}>Allocation Workbench</Link>, choose ACC-001 and record an external receipt of R 2,000 using oldest-first allocation. The receipt is synthetic EFT-DEMO-01. It clears the R 2,000 remainder of INV-2026-001; R 4,300 remains open across the other invoices.
          </li>
          <li>
            <strong>Show overpayment and unapplied cash.</strong> Record synthetic receipt EFT-DEMO-02 for R 6,000 and allocate oldest-first. The R 4,300 open invoices are settled and R 1,700 remains unapplied as account credit.
          </li>
          <li>
            <strong>Reverse one allocation.</strong> Reverse the allocation against INV-2026-003 with an audit reason. The invoice reopens at R 2,800, unapplied credit becomes R 4,500, and the net account balance stays a R 1,700 credit. The original allocation remains in history as reversed.
          </li>
          <li>
            <strong>Build and review the updated statement.</strong> On <Link to="/app/statements">Statements</Link>, select ACC-001 and set the period to 2026-09-01 through 2026-09-30, then choose Build Immutable Statement after the receipts and reversal. Its closing balance is a R 1,700 credit. Confirm the PDF hash and statement delivery status. Send only when `STATEMENT_EMAIL_WEBHOOK_URL` points to a local capture gateway; the automated lifecycle uses an in-process capture provider and sends no customer email.
          </li>
        </ol>
      </section>

      <section className="trade-card" aria-labelledby="demo-boundaries-heading">
        <h2 id="demo-boundaries-heading" className="trade-card-title">Evidence boundaries</h2>
        <ul>
          <li>The invoices and receipts are internal synthetic ledger documents. They are not linked to Shopify orders, Shopify payment transactions or POS-device sales.</li>
          <li>The lifecycle test proves financial posting, allocation, reversal, statement PDF integrity, local email capture and database restart persistence using an isolated PGlite database.</li>
          <li>A browser preview in in-memory mode is visual-only evidence. Its simulated receipts and statement delivery do not persist and must not be described as posted or sent.</li>
          <li>Real email-provider acceptance and physical Shopify POS order/payment outcomes remain separate verification gates.</li>
        </ul>
      </section>
    </main>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
