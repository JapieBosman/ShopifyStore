"use client";

import { useState } from "react";
import Link from "next/link";

interface OpenInvoice {
  id: string;
  docNumber: string;
  dueOn: string;
  amount: number;
  remaining: number;
}

const initialInvoices: OpenInvoice[] = [
  { id: "inv-1", docNumber: "INV-2026-001", dueOn: "2026-08-14", amount: 3200.0, remaining: 2000.0 },
  { id: "inv-2", docNumber: "INV-2026-002", dueOn: "2026-09-19", amount: 1500.0, remaining: 1500.0 },
  { id: "inv-3", docNumber: "INV-2026-003", dueOn: "2026-10-25", amount: 2800.0, remaining: 2800.0 },
];

export default function AllocationsPage() {
  const [receiptAmount, setReceiptAmount] = useState<number>(2500);
  const [paymentMode, setPaymentMode] = useState<string>("external_receipt");
  const [reference, setReference] = useState<string>("EFT-40291");
  const [mode, setMode] = useState<"fifo" | "manual">("fifo");
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  // Compute live allocations
  let totalAllocated = 0;
  if (mode === "fifo") {
    let remReceipt = receiptAmount;
    for (const inv of initialInvoices) {
      const apply = Math.min(remReceipt, inv.remaining);
      totalAllocated += apply;
      remReceipt -= apply;
    }
  } else {
    for (const inv of initialInvoices) {
      totalAllocated += allocations[inv.id] || 0;
    }
  }

  const remainder = Math.max(0, receiptAmount - totalAllocated);
  const isOverAllocated = totalAllocated > receiptAmount;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isOverAllocated) return;
    setFeedback(`Successfully posted receipt ${reference} for R ${receiptAmount.toFixed(2)}. Allocated R ${totalAllocated.toFixed(2)}; unapplied remainder: R ${remainder.toFixed(2)}.`);
  };

  return (
    <>
      <p className="eyebrow">Payment Workbench</p>
      <h1>Receipt & Allocation Workbench</h1>
      <p className="lead">
        Record incoming payments across supported channels, allocate funds to open invoices, and track unapplied credit remainders.
      </p>

      {feedback && (
        <div style={{ background: "#eaf4e9", border: "1px solid #b7e4c7", padding: "14px", borderRadius: "8px", margin: "16px 0", color: "#175b42" }}>
          ✓ {feedback}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Step 1: Payment Details */}
        <div style={{ background: "white", padding: "20px", borderRadius: "10px", border: "1px solid #dce6de", margin: "20px 0" }}>
          <h2 style={{ fontSize: "18px", marginTop: 0 }}>Step 1: Receipt Details</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
            <div className="form-field">
              <label htmlFor="receiptAmount">Payment Amount (ZAR) *</label>
              <input
                id="receiptAmount"
                type="number"
                step="0.01"
                min="0.01"
                value={receiptAmount}
                onChange={(e) => setReceiptAmount(parseFloat(e.target.value) || 0)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="paymentMode">Payment Channel Mode *</label>
              <select
                id="paymentMode"
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
              >
                <option value="external_receipt">External Receipt (Bank EFT / Wire)</option>
                <option value="shopify_manual">Shopify Manual Payment (Admin)</option>
                <option value="shopify_pos_cash">Shopify POS Cash Collection (Till Drop)</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="reference">Reference / Remittance *</label>
              <input
                id="reference"
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                required
              />
            </div>
          </div>
        </div>

        {/* Step 2: Allocation Table */}
        <div style={{ background: "white", padding: "20px", borderRadius: "10px", border: "1px solid #dce6de", margin: "20px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
            <h2 style={{ fontSize: "18px", margin: 0 }}>Step 2: Allocate Against Open Invoices</h2>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className={`btn ${mode === "fifo" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setMode("fifo")}
              >
                Oldest-First (FIFO)
              </button>
              <button
                type="button"
                className={`btn ${mode === "manual" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setMode("manual")}
              >
                Manual Selection
              </button>
            </div>
          </div>

          {/* Live Remainder Display */}
          <div className="remainder-bar" role="status" aria-live="polite">
            <div>
              <div style={{ fontSize: "11px", color: "#465a4f", textTransform: "uppercase", fontWeight: 700 }}>Receipt Amount</div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#123d32" }}>R {receiptAmount.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "#465a4f", textTransform: "uppercase", fontWeight: 700 }}>Total Allocated</div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: isOverAllocated ? "#9b1c1c" : "#175b42" }}>
                R {totalAllocated.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "#465a4f", textTransform: "uppercase", fontWeight: 700 }}>Unapplied Remainder</div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: remainder > 0 ? "#025982" : "#123d32" }}>
                R {remainder.toFixed(2)}
              </div>
            </div>
          </div>

          {isOverAllocated && (
            <div style={{ background: "#fde8e8", border: "1px solid #f8b4b4", padding: "10px", borderRadius: "6px", color: "#9b1c1c", marginBottom: "14px" }}>
              ⚠ Over-allocation error: Total allocated amounts exceed the receipt total of R {receiptAmount.toFixed(2)}.
            </div>
          )}

          <div className="table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Invoice #</th>
                  <th scope="col">Due Date</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col" className="num">Remaining Open</th>
                  <th scope="col" className="num">Allocating This Session</th>
                  <th scope="col" className="num">Projected Remaining</th>
                </tr>
              </thead>
              <tbody>
                {initialInvoices.map((inv) => {
                  let allocatingThis = 0;
                  if (mode === "fifo") {
                    let r = receiptAmount;
                    for (const prev of initialInvoices) {
                      const app = Math.min(r, prev.remaining);
                      if (prev.id === inv.id) {
                        allocatingThis = app;
                        break;
                      }
                      r -= app;
                    }
                  } else {
                    allocatingThis = allocations[inv.id] || 0;
                  }

                  const projRem = Math.max(0, inv.remaining - allocatingThis);

                  return (
                    <tr key={inv.id}>
                      <td style={{ fontWeight: 600 }}>{inv.docNumber}</td>
                      <td>{inv.dueOn}</td>
                      <td className="num">R {inv.amount.toFixed(2)}</td>
                      <td className="num" style={{ fontWeight: 600 }}>R {inv.remaining.toFixed(2)}</td>
                      <td className="num">
                        {mode === "manual" ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max={inv.remaining}
                            value={allocations[inv.id] ?? 0}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value) || 0;
                              setAllocations((prev) => ({ ...prev, [inv.id]: v }));
                            }}
                            style={{ width: "110px", textAlign: "right", padding: "4px 8px" }}
                          />
                        ) : (
                          <span style={{ fontWeight: 600, color: allocatingThis > 0 ? "#175b42" : "inherit" }}>
                            R {allocatingThis.toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="num" style={{ fontWeight: 700, color: projRem === 0 ? "#175b42" : "inherit" }}>
                        R {projRem.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
            <button
              type="submit"
              disabled={isOverAllocated}
              className="btn btn-primary"
              style={{ padding: "10px 24px" }}
            >
              Confirm & Post Allocation
            </button>
          </div>
        </div>
      </form>

      <Link className="back" href="/">← Return to overview</Link>
    </>
  );
}
