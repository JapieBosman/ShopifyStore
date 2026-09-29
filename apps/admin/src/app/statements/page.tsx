import Link from "next/link";

interface StatementDemoData {
  id: string;
  accountNumber: string;
  customerName: string;
  openingBalance: string;
  debits: string;
  credits: string;
  closingBalance: string;
  currency: string;
  status: "ready" | "queued" | "failed";
  pdfSha256: string;
  lastDeliveredAt: string | null;
  deliveryStatus: "delivered" | "bounced" | "uncertain" | "not_sent";
}

const mockStatements: StatementDemoData[] = [
  {
    id: "stmt-001",
    accountNumber: "ACC-001",
    customerName: "Ubuntu Hardware Trade",
    openingBalance: "3,500.00",
    debits: "4,500.00",
    credits: "0.00",
    closingBalance: "8,000.00",
    currency: "ZAR",
    status: "ready",
    pdfSha256: "b9c3f098...d71e24a1",
    lastDeliveredAt: "2026-09-01 08:30 UTC",
    deliveryStatus: "delivered",
  },
  {
    id: "stmt-002",
    accountNumber: "ACC-002",
    customerName: "Boland Construction Supplies",
    openingBalance: "0.00",
    debits: "12,500.00",
    credits: "0.00",
    closingBalance: "12,500.00",
    currency: "ZAR",
    status: "ready",
    pdfSha256: "7e51c890...4a89bc32",
    lastDeliveredAt: null,
    deliveryStatus: "not_sent",
  },
  {
    id: "stmt-003",
    accountNumber: "ACC-003",
    customerName: "Cape Timber & Truss",
    openingBalance: "15,200.00",
    debits: "2,100.00",
    credits: "15,200.00",
    closingBalance: "2,100.00",
    currency: "ZAR",
    status: "ready",
    pdfSha256: "3f82aa10...09cd11ea",
    lastDeliveredAt: "2026-09-01 08:35 UTC",
    deliveryStatus: "bounced",
  },
];

export default function StatementsPage() {
  return (
    <div className="statements-view">
      <div className="page-header" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow" style={{ color: "#6d7175", textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.05em", margin: 0 }}>
          Trade Accounts • Phase 4 Prototype
        </p>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: "0.25rem 0" }}>
          Statement Delivery &amp; Storage
        </h1>
        <p className="lead" style={{ color: "#4b5563", margin: 0 }}>
          Deterministic ISO 32000-1 PDF statement generation with per-tenant signed URL delivery and bounce tracking.
        </p>
      </div>

      {/* Overview Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
        <div style={{ background: "#ffffff", padding: "1.25rem", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
          <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>Active Run</span>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, marginTop: "0.25rem" }}>2026-08 Monthly Run</div>
          <span style={{ fontSize: "0.75rem", color: "#10b981", fontWeight: 500 }}>Cutoff: 2026-08-31 23:59:59</span>
        </div>
        <div style={{ background: "#ffffff", padding: "1.25rem", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
          <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>Generated Statements</span>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, marginTop: "0.25rem" }}>3 Ready</div>
          <span style={{ fontSize: "0.75rem", color: "#3b82f6", fontWeight: 500 }}>All PDF hashes verified</span>
        </div>
        <div style={{ background: "#ffffff", padding: "1.25rem", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
          <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>Delivery Status</span>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, marginTop: "0.25rem" }}>1 Delivered, 1 Bounced</div>
          <span style={{ fontSize: "0.75rem", color: "#ef4444", fontWeight: 500 }}>1 Pending dispatch</span>
        </div>
      </div>

      {/* Statements Table */}
      <div style={{ background: "#ffffff", borderRadius: "8px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
          <thead style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
            <tr>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Account</th>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Debtor</th>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Closing Balance</th>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Delivery Status</th>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Artifact</th>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {mockStatements.map((stmt) => (
              <tr key={stmt.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "0.75rem 1rem", fontWeight: 500 }}>{stmt.accountNumber}</td>
                <td style={{ padding: "0.75rem 1rem" }}>{stmt.customerName}</td>
                <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>
                  {stmt.currency} {stmt.closingBalance}
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.25rem 0.5rem",
                      borderRadius: "9999px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      backgroundColor:
                        stmt.deliveryStatus === "delivered"
                          ? "#d1fae5"
                          : stmt.deliveryStatus === "bounced"
                            ? "#fee2e2"
                            : stmt.deliveryStatus === "uncertain"
                              ? "#fef3c7"
                              : "#e5e7eb",
                      color:
                        stmt.deliveryStatus === "delivered"
                          ? "#065f46"
                          : stmt.deliveryStatus === "bounced"
                            ? "#991b1b"
                            : stmt.deliveryStatus === "uncertain"
                              ? "#92400e"
                              : "#374151",
                    }}
                  >
                    {stmt.deliveryStatus.replace("_", " ").toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#6b7280" }}>
                  {stmt.pdfSha256}
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <button
                    type="button"
                    style={{
                      padding: "0.35rem 0.75rem",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      borderRadius: "6px",
                      border: "1px solid #d1d5db",
                      background: "#ffffff",
                      cursor: "pointer",
                    }}
                  >
                    Send Email
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <Link href="/" className="back" style={{ color: "#2563eb", textDecoration: "none", fontSize: "0.875rem" }}>
          ← Return to overview
        </Link>
      </div>
    </div>
  );
}
