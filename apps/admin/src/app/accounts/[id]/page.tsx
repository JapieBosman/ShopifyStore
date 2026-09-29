import Link from "next/link";
import { notFound } from "next/navigation";

const mockDetails: Record<string, any> = {
  "acc-001": {
    id: "acc-001",
    accountNumber: "ACC-001",
    name: "Ubuntu Hardware Trade",
    currency: "ZAR",
    creditLimit: "25000.00",
    netBalance: "6300.00",
    activeReservations: "1200.00",
    availableCredit: "17500.00",
    status: "active",
    terms: "Net 30 Days",
    policyVersion: 1,
    ledgerVersion: 3,
    aging: {
      current: "2800.00",
      d030: "1500.00",
      d060: "2000.00",
      d090: "0.00",
      d120: "0.00",
      d150: "0.00",
      d180: "0.00",
      over: "0.00",
    },
    invoices: [
      { docNumber: "INV-2026-001", dueOn: "2026-08-14", amount: "3200.00", allocated: "1200.00", remaining: "2000.00" },
      { docNumber: "INV-2026-002", dueOn: "2026-09-19", amount: "1500.00", allocated: "0.00", remaining: "1500.00" },
      { docNumber: "INV-2026-003", dueOn: "2026-10-25", amount: "2800.00", allocated: "0.00", remaining: "2800.00" },
    ],
  },
  "acc-002": {
    id: "acc-002",
    accountNumber: "ACC-002",
    name: "Cape Agri Supplies",
    currency: "ZAR",
    creditLimit: "50000.00",
    netBalance: "18400.00",
    activeReservations: "0.00",
    availableCredit: "31600.00",
    status: "active",
    terms: "Net 60 Days",
    policyVersion: 1,
    ledgerVersion: 2,
    aging: {
      current: "5900.00",
      d030: "12500.00",
      d060: "0.00",
      d090: "0.00",
      d120: "0.00",
      d150: "0.00",
      d180: "0.00",
      over: "0.00",
    },
    invoices: [
      { docNumber: "INV-2026-010", dueOn: "2026-09-30", amount: "12500.00", allocated: "0.00", remaining: "12500.00" },
      { docNumber: "INV-2026-011", dueOn: "2026-11-11", amount: "5900.00", allocated: "0.00", remaining: "5900.00" },
    ],
  },
};

export function generateStaticParams() {
  return [{ id: "acc-001" }, { id: "acc-002" }];
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const debtor = mockDetails[id];
  if (!debtor) {
    notFound();
  }

  return (
    <>
      <p className="eyebrow">Account Details</p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1>{debtor.name}</h1>
          <p className="lead" style={{ margin: 0 }}>
            Account #{debtor.accountNumber} · Policy v{debtor.policyVersion} · Ledger v{debtor.ledgerVersion}
          </p>
        </div>
        <span className={`badge badge-${debtor.status}`} style={{ marginTop: "12px", fontSize: "14px", padding: "6px 12px" }}>
          {debtor.status}
        </span>
      </div>

      {/* Metrics Row */}
      <div className="metrics-row" role="region" aria-label="Balances and exposure">
        <div className="metric-box">
          <div className="label">Credit Limit</div>
          <div className="val">{debtor.currency} {debtor.creditLimit}</div>
        </div>
        <div className="metric-box">
          <div className="label">Net AR Balance</div>
          <div className="val">{debtor.currency} {debtor.netBalance}</div>
        </div>
        <div className="metric-box">
          <div className="label">Active Reservations</div>
          <div className="val">{debtor.currency} {debtor.activeReservations}</div>
        </div>
        <div className="metric-box">
          <div className="label">Available Credit</div>
          <div className="val" style={{ color: "#175b42" }}>{debtor.currency} {debtor.availableCredit}</div>
        </div>
      </div>

      {/* 8-Bucket Aging Snapshot */}
      <div style={{ margin: "28px 0" }}>
        <h2 style={{ fontSize: "18px" }}>8-Bucket Due-Date Aging Breakdown</h2>
        <div className="aging-strip" role="region" aria-label="8-bucket aging profile">
          <div className="aging-item"><div className="l">Current</div><div className="v">{debtor.aging.current}</div></div>
          <div className="aging-item"><div className="l">1–30d</div><div className="v">{debtor.aging.d030}</div></div>
          <div className="aging-item"><div className="l">31–60d</div><div className="v">{debtor.aging.d060}</div></div>
          <div className="aging-item"><div className="l">61–90d</div><div className="v">{debtor.aging.d090}</div></div>
          <div className="aging-item"><div className="l">91–120d</div><div className="v">{debtor.aging.d120}</div></div>
          <div className="aging-item"><div className="l">121–150d</div><div className="v">{debtor.aging.d150}</div></div>
          <div className="aging-item"><div className="l">151–180d</div><div className="v">{debtor.aging.d180}</div></div>
          <div className="aging-item"><div className="l">180d+</div><div className="v">{debtor.aging.over}</div></div>
        </div>
      </div>

      {/* Open Invoices Table */}
      <div style={{ margin: "28px 0" }}>
        <h2 style={{ fontSize: "18px" }}>Open Subledger Invoices</h2>
        <div className="table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Invoice #</th>
                <th scope="col">Due Date</th>
                <th scope="col" className="num">Total Amount</th>
                <th scope="col" className="num">Allocated</th>
                <th scope="col" className="num">Remaining Balance</th>
              </tr>
            </thead>
            <tbody>
              {debtor.invoices.map((inv: any) => (
                <tr key={inv.docNumber}>
                  <td style={{ fontWeight: 600 }}>{inv.docNumber}</td>
                  <td>{inv.dueOn}</td>
                  <td className="num">{debtor.currency} {inv.amount}</td>
                  <td className="num">{debtor.currency} {inv.allocated}</td>
                  <td className="num" style={{ fontWeight: 700, color: "#123d32" }}>{debtor.currency} {inv.remaining}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
        <Link className="back" href="/accounts">← Back to accounts</Link>
        <Link href="/allocations" className="btn btn-primary" style={{ marginLeft: "auto" }}>
          Go to Allocation Workbench →
        </Link>
      </div>
    </>
  );
}
