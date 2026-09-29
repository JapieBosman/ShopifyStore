import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getDebtorDetails, updateDebtorPolicy } from "../trade-accounts.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const accountId = params.id;
  if (!accountId) {
    throw new Response("Account ID required", { status: 400 });
  }

  const details = await getDebtorDetails(accountId, request);
  if (!details) {
    throw new Response("Debtor account not found", { status: 404 });
  }

  return { details };
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const accountId = params.id;
  if (!accountId) return { error: "Account ID required" };

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update_policy") {
    const creditLimit = formData.get("creditLimit")?.toString();
    const status = formData.get("status")?.toString() as "active" | "hold" | "closed";
    const termsType = formData.get("termsType")?.toString() as "net_monthly" | "eom" | "cod";
    const termsDays = Number(formData.get("termsDays") || 30);
    const expectedPolicyVersion = Number(formData.get("expectedPolicyVersion") || 1);
    const reason = formData.get("reason")?.toString() || "";

    try {
      const updated = await updateDebtorPolicy(
        accountId,
        {
          creditLimit,
          status,
          termsType,
          termsDays,
          expectedPolicyVersion,
          reason,
        },
        request
      );
      return { success: true, message: `Policy updated to version ${updated.policyVersion}` };
    } catch (err: any) {
      return { error: err.message || "Failed to update policy" };
    }
  }

  return null;
};

