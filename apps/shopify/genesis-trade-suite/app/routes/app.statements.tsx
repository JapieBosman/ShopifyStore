import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getDebtorsList,
  getStatement,
  deliverStatement,
  getStatementDeliveries,
  isDemoMode,
  type StatementRecord,
  type StatementDeliveryRecord,
} from "../trade-accounts.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const statementId = url.searchParams.get("statementId") || "stmt-demo-001";

  const allAccounts = await getDebtorsList(undefined, undefined, request);
  let statement: StatementRecord | null = null;
  let deliveries: StatementDeliveryRecord[] = [];
  let error: string | null = null;

  try {
    statement = await getStatement(statementId, request);
    deliveries = await getStatementDeliveries(statementId, request);
  } catch (err) {
    error = (err as Error).message;
  }

  return {
    accounts: allAccounts,
    statementId,
    statement,
    deliveries,
    error,
    isDemo: isDemoMode(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "deliver") {
    const statementId = formData.get("statementId")?.toString() || "";
    const recipientEmail = formData.get("recipientEmail")?.toString() || "";
    const idempotencyKey =
      formData.get("idempotencyKey")?.toString() ||
      `idem-del-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    if (!recipientEmail || !recipientEmail.includes("@")) {
      return { success: false, error: "Please provide a valid recipient email address." };
    }

    try {
      const delivery = await deliverStatement(
        statementId,
        { recipientEmail, idempotencyKey },
        request,
      );
      return { success: true, delivery };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  return { success: false, error: "Unsupported intent" };
};

export default function StatementsWorkbench() {
  const { statementId, statement, deliveries, error, isDemo } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [recipientEmail, setRecipientEmail] = useState(
    statement?.legalName ? "accounts@client.example.com" : "",
  );

  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="trade-container" role="main">
      {/* Top Header */}
      <div className="trade-header">
        <div className="trade-header-title">
          <Link to="/app/accounts" className="back-link" aria-label="Back to trade accounts">
            ← Trade Accounts
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
            <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>Statements &amp; Delivery</h1>
            {isDemo && (
              <span className="badge badge-warning" style={{ fontSize: "0.75rem" }}>
                Simulation Preview
              </span>
            )}
          </div>
          <p style={{ margin: "0.25rem 0 0 0", color: "#6d7175", fontSize: "0.875rem" }}>
            Authorise, generate, and dispatch monthly debtor statements with cryptographic signed URLs.
          </p>
        </div>
      </div>

      {/* Action Notifications */}
      {actionData?.success && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: "0.75rem 1rem",
            backgroundColor: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "6px",
            color: "#166534",
            marginBottom: "1rem",
            fontSize: "0.875rem",
          }}
        >
          ✓ Statement delivery dispatched successfully (Status: {actionData.delivery?.status}). Provider Message ID: {actionData.delivery?.providerMessageId}
        </div>
      )}

      {actionData?.error && (
        <div
          role="alert"
          style={{
            padding: "0.75rem 1rem",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "6px",
            color: "#991b1b",
            marginBottom: "1rem",
            fontSize: "0.875rem",
          }}
        >
          ✕ {actionData.error}
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            padding: "0.75rem 1rem",
            backgroundColor: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: "6px",
            color: "#92400e",
            marginBottom: "1rem",
            fontSize: "0.875rem",
          }}
        >
          Notice: {error}
        </div>
      )}

      {statement ? (
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "1.5rem" }}>
          {/* Statement Metadata & Balances */}
          <div className="card" role="region" aria-label="Statement Summary">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
              <div>
                <h2 style={{ fontSize: "1.125rem", margin: 0, fontWeight: 600 }}>
                  Statement {statement.accountNumber}
                </h2>
                <p style={{ margin: "0.25rem 0 0 0", color: "#6d7175", fontSize: "0.875rem" }}>
                  Customer: <strong>{statement.legalName}</strong>
                </p>
              </div>
              <span
                className={`badge ${
                  statement.status === "ready"
                    ? "badge-success"
                    : statement.status === "failed"
                      ? "badge-critical"
                      : "badge-warning"
                }`}
              >
                {statement.status}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <div style={{ background: "#f6f6f7", padding: "0.75rem", borderRadius: "6px" }}>
                <span style={{ fontSize: "0.75rem", color: "#6d7175" }}>Opening Balance</span>
                <div style={{ fontWeight: 600, fontSize: "1rem" }}>
                  {statement.currency} {statement.openingBalance}
                </div>
              </div>
              <div style={{ background: "#f6f6f7", padding: "0.75rem", borderRadius: "6px" }}>
                <span style={{ fontSize: "0.75rem", color: "#6d7175" }}>Billed Debits</span>
                <div style={{ fontWeight: 600, fontSize: "1rem", color: "#166534" }}>
                  +{statement.currency} {statement.debits}
                </div>
              </div>
              <div style={{ background: "#f6f6f7", padding: "0.75rem", borderRadius: "6px" }}>
                <span style={{ fontSize: "0.75rem", color: "#6d7175" }}>Credits / Receipts</span>
                <div style={{ fontWeight: 600, fontSize: "1rem", color: "#2563eb" }}>
                  -{statement.currency} {statement.credits}
                </div>
              </div>
              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "0.75rem", borderRadius: "6px" }}>
                <span style={{ fontSize: "0.75rem", color: "#1e40af" }}>Closing Balance</span>
                <div style={{ fontWeight: 700, fontSize: "1.125rem", color: "#1e3a8a" }}>
                  {statement.currency} {statement.closingBalance}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <span style={{ fontSize: "0.75rem", color: "#6d7175", display: "block", marginBottom: "0.25rem" }}>
                Cryptographic Artifact Verification
              </span>
              <code style={{ fontSize: "0.75rem", background: "#f1f2f3", padding: "0.25rem 0.5rem", borderRadius: "4px", wordBreak: "break-all" }}>
                SHA-256: {statement.pdfSha256 || "Unrendered preview"}
              </code>
            </div>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              {statement.downloadUrl && (
                <a
                  href={statement.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                  style={{ textDecoration: "none" }}
                  aria-label="Download verified PDF statement"
                >
                  📄 View / Download Verified PDF
                </a>
              )}
            </div>
          </div>

          {/* Delivery Dispatch Form */}
          <div className="card" role="region" aria-label="Statement Delivery">
            <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.5rem 0", fontWeight: 600 }}>
              Dispatch Email Statement
            </h2>
            <p style={{ margin: "0 0 1rem 0", color: "#6d7175", fontSize: "0.875rem" }}>
              Dispatches an official statement notification containing an expiring signed URL link.
            </p>

            <Form method="post">
              <input type="hidden" name="intent" value="deliver" />
              <input type="hidden" name="statementId" value={statement.id} />

              <div style={{ marginBottom: "1rem" }}>
                <label
                  htmlFor="recipientEmail"
                  style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.25rem" }}
                >
                  Debtor Billing Email Address
                </label>
                <input
                  id="recipientEmail"
                  type="email"
                  name="recipientEmail"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  required
                  placeholder="billing@debtor-company.co.za"
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    border: "1px solid #c9cccf",
                    borderRadius: "6px",
                    fontSize: "0.875rem",
                  }}
                />
              </div>

              <div style={{ marginBottom: "1.25rem", padding: "0.75rem", background: "#f0f9ff", borderRadius: "6px", fontSize: "0.75rem", color: "#0369a1" }}>
                ℹ️ Delivery is protected by per-tenant idempotency keys. Links expire after 7 days and reject requests for other stores.
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !recipientEmail}
                className="btn btn-primary"
                style={{ width: "100%" }}
              >
                {isSubmitting ? "Dispatching Statement..." : "✉️ Authorise & Send Statement"}
              </button>
            </Form>

            {/* Delivery Audit History */}
            <div style={{ marginTop: "1.5rem", borderTop: "1px solid #e1e3e5", paddingTop: "1rem" }}>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0 0 0.5rem 0" }}>
                Delivery Log ({deliveries.length})
              </h3>
              {deliveries.length === 0 ? (
                <p style={{ fontSize: "0.75rem", color: "#6d7175", margin: 0 }}>
                  No delivery attempts recorded for this statement.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {deliveries.map((del) => (
                    <div
                      key={del.id}
                      style={{
                        padding: "0.5rem 0.75rem",
                        background: "#fafbfb",
                        border: "1px solid #ebebeb",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                        <span style={{ fontWeight: 600 }}>{del.channel.toUpperCase()}</span>
                        <span
                          className={`badge ${
                            del.status === "delivered" || del.status === "accepted"
                              ? "badge-success"
                              : del.status === "uncertain"
                                ? "badge-warning"
                                : "badge-critical"
                          }`}
                        >
                          {del.status}
                        </span>
                      </div>
                      <div style={{ color: "#6d7175" }}>
                        Recipient: <code>{del.recipientSecretRef}</code>
                      </div>
                      <div style={{ color: "#8c9196", fontSize: "0.7rem", marginTop: "0.25rem" }}>
                        Attempt #{del.attemptCount} • {new Date(del.createdAt).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <p style={{ color: "#6d7175", margin: 0 }}>Select or generate a statement run to begin delivery.</p>
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(null);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
