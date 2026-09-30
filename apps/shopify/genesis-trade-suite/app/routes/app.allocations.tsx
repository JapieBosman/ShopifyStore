import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { parseMoney, formatDisplayCurrency } from "../../../../../packages/domain/src/money.ts";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getDebtorsList,
  getDebtorDetails,
  recordPaymentAndAllocate,
  reverseAllocation,
  isDemoMode,
} from "../trade-accounts.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const allAccounts = await getDebtorsList(undefined, undefined, request);
  const accountId = url.searchParams.get("accountId") || allAccounts[0]?.id || "";
  const selectedDetails = await getDebtorDetails(accountId, request);
  const isDemo = isDemoMode();

  return {
    accounts: allAccounts,
    selectedAccountId: accountId,
    details: selectedDetails,
    isDemoMode: isDemo,
    receiptIdempotencyKey: crypto.randomUUID(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "allocate") {
    const debtorAccountId = formData.get("debtorAccountId")?.toString() || "";
    const receiptAmount = formData.get("receiptAmount")?.toString() || "0.00";
    const currency = formData.get("currency")?.toString() || "ZAR";
    const paymentMode = (formData.get("paymentMode")?.toString() || "external_receipt") as
      | "external_receipt"
      | "shopify_manual"
      | "shopify_pos_cash";
    const reference = formData.get("reference")?.toString() || "";
    const mode = (formData.get("mode")?.toString() || "oldest_first") as "oldest_first" | "explicit";

    const explicitAllocations: { invoiceId: string; amount: string }[] = [];
    if (mode === "explicit") {
      const invoiceIds = formData.getAll("selectedInvoiceId");
      for (const id of invoiceIds) {
        const amt = formData.get(`alloc_amt_${id}`)?.toString();
        if (amt && parseFloat(amt) > 0) {
          explicitAllocations.push({ invoiceId: id.toString(), amount: amt });
        }
      }
    }

    try {
      const result = await recordPaymentAndAllocate(
        {
          debtorAccountId,
          receiptAmount,
          currency,
          paymentMode,
          reference,
          mode,
          explicitAllocations: mode === "explicit" ? explicitAllocations : undefined,
          idempotencyKey: formData.get("receiptIdempotencyKey")?.toString(),
        },
        request
      );

      const modePrefix = result.storageMode === "durable_api" ? "[Durable API Ledger]" : "[Demo Simulation]";
      const modeSuffix = result.storageMode === "durable_api" ? "Committed to durable ledger." : "Operating in demo mode (not committed to durable ledger).";

      return {
        success: true,
        message: `${modePrefix} Posted receipt ${reference || "PAY"}. Allocated ${result.allocatedTotal} ${currency}; unapplied remainder: ${result.unallocatedRemainder} ${currency}. ${modeSuffix}`,
      };
    } catch (err: any) {
      return { error: err.message || "Failed to process allocation" };
    }
  }

  if (intent === "reverse") {
    const debtorAccountId = formData.get("debtorAccountId")?.toString() || "";
    const allocationId = formData.get("allocationId")?.toString() || "";
    const reason = formData.get("reason")?.toString() || "Operator correction";

    try {
      const result = await reverseAllocation(
        {
          debtorAccountId,
          allocationId,
          reason,
        },
        request
      );

      const modePrefix = result.storageMode === "durable_api" ? "[Durable API Ledger]" : "[Demo Simulation]";
      const modeSuffix = result.storageMode === "durable_api" ? "Committed reversal to ledger." : "In-memory simulation reversal.";

      return {
        success: true,
        message: `${modePrefix} Reversed allocation ${result.reversedAllocationId}. Reopened ${result.restoredAmount} on the invoice and restored the same unapplied credit; net balance is unchanged. ${modeSuffix}`,
      };
    } catch (err: any) {
      return { error: err.message || "Failed to reverse allocation" };
    }
  }

  return null;
};

