import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { useEffect, useRef } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getDebtorsList } from "../trade-accounts.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q") || "";
  const status = url.searchParams.get("status") || "all";

  const accounts = await getDebtorsList(search, status, request);

  // Compute aggregated summary metrics
  let totalDebt = 0;
  let totalAvailable = 0;
  let onHoldCount = 0;

  for (const acc of accounts) {
    totalDebt += parseFloat(acc.netBalance) || 0;
    totalAvailable += parseFloat(acc.availableCredit) || 0;
    if (acc.status === "hold") onHoldCount++;
  }

  return {
    accounts,
    search,
    status,
    summary: {
      totalAccounts: accounts.length,
      totalDebt: totalDebt.toFixed(2),
      totalAvailable: totalAvailable.toFixed(2),
      onHoldCount,
    },
  };
};

export default function AccountsDirectory() {
  const { accounts, search, status, summary } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Pressing '/' focuses the search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="trade-container">
      {/* Header */}
      <div className="trade-header">
        <div className="trade-header-title">
          <h1>Trade Accounts</h1>
          <p>B2B credit accounts, payment terms, and credit exposure</p>
        </div>
        <div className="trade-header-actions">
          <Link to="/app/accounts/new" className="trade-btn trade-btn-primary">
            + New Trade Account
          </Link>
        </div>
      </div>

      {/* Metrics Summary Strip */}
      <div className="trade-metrics-grid" role="region" aria-label="Accounts Summary">
        <div className="trade-metric-card">
          <div className="trade-metric-label">Total Accounts</div>
          <div className="trade-metric-value">{summary.totalAccounts}</div>
          <div className="trade-metric-subtext">Active trade debtors</div>
        </div>
        <div className="trade-metric-card">
          <div className="trade-metric-label">Total Posted AR Debt</div>
          <div className="trade-metric-value">R {summary.totalDebt}</div>
          <div className="trade-metric-subtext">Net outstanding balance</div>
        </div>
        <div className="trade-metric-card">
          <div className="trade-metric-label">Total Available Credit</div>
          <div className="trade-metric-value">R {summary.totalAvailable}</div>
          <div className="trade-metric-subtext">Unused credit headroom</div>
        </div>
        <div className="trade-metric-card">
          <div className="trade-metric-label">Accounts on Hold</div>
          <div className="trade-metric-value" style={{ color: summary.onHoldCount > 0 ? "var(--p-color-warning-text)" : "inherit" }}>
            {summary.onHoldCount}
          </div>
          <div className="trade-metric-subtext">Requires credit review</div>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="trade-card">
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <form method="get" style={{ display: "flex", gap: "8px", flex: "1", minWidth: "260px" }} role="search">
            <input
              ref={searchInputRef}
              type="text"
              name="q"
              defaultValue={search}
              placeholder="Search by customer name, account #, or email... (Press / to focus)"
              className="trade-input"
              style={{ flex: 1 }}
              aria-label="Search trade accounts"
            />
            <input type="hidden" name="status" value={status} />
            <button type="submit" className="trade-btn trade-btn-secondary">
              Search
            </button>
            {search && (
              <Link to="/app/accounts" className="trade-btn trade-btn-secondary" aria-label="Clear search">
                Clear
              </Link>
            )}
          </form>

          {/* Status Tabs */}
          <div role="tablist" aria-label="Filter accounts by status" style={{ display: "flex", gap: "4px" }}>
            {(["all", "active", "hold", "closed"] as const).map((s) => (
              <Link
                key={s}
                to={`/app/accounts?status=${s}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
                role="tab"
                aria-selected={status === s}
                className={`trade-btn trade-btn-sm ${status === s ? "trade-btn-primary" : "trade-btn-secondary"}`}
                style={{ textTransform: "capitalize" }}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Accounts Directory Table */}
      <div className="trade-table-wrapper" role="region" aria-label="Trade Accounts Directory">
        <table className="trade-table">
          <thead>
            <tr>
              <th scope="col">Account #</th>
              <th scope="col">Debtor Name</th>
              <th scope="col">Shopify Customer GID</th>
              <th scope="col">Payment Terms</th>
              <th scope="col" className="num">Credit Limit</th>
              <th scope="col" className="num">Net AR Balance</th>
              <th scope="col" className="num">Available Credit</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: "32px", color: "var(--p-color-text-secondary)" }}>
                  No trade accounts match your search filter.{" "}
                  <Link to="/app/accounts" style={{ color: "var(--p-color-interactive)" }}>
                    View all accounts
                  </Link>
                </td>
              </tr>
            ) : (
              accounts.map((acc) => (
                <tr key={acc.id} tabIndex={0} aria-label={`Account ${acc.accountNumber}: ${acc.name}`}>
                  <td style={{ fontWeight: 600 }}>
                    <Link to={`/app/accounts/${acc.id}`} style={{ color: "var(--p-color-interactive)", textDecoration: "none" }}>
                      {acc.accountNumber}
                    </Link>
                  </td>
                  <td>
                    <strong>{acc.name}</strong>
                    {acc.contactEmail && (
                      <div style={{ fontSize: "12px", color: "var(--p-color-text-secondary)" }}>
                        {acc.contactEmail}
                      </div>
                    )}
                  </td>
                  <td>
                    <code style={{ fontSize: "12px", background: "#f1f2f3", padding: "2px 5px", borderRadius: "4px" }}>
                      {acc.shopifyCustomerId.replace("gid://shopify/Customer/", "Cust #")}
                    </code>
                    {acc.shopifyCompanyId && (
                      <div style={{ fontSize: "11px", color: "#0070a0", marginTop: "2px" }}>
                        B2B Company Linked
                      </div>
                    )}
                  </td>
                  <td>
                    {acc.termsType === "net_monthly"
                      ? `Net ${acc.termsDays} Days`
                      : acc.termsType === "eom"
                      ? "End of Month"
                      : "Cash on Delivery"}
                  </td>
                  <td className="num">{acc.currency} {acc.creditLimit}</td>
                  <td className="num" style={{ fontWeight: 600, color: parseFloat(acc.netBalance) > 0 ? "inherit" : "var(--p-color-success-text)" }}>
                    {acc.currency} {acc.netBalance}
                  </td>
                  <td className="num" style={{ fontWeight: 600, color: parseFloat(acc.availableCredit) <= 0 ? "var(--p-color-critical-text)" : "inherit" }}>
                    {acc.currency} {acc.availableCredit}
                  </td>
                  <td>
                    <span className={`trade-badge trade-badge-${acc.status}`}>
                      {acc.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <Link
                        to={`/app/accounts/${acc.id}`}
                        className="trade-btn trade-btn-secondary trade-btn-sm"
                        aria-label={`View details for ${acc.name}`}
                      >
                        Details
                      </Link>
                      <Link
                        to={`/app/allocations?accountId=${acc.id}`}
                        className="trade-btn trade-btn-primary trade-btn-sm"
                        aria-label={`Record payment or allocate for ${acc.name}`}
                      >
                        Pay / Allocate
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
