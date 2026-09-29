import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createDebtorAccount } from "../trade-accounts.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { defaultCurrency: "ZAR" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();

  const accountNumber = formData.get("accountNumber")?.toString() || "";
  const name = formData.get("name")?.toString() || "";
  const shopifyCustomerId = formData.get("shopifyCustomerId")?.toString() || "";
  const shopifyCompanyId = formData.get("shopifyCompanyId")?.toString() || null;
  const currency = formData.get("currency")?.toString() || "ZAR";
  const creditLimit = formData.get("creditLimit")?.toString() || "10000.00";
  const termsType = (formData.get("termsType")?.toString() || "net_monthly") as "net_monthly" | "eom" | "cod";
  const termsDays = Number(formData.get("termsDays") || 30);
  const agingBasis = (formData.get("agingBasis")?.toString() || "due_date") as "due_date" | "calendar_period";
  const contactEmail = formData.get("contactEmail")?.toString() || "";
  const contactPhone = formData.get("contactPhone")?.toString() || "";

  if (!accountNumber.trim()) {
    return { error: "Account number is required" };
  }
  if (!name.trim()) {
    return { error: "Customer / business name is required" };
  }
  if (!shopifyCustomerId.trim()) {
    return { error: "Shopify Customer GID is required to link trade account" };
  }

  try {
    const created = await createDebtorAccount(
      {
        accountNumber,
        name,
        shopifyCustomerId,
        shopifyCompanyId,
        currency,
        creditLimit,
        termsType,
        termsDays,
        agingBasis,
        contactEmail,
        contactPhone,
      },
      request
    );

    return redirect(`/app/accounts/${created.id}`);
  } catch (err: any) {
    return { error: err.message || "Failed to create trade account" };
  }
};

export default function NewDebtorAccount() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="trade-container">
      {/* Breadcrumb */}
      <div style={{ marginBottom: "12px" }}>
        <Link to="/app/accounts" style={{ color: "var(--p-color-interactive)", textDecoration: "none", fontSize: "14px" }}>
          ← Back to Trade Accounts
        </Link>
      </div>

      <div className="trade-header">
        <div className="trade-header-title">
          <h1>New Trade Account</h1>
          <p>Register a B2B trade customer and map to Shopify identity</p>
        </div>
      </div>

      {actionData?.error && (
        <div className="trade-banner trade-banner-warning" role="alert">
          ⚠ {actionData.error}
        </div>
      )}

      <div className="trade-card" style={{ maxWidth: "800px" }}>
        <Form method="post">
          <div className="trade-form-grid">
            <div className="trade-field">
              <label htmlFor="accountNumber">Account Number *</label>
              <input
                id="accountNumber"
                name="accountNumber"
                type="text"
                placeholder="e.g. ACC-005"
                required
                className="trade-input"
              />
              <span className="trade-field-hint">Unique ledger identifier</span>
            </div>

            <div className="trade-field">
              <label htmlFor="name">Business / Customer Name *</label>
              <input
                id="name"
                name="name"
                type="text"
                placeholder="e.g. Cape Town Marine Works"
                required
                className="trade-input"
              />
            </div>

            <div className="trade-field">
              <label htmlFor="shopifyCustomerId">Shopify Customer GID *</label>
              <input
                id="shopifyCustomerId"
                name="shopifyCustomerId"
                type="text"
                placeholder="gid://shopify/Customer/..."
                defaultValue="gid://shopify/Customer/8192837499"
                required
                className="trade-input"
              />
              <span className="trade-field-hint">Links orders and POS lookup to this account</span>
            </div>

            <div className="trade-field">
              <label htmlFor="shopifyCompanyId">Shopify Company GID (Optional B2B)</label>
              <input
                id="shopifyCompanyId"
                name="shopifyCompanyId"
                type="text"
                placeholder="gid://shopify/Company/..."
                className="trade-input"
              />
              <span className="trade-field-hint">For Shopify Plus B2B company accounts</span>
            </div>

            <div className="trade-field">
              <label htmlFor="currency">Operating Currency</label>
              <select id="currency" name="currency" defaultValue="ZAR" className="trade-select">
                <option value="ZAR">ZAR — South African Rand</option>
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="GBP">GBP — British Pound</option>
                <option value="CAD">CAD — Canadian Dollar</option>
                <option value="AUD">AUD — Australian Dollar</option>
              </select>
            </div>

            <div className="trade-field">
              <label htmlFor="creditLimit">Initial Credit Limit</label>
              <input
                id="creditLimit"
                name="creditLimit"
                type="number"
                step="0.01"
                min="0"
                defaultValue="15000.00"
                required
                className="trade-input"
              />
            </div>

            <div className="trade-field">
              <label htmlFor="termsType">Payment Terms</label>
              <select id="termsType" name="termsType" defaultValue="net_monthly" className="trade-select">
                <option value="net_monthly">Net Days (e.g. Net 30)</option>
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
                defaultValue="30"
                className="trade-input"
              />
            </div>

            <div className="trade-field">
              <label htmlFor="agingBasis">Aging Basis</label>
              <select id="agingBasis" name="agingBasis" defaultValue="due_date" className="trade-select">
                <option value="due_date">Due Date Aging (Recommended)</option>
                <option value="calendar_period">Accounting Calendar Period</option>
              </select>
            </div>

            <div className="trade-field">
              <label htmlFor="contactEmail">Accounts Contact Email</label>
              <input
                id="contactEmail"
                name="contactEmail"
                type="email"
                placeholder="accounts@customer.com"
                className="trade-input"
              />
            </div>

            <div className="trade-field">
              <label htmlFor="contactPhone">Contact Phone Number</label>
              <input
                id="contactPhone"
                name="contactPhone"
                type="tel"
                placeholder="+27 21 555 0100"
                className="trade-input"
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
            <button
              type="submit"
              disabled={isSubmitting}
              className="trade-btn trade-btn-primary"
            >
              {isSubmitting ? "Creating Account..." : "Create Trade Account"}
            </button>
            <Link to="/app/accounts" className="trade-btn trade-btn-secondary">
              Cancel
            </Link>
          </div>
        </Form>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