export default function AllocationsWorkbench() {
  const { accounts, selectedAccountId, details, isDemoMode: isDemo, receiptIdempotencyKey } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [receiptAmount, setReceiptAmount] = useState<string>("2000.00");
  const [allocationMode, setAllocationMode] = useState<"oldest_first" | "explicit">("oldest_first");
  const [explicitAmounts, setExplicitAmounts] = useState<Record<string, string>>({});
  const [selectedInvoices, setSelectedInvoices] = useState<Record<string, boolean>>({});
  const [receiptKey, setReceiptKey] = useState(receiptIdempotencyKey);
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) setReceiptKey(receiptIdempotencyKey);
  }, [actionData, receiptIdempotencyKey]);

  const account = details?.account;
  const balances = details?.balances;
  const documents = details?.documents || [];
  const openInvoices = documents.filter((d) => d.direction === "debit" && parseFloat(d.remainingAmount) > 0);
  const allocations = details?.allocations || [];

  // Live remainder calculation
  const parsedReceipt = parseFloat(receiptAmount) || 0;
  let totalExplicitAllocated = 0;

  if (allocationMode === "explicit") {
    for (const inv of openInvoices) {
      if (selectedInvoices[inv.id]) {
        const amt = parseFloat(explicitAmounts[inv.id] || "0") || 0;
        totalExplicitAllocated += amt;
      }
    }
  } else {
    // Oldest first simulated
    let remReceipt = parsedReceipt;
    for (const inv of openInvoices) {
      const invRem = parseFloat(inv.remainingAmount) || 0;
      const apply = Math.min(remReceipt, invRem);
      totalExplicitAllocated += apply;
      remReceipt -= apply;
    }
  }

  const unallocatedRemainder = Math.max(0, parsedReceipt - totalExplicitAllocated);
  const isOverAllocated = totalExplicitAllocated > parsedReceipt;

  return (
    <div className="trade-container">
      <div className="trade-header">
        <div className="trade-header-title">
          <h1>Payment & Allocation Workbench</h1>
          <p>Record receipts, apply credits against open invoices, and manage reversals</p>
        </div>
        <div className="trade-header-actions">
          <Link to="/app/accounts" className="trade-btn trade-btn-secondary">
            View All Accounts
          </Link>
        </div>
      </div>

      {/* Operating Mode Indicator */}
      {isDemo ? (
        <div
          style={{
            background: "#fff9e6",
            border: "1px solid #ffd591",
            borderRadius: "8px",
            padding: "12px 16px",
            marginBottom: "20px",
            color: "#873800",
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
          }}
          role="status"
        >
          <span style={{ fontSize: "18px", lineHeight: "1" }}>ℹ</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "2px" }}>
              Demo Simulation Mode Active
            </div>
            <div style={{ fontSize: "13px", lineHeight: "1.4" }}>
              This screen is currently operating on in-memory preview data. Financial allocations and receipts recorded here are simulated locally and will <strong>not</strong> be committed to the durable PostgreSQL ledger API until <code>TRADE_API_URL</code> is configured in the environment.
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "#f6ffed",
            border: "1px solid #b7eb8f",
            borderRadius: "8px",
            padding: "10px 16px",
            marginBottom: "20px",
            color: "#135200",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span style={{ fontSize: "14px" }}>🟢</span>
          <span><strong>Durable Mode:</strong> Connected to live Trade Ledger API service. Mutations are durably recorded with cryptographic audit trails.</span>
        </div>
      )}

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

      {/* Debtor Account Selector */}
      <div className="trade-card">
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1", minWidth: "260px" }}>
            <label htmlFor="accountSelect" style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "6px" }}>
              Select Trade Debtor Account:
            </label>
            <select
              id="accountSelect"
              value={selectedAccountId}
              onChange={(e) => {
                window.location.href = `/app/allocations?accountId=${e.target.value}`;
              }}
              className="trade-select"
              style={{ width: "100%", fontSize: "15px" }}
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.accountNumber} — {acc.name} (Balance: {acc.currency} {acc.netBalance})
                </option>
              ))}
            </select>
          </div>

          {account && balances && (
            <div style={{ display: "flex", gap: "20px", background: "var(--p-color-bg-surface-secondary)", padding: "10px 18px", borderRadius: "6px" }}>
              <div>
                <div style={{ fontSize: "11px", color: "var(--p-color-text-secondary)", textTransform: "uppercase" }}>Open Debits</div>
                <div style={{ fontSize: "16px", fontWeight: 700 }}>{account.currency} {formatDisplayCurrency(openInvoices.reduce((sum, invoice) => sum + parseMoney(invoice.remainingAmount), 0n), account.currency)}</div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "var(--p-color-text-secondary)", textTransform: "uppercase" }}>Unapplied Credits</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--p-color-success-text)" }}>{account.currency} {balances.unappliedCredit}</div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "var(--p-color-text-secondary)", textTransform: "uppercase" }}>Net Outstanding</div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#123d32" }}>{account.currency} {balances.netBalance}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {account && (
        <Form method="post">
          <input type="hidden" name="intent" value="allocate" />
          <input type="hidden" name="receiptIdempotencyKey" value={receiptKey} />
          <input type="hidden" name="debtorAccountId" value={account.id} />
          <input type="hidden" name="currency" value={account.currency} />

          {/* Receipt Entry Card */}
          <div className="trade-card" role="region" aria-label="Receipt Details">
            <h2 className="trade-card-title" style={{ marginBottom: "14px" }}>Step 1: Record Receipt / Payment</h2>
            <div className="trade-form-grid">
              <div className="trade-field">
                <label htmlFor="receiptAmount">Payment Amount ({account.currency}) *</label>
                <input
                  id="receiptAmount"
                  name="receiptAmount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={receiptAmount}
                  onChange={(e) => setReceiptAmount(e.target.value)}
                  required
                  className="trade-input"
                  style={{ fontSize: "16px", fontWeight: 600 }}
                />
              </div>

              <div className="trade-field">
                <label htmlFor="paymentMode">Payment Channel Mode *</label>
                <select id="paymentMode" name="paymentMode" defaultValue="external_receipt" className="trade-select">
                  <option value="external_receipt">External Receipt (Bank EFT / Direct Wire)</option>
                  <option value="shopify_manual">Shopify Manual Payment (Admin Registered)</option>
                  <option value="shopify_pos_cash">Shopify POS Cash Collection (Till Drop)</option>
                </select>
                <span className="trade-field-hint">Visible payment channel contract</span>
              </div>

              <div className="trade-field">
                <label htmlFor="reference">Payment Reference / Remittance # *</label>
                <input
                  id="reference"
                  name="reference"
                  type="text"
                  placeholder="e.g. EFT-98124 or Remittance 2026-09"
                  required
                  defaultValue="EFT-40291"
                  className="trade-input"
                />
              </div>
            </div>
          </div>

          {/* Allocation Workbench */}
          <div className="trade-card" role="region" aria-label="Invoice Allocation Workbench">
            <div className="trade-card-header">
              <h2 className="trade-card-title">Step 2: Allocate Credit Against Open Invoices</h2>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setAllocationMode("oldest_first")}
                  className={`trade-btn trade-btn-sm ${allocationMode === "oldest_first" ? "trade-btn-primary" : "trade-btn-secondary"}`}
                >
                  Oldest-First (FIFO)
                </button>
                <button
                  type="button"
                  onClick={() => setAllocationMode("explicit")}
                  className={`trade-btn trade-btn-sm ${allocationMode === "explicit" ? "trade-btn-primary" : "trade-btn-secondary"}`}
                >
                  Manual Selection
                </button>
              </div>
            </div>
            <input type="hidden" name="mode" value={allocationMode} />

            {/* Dynamic Remainder Summary Bar */}
            <div className="trade-remainder-box" role="status" aria-live="polite">
              <div className="trade-remainder-metric">
                <span className="label">Receipt Amount</span>
                <span className="amount">{account.currency} {parsedReceipt.toFixed(2)}</span>
              </div>
              <div className="trade-remainder-metric">
                <span className="label">Total To Allocate</span>
                <span className="amount" style={{ color: isOverAllocated ? "var(--p-color-critical-text)" : "#108043" }}>
                  {account.currency} {totalExplicitAllocated.toFixed(2)}
                </span>
              </div>
              <div className="trade-remainder-metric">
                <span className="label">Unapplied Remainder (Credit)</span>
                <span className="amount" style={{ color: unallocatedRemainder > 0 ? "var(--p-color-info-text)" : "inherit" }}>
                  {account.currency} {unallocatedRemainder.toFixed(2)}
                </span>
              </div>
            </div>

            {isOverAllocated && (
              <div className="trade-banner trade-banner-warning" role="alert">
                ⚠ Over-allocation detected: Total allocated ({totalExplicitAllocated.toFixed(2)}) exceeds receipt amount ({parsedReceipt.toFixed(2)}).
              </div>
            )}

            {/* Open Invoices Table */}
            <div className="trade-table-wrapper">
              <table className="trade-table">
                <thead>
                  <tr>
                    {allocationMode === "explicit" && <th scope="col" style={{ width: "40px" }}>Apply</th>}
                    <th scope="col">Invoice #</th>
                    <th scope="col">Due Date</th>
                    <th scope="col" className="num">Original Amount</th>
                    <th scope="col" className="num">Remaining Open</th>
                    <th scope="col" className="num">Allocating This Session</th>
                    <th scope="col" className="num">Projected Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={allocationMode === "explicit" ? 7 : 6} style={{ textAlign: "center", padding: "24px" }}>
                        No open invoices for this account. Entire payment will remain as an unapplied credit ({account.currency} {parsedReceipt.toFixed(2)}).
                      </td>
                    </tr>
                  ) : (
                    openInvoices.map((inv) => {
                      const invRem = parseFloat(inv.remainingAmount) || 0;
                      let allocatingAmt = 0;

                      if (allocationMode === "explicit") {
                        if (selectedInvoices[inv.id]) {
                          allocatingAmt = parseFloat(explicitAmounts[inv.id] || "0") || 0;
                        }
                      } else {
                        // Simulated FIFO
                        let r = parsedReceipt;
                        for (const prev of openInvoices) {
                          const pRem = parseFloat(prev.remainingAmount) || 0;
                          const app = Math.min(r, pRem);
                          if (prev.id === inv.id) {
                            allocatingAmt = app;
                            break;
                          }
                          r -= app;
                        }
                      }

                      const projectedRemaining = Math.max(0, invRem - allocatingAmt);

                      return (
                        <tr key={inv.id}>
                          {allocationMode === "explicit" && (
                            <td>
                              <input
                                type="checkbox"
                                name="selectedInvoiceId"
                                value={inv.id}
                                checked={!!selectedInvoices[inv.id]}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSelectedInvoices((prev) => ({ ...prev, [inv.id]: checked }));
                                  if (checked && !explicitAmounts[inv.id]) {
                                    setExplicitAmounts((prev) => ({ ...prev, [inv.id]: inv.remainingAmount }));
                                  }
                                }}
                                aria-label={`Select invoice ${inv.documentNumber}`}
                              />
                            </td>
                          )}
                          <td style={{ fontWeight: 600 }}>{inv.documentNumber}</td>
                          <td>{inv.dueOn}</td>
                          <td className="num">{account.currency} {inv.amount}</td>
                          <td className="num" style={{ fontWeight: 600 }}>{account.currency} {inv.remainingAmount}</td>
                          <td className="num">
                            {allocationMode === "explicit" ? (
                              <input
                                type="number"
                                name={`alloc_amt_${inv.id}`}
                                step="0.01"
                                min="0"
                                max={inv.remainingAmount}
                                value={explicitAmounts[inv.id] ?? inv.remainingAmount}
                                disabled={!selectedInvoices[inv.id]}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setExplicitAmounts((prev) => ({ ...prev, [inv.id]: val }));
                                }}
                                className="trade-input"
                                style={{ width: "120px", textAlign: "right" }}
                                aria-label={`Amount to allocate for invoice ${inv.documentNumber}`}
                              />
                            ) : (
                              <span style={{ fontWeight: 600, color: allocatingAmt > 0 ? "var(--p-color-success-text)" : "inherit" }}>
                                {account.currency} {allocatingAmt.toFixed(2)}
                              </span>
                            )}
                          </td>
                          <td className="num" style={{ fontWeight: 700, color: projectedRemaining === 0 ? "var(--p-color-success-text)" : "inherit" }}>
                            {account.currency} {projectedRemaining.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                disabled={isSubmitting || isOverAllocated}
                className="trade-btn trade-btn-primary"
                style={{ padding: "10px 24px", fontSize: "15px" }}
              >
                {isSubmitting ? "Posting Allocation..." : "Confirm & Post Allocation"}
              </button>
            </div>
          </div>
        </Form>
      )}

      {/* Allocation History & Reversal Section */}
      {account && allocations.length > 0 && (
        <div className="trade-card" role="region" aria-label="Recent Allocations and Reversals">
          <div className="trade-card-header">
            <h2 className="trade-card-title">Recent Allocations & Audit Reversals</h2>
            <span style={{ fontSize: "12px", color: "var(--p-color-text-secondary)" }}>
              Append-only immutable journal
            </span>
          </div>

          <div className="trade-table-wrapper">
            <table className="trade-table">
              <thead>
                <tr>
                  <th scope="col">Allocation ID</th>
                  <th scope="col">Credit Receipt</th>
                  <th scope="col">Debit Invoice</th>
                  <th scope="col">Allocated Date</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((alloc) => (
                  <tr key={alloc.id}>
                    <td><code>{alloc.id}</code></td>
                    <td>{alloc.creditDocumentNumber}</td>
                    <td>{alloc.debitDocumentNumber}</td>
                    <td>{new Date(alloc.allocatedAt).toLocaleDateString()}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{account.currency} {alloc.amount}</td>
                    <td>
                      {alloc.reversed ? (
                        <span className="trade-badge trade-badge-closed">Reversed</span>
                      ) : (
                        <span className="trade-badge trade-badge-active">Active</span>
                      )}
                    </td>
                    <td>
                      {!alloc.reversed && (
                        <Form method="post" style={{ display: "inline" }}>
                          <input type="hidden" name="intent" value="reverse" />
                          <input type="hidden" name="debtorAccountId" value={account.id} />
                          <input type="hidden" name="allocationId" value={alloc.id} />
                          <input type="hidden" name="reason" value="User reversed allocation via workbench" />
                          <button
                            type="submit"
                            disabled={isSubmitting}
                            className="trade-btn trade-btn-danger trade-btn-sm"
                            aria-label={`Reverse allocation ${alloc.id}`}
                          >
                            Reverse
                          </button>
                        </Form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