export default function DebtorAccountDetails() {
  const { details } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const { account, balances, exposure, aging, documents, allocations } = details;

  return (
    <div className="trade-container">
      {/* Breadcrumb / Back Link */}
      <div style={{ marginBottom: "12px" }}>
        <Link to="/app/accounts" style={{ color: "var(--p-color-interactive)", textDecoration: "none", fontSize: "14px" }}>
          ← Back to Trade Accounts
        </Link>
      </div>

      {/* Header */}
      <div className="trade-header">
        <div className="trade-header-title">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h1>{account.name}</h1>
            <span className={`trade-badge trade-badge-${account.status}`}>
              {account.status}
            </span>
            <span className="trade-badge trade-badge-info">
              Ledger v{account.ledgerVersion}
            </span>
          </div>
          <p>
            Account #{account.accountNumber} · Currency: {account.currency} · Policy v{account.policyVersion}
          </p>
        </div>
        <div className="trade-header-actions">
          <Link
            to={`/app/allocations?accountId=${account.id}`}
            className="trade-btn trade-btn-primary"
          >
            Record Payment / Allocate
          </Link>
        </div>
      </div>

      {/* Feedback Banners */}
      {actionData?.success && (
        <div className="trade-banner trade-banner-success" role="status">
          ✓ {actionData.message}
        </div>
      )}
      {actionData?.error && (
        <div className="trade-banner trade-banner-warning" role="alert">
          ⚠ {actionData.error}
        </div>
      )}

      {/* Balances & Real-Time Exposure Summary */}
      <div className="trade-metrics-grid" role="region" aria-label="Balances and Credit Exposure">
        <div className="trade-metric-card">
          <div className="trade-metric-label">Credit Limit</div>
          <div className="trade-metric-value">{account.currency} {account.creditLimit}</div>
          <div className="trade-metric-subtext">Approved policy ceiling</div>
        </div>
        <div className="trade-metric-card">
          <div className="trade-metric-label">Net AR Balance</div>
          <div className="trade-metric-value" style={{ color: parseFloat(balances.netBalance) > 0 ? "inherit" : "var(--p-color-success-text)" }}>
            {account.currency} {balances.netBalance}
          </div>
          <div className="trade-metric-subtext">Open debits minus credits</div>
        </div>
        <div className="trade-metric-card">
          <div className="trade-metric-label">Active Reservations</div>
          <div className="trade-metric-value">{account.currency} {exposure.activeReservations}</div>
          <div className="trade-metric-subtext">Pending POS basket commitments</div>
        </div>
        <div className="trade-metric-card">
          <div className="trade-metric-label">Available Credit</div>
          <div
            className="trade-metric-value"
            style={{ color: parseFloat(exposure.availableCredit) <= 0 ? "var(--p-color-critical-text)" : "var(--p-color-success-text)" }}
          >
            {account.currency} {exposure.availableCredit}
          </div>
          <div className="trade-metric-subtext">Remaining authorization headroom</div>
        </div>
      </div>

      {/* 8-Bucket Aging Snapshot */}
      <div className="trade-card" role="region" aria-label="8-Bucket Aging Snapshot">
        <div className="trade-card-header">
          <h2 className="trade-card-title">Due-Date 8-Bucket Aging Breakdown</h2>
          <span className="trade-badge trade-badge-active" style={{ fontSize: "11px" }}>
            Fresh Snapshot (v{account.ledgerVersion})
          </span>
        </div>
        <p style={{ fontSize: "13px", color: "var(--p-color-text-secondary)", margin: "0 0 10px" }}>
          Calculated from immutable subledger documents against due dates. Unapplied credit offset: {account.currency} {aging.unappliedCredit}
        </p>
        <div className="trade-aging-grid">
          <div className="trade-aging-cell">
            <div className="trade-aging-label">Current</div>
            <div className="trade-aging-value">{aging.current}</div>
          </div>
          <div className={`trade-aging-cell ${parseFloat(aging.d030) > 0 ? "active-debt" : ""}`}>
            <div className="trade-aging-label">1–30 Days</div>
            <div className="trade-aging-value">{aging.d030}</div>
          </div>
          <div className={`trade-aging-cell ${parseFloat(aging.d060) > 0 ? "active-debt" : ""}`}>
            <div className="trade-aging-label">31–60 Days</div>
            <div className="trade-aging-value">{aging.d060}</div>
          </div>
          <div className={`trade-aging-cell ${parseFloat(aging.d090) > 0 ? "active-debt" : ""}`}>
            <div className="trade-aging-label">61–90 Days</div>
            <div className="trade-aging-value">{aging.d090}</div>
          </div>
          <div className={`trade-aging-cell ${parseFloat(aging.d120) > 0 ? "active-debt" : ""}`}>
            <div className="trade-aging-label">91–120 Days</div>
            <div className="trade-aging-value">{aging.d120}</div>
          </div>
          <div className={`trade-aging-cell ${parseFloat(aging.d150) > 0 ? "active-debt" : ""}`}>
            <div className="trade-aging-label">121–150 Days</div>
            <div className="trade-aging-value">{aging.d150}</div>
          </div>
          <div className={`trade-aging-cell ${parseFloat(aging.d180) > 0 ? "active-debt" : ""}`}>
            <div className="trade-aging-label">151–180 Days</div>
            <div className="trade-aging-value">{aging.d180}</div>
          </div>
          <div className={`trade-aging-cell ${parseFloat(aging.over) > 0 ? "active-debt" : ""}`}>
            <div className="trade-aging-label">180+ Days</div>
            <div className="trade-aging-value">{aging.over}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "20px" }}>
        {/* Open Invoices Table */}
        <div className="trade-card" role="region" aria-label="Open Invoices and Documents">
          <div className="trade-card-header">
            <h2 className="trade-card-title">Invoices & Documents</h2>
            <span style={{ fontSize: "12px", color: "var(--p-color-text-secondary)" }}>
              {documents.length} recorded
            </span>
          </div>

          <div className="trade-table-wrapper">
            <table className="trade-table">
              <thead>
                <tr>
                  <th scope="col">Document #</th>
                  <th scope="col">Due Date</th>
                  <th scope="col" className="num">Total Amount</th>
                  <th scope="col" className="num">Allocated</th>
                  <th scope="col" className="num">Remaining Balance</th>
                </tr>
              </thead>
              <tbody>
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "20px", color: "var(--p-color-text-secondary)" }}>
                      No documents found for this account.
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => (
                    <tr key={doc.id}>
                      <td style={{ fontWeight: 600 }}>{doc.documentNumber}</td>
                      <td>{doc.dueOn}</td>
                      <td className="num">{account.currency} {doc.amount}</td>
                      <td className="num">{account.currency} {doc.allocatedAmount}</td>
                      <td className="num" style={{ fontWeight: 700, color: parseFloat(doc.remainingAmount) > 0 ? "#123d32" : "var(--p-color-text-secondary)" }}>
                        {account.currency} {doc.remainingAmount}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Policy Settings Form */}
        <div className="trade-card" role="region" aria-label="Credit Policy Settings">
          <div className="trade-card-header">
            <h2 className="trade-card-title">Credit Policy & Terms</h2>
            <span className="trade-badge trade-badge-info">v{account.policyVersion}</span>
          </div>

          <Form method="post" className="trade-form">
            <input type="hidden" name="intent" value="update_policy" />
            <input type="hidden" name="expectedPolicyVersion" value={account.policyVersion} />

            <div className="trade-field">
              <label htmlFor="creditLimit">Credit Limit ({account.currency})</label>
              <input
                id="creditLimit"
                name="creditLimit"
                type="number"
                step="0.01"
                min="0"
                defaultValue={account.creditLimit}
                required
                className="trade-input"
              />
            </div>

            <div className="trade-field">
              <label htmlFor="status">Account Status</label>
              <select id="status" name="status" defaultValue={account.status} className="trade-select">
                <option value="active">Active (Permits Account Sales)</option>
                <option value="hold">On Hold (Declines Account Sales)</option>
                <option value="closed">Closed (No New Credit)</option>
              </select>
            </div>

            <div className="trade-field">
              <label htmlFor="termsType">Payment Terms</label>
              <select id="termsType" name="termsType" defaultValue={account.termsType} className="trade-select">
                <option value="net_monthly">Net Days</option>
                <option value="eom">End of Month (EOM)</option>
                <option value="cod">Cash on Delivery (COD)</option>
              </select>
            </div>

            <div className="trade-field">
              <label htmlFor="termsDays">Terms Days</label>
              <input
                id="termsDays"
                name="termsDays"
                type="number"
                min="0"
                max="365"
                defaultValue={account.termsDays}
                className="trade-input"
              />
            </div>

            <div className="trade-field">
              <label htmlFor="reason">Adjustment Reason (Audit Trail)</label>
              <input
                id="reason"
                name="reason"
                type="text"
                placeholder="e.g. Credit review approval, seasonal increase"
                required
                className="trade-input"
              />
              <span className="trade-field-hint">Required for manager/owner audit log</span>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="trade-btn trade-btn-primary"
              style={{ width: "100%", marginTop: "10px" }}
            >
              {isSubmitting ? "Saving Policy..." : "Save Policy Settings"}
            </button>
          </Form>
        </div>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
