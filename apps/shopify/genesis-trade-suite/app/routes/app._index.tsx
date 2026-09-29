import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { evaluateCredit } from "../../../../../packages/domain/src/credit.ts";

const demoAccount = {
  status: "active" as const,
  limit: "10000.00",
  netBalance: "3250.00",
  pendingReservations: "0.00",
  requestedCredit: "1200.00",
  confirmedDeposit: "0.00",
};

function zar(value: string): string {
  const [whole, fractional] = value.split(".");
  return `R ${whole?.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fractional?.slice(0, 2)}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop, decision: evaluateCredit(demoAccount) };
};

export default function Index() {
  const { shop, decision } = useLoaderData<typeof loader>();

  return (
    <div className="trade-container">
      <div className="trade-header">
        <div className="trade-header-title">
          <h1>Genesis Trade Suite</h1>
          <p>Connected store: <strong>{shop}</strong> · Pure Shopify-native trade accounts</p>
        </div>
      </div>

      <div className="trade-banner trade-banner-info" role="note">
        <div>
          <strong>Phase 4 Embedded Preview:</strong> Trade account management, allocation workbench, and onboarding are fully active. All calculations use the verified pure TypeScript domain engine.
        </div>
      </div>

      <div className="trade-metrics-grid">
        <div className="trade-card" style={{ margin: 0 }}>
          <h2 className="trade-card-title">Trade Accounts</h2>
          <p style={{ color: "var(--p-color-text-secondary)", fontSize: "14px", margin: "8px 0 16px" }}>
            Manage B2B credit accounts, 8-bucket aging snapshots, payment terms, and credit policy limits.
          </p>
          <a href="/app/accounts" className="trade-btn trade-btn-primary">
            Open Trade Accounts →
          </a>
        </div>

        <div className="trade-card" style={{ margin: 0 }}>
          <h2 className="trade-card-title">Allocation Workbench</h2>
          <p style={{ color: "var(--p-color-text-secondary)", fontSize: "14px", margin: "8px 0 16px" }}>
            Record payments across channels (EFT, manual, POS cash), allocate FIFO or explicitly, and view remainders.
          </p>
          <a href="/app/allocations" className="trade-btn trade-btn-primary">
            Open Workbench →
          </a>
        </div>

        <div className="trade-card" style={{ margin: 0 }}>
          <h2 className="trade-card-title">Setup & Onboarding</h2>
          <p style={{ color: "var(--p-color-text-secondary)", fontSize: "14px", margin: "8px 0 16px" }}>
            Configure regional currency, aging profiles, default credit rules. Zero Genesis server required.
          </p>
          <a href="/app/onboarding" className="trade-btn trade-btn-secondary">
            View Setup Wizard →
          </a>
        </div>
      </div>

      <div className="trade-card" style={{ marginTop: "24px" }}>
        <h2 className="trade-card-title">Verified Domain Rule Engine Proof</h2>
        <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
          <div>
            <span style={{ fontSize: "12px", color: "var(--p-color-text-secondary)" }}>Test Customer:</span>
            <div style={{ fontWeight: 600 }}>Ubuntu Hardware Trade</div>
          </div>
          <div>
            <span style={{ fontSize: "12px", color: "var(--p-color-text-secondary)" }}>Credit Limit / Balance:</span>
            <div style={{ fontWeight: 600 }}>{zar(demoAccount.limit)} / {zar(demoAccount.netBalance)}</div>
          </div>
          <div>
            <span style={{ fontSize: "12px", color: "var(--p-color-text-secondary)" }}>Credit Decision:</span>
            <div style={{ fontWeight: 600, color: "var(--p-color-success-text)" }}>
              {decision.kind === "approved" ? `Approved (${zar(decision.availableAfter)} available)` : decision.kind}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
