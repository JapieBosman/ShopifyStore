import Link from "next/link";

interface DebtorRow {
  id: string;
  accountNumber: string;
  name: string;
  shopifyCustomer: string;
  currency: string;
  creditLimit: string;
  netBalance: string;
  availableCredit: string;
  status: "active" | "hold" | "closed";
}

const mockDebtors: DebtorRow[] = [
  {
    id: "acc-001",
    accountNumber: "ACC-001",
    name: "Ubuntu Hardware Trade",
    shopifyCustomer: "Cust #8192837461",
    currency: "ZAR",
    creditLimit: "25000.00",
    netBalance: "6300.00",
    availableCredit: "17500.00",
    status: "active",
  },
  {
    id: "acc-002",
    accountNumber: "ACC-002",
    name: "Cape Agri Supplies",
    shopifyCustomer: "Cust #8192837462",
    currency: "ZAR",
    creditLimit: "50000.00",
    netBalance: "18400.00",
    availableCredit: "31600.00",
    status: "active",
  },
  {
    id: "acc-003",
    accountNumber: "ACC-003",
    name: "Highveld Industrial Tools",
    shopifyCustomer: "Cust #8192837463",
    currency: "ZAR",
    creditLimit: "10000.00",
    netBalance: "9800.00",
    availableCredit: "200.00",
    status: "hold",
  },
  {
    id: "acc-004",
    accountNumber: "ACC-004",
    name: "Durban Marine Logistics",
    shopifyCustomer: "Cust #8192837464",
    currency: "ZAR",
    creditLimit: "30000.00",
    netBalance: "4200.00",
    availableCredit: "25800.00",
    status: "active",
  },
];

export default function AccountsPage() {
  return (
    <>
      <p className="eyebrow">Debtors & Accounts</p>
      <h1>Trade Accounts Directory</h1>
      <p className="lead">
        Browse customer trade credit accounts, review real-time ledger balances, and inspect aging profiles.
      </p>

      {/* Metrics Row */}
      <div className="metrics-row" role="region" aria-label="Trade accounts summary">
        <div className="metric-box">
          <div className="label">Total Accounts</div>
          <div className="val">4</div>
        </div>
        <div className="metric-box">
          <div className="label">Total AR Debt</div>
          <div className="val">R 38,700.00</div>
        </div>
        <div className="metric-box">
          <div className="label">Available Credit</div>
          <div className="val">R 75,100.00</div>
        </div>
        <div className="metric-box">
          <div className="label">Accounts on Hold</div>
          <div className="val" style={{ color: "#9c4100" }}>1</div>
        </div>
      </div>

      {/* Directory Table */}
      <div className="table-wrapper" role="region" aria-label="Accounts table">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Account #</th>
              <th scope="col">Customer Name</th>
              <th scope="col">Shopify Customer</th>
              <th scope="col" className="num">Credit Limit</th>
              <th scope="col" className="num">Net AR Balance</th>
              <th scope="col" className="num">Available Credit</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {mockDebtors.map((debtor) => (
              <tr key={debtor.id}>
                <td style={{ fontWeight: 700 }}>
                  <Link href={`/accounts/${debtor.id}`} style={{ color: "#123d32" }}>
                    {debtor.accountNumber}
                  </Link>
                </td>
                <td>{debtor.name}</td>
                <td>
                  <code style={{ fontSize: "12px", background: "#edf2ee", padding: "2px 6px", borderRadius: "4px" }}>
                    {debtor.shopifyCustomer}
                  </code>
                </td>
                <td className="num">{debtor.currency} {debtor.creditLimit}</td>
                <td className="num" style={{ fontWeight: 600 }}>{debtor.currency} {debtor.netBalance}</td>
                <td className="num" style={{ fontWeight: 600, color: "#175b42" }}>{debtor.currency} {debtor.availableCredit}</td>
                <td>
                  <span className={`badge badge-${debtor.status}`}>{debtor.status}</span>
                </td>
                <td>
                  <Link href={`/accounts/${debtor.id}`} className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: "12px" }}>
                    Details
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Link className="back" href="/">← Return to overview</Link>
    </>
  );
}
