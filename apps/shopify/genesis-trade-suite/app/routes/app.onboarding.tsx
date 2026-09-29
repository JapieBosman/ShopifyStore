import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOnboardingState, updateOnboardingState } from "../trade-accounts.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const onboarding = await getOnboardingState();

  return {
    onboarding: {
      ...onboarding,
      shopDomain: session.shop || onboarding.shopDomain,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_step") {
    const step = Number(formData.get("step") || 1);
    const operatingCurrency = formData.get("operatingCurrency")?.toString();
    const agingBasis = formData.get("agingBasis")?.toString() as "due_date" | "calendar_period";
    const defaultCreditLimit = formData.get("defaultCreditLimit")?.toString();
    const defaultTermsType = formData.get("defaultTermsType")?.toString() as "net_monthly" | "eom" | "cod";
    const defaultTermsDays = Number(formData.get("defaultTermsDays") || 30);

    await updateOnboardingState({
      operatingCurrency,
      agingBasis,
      defaultCreditLimit,
      defaultTermsType,
      defaultTermsDays,
      step: Math.min(step + 1, 4),
    });

    return { success: true, nextStep: step + 1 };
  }

  if (intent === "complete") {
    await updateOnboardingState({
      isCompleted: true,
      step: 4,
    });
    return redirect("/app/accounts");
  }

  return null;
};

export default function OnboardingWizard() {
  const { onboarding } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [currentStep, setCurrentStep] = useState<number>(1);

  return (
    <div className="trade-container" style={{ maxWidth: "880px" }}>
      <div className="trade-header">
        <div className="trade-header-title">
          <h1>Setup & Onboarding</h1>
          <p>Configure regional trade credit preferences and verify Shopify connectivity</p>
        </div>
      </div>

      {/* Invariant Acceptance Notice */}
      <div className="trade-banner trade-banner-info" role="note">
        <div>
          <strong>Shopify-Native SaaS Architecture:</strong> This suite operates 100% within your Shopify admin and point of sale.
          {" "}<strong>No Genesis Windows server, no SQL Server credentials, and no external legacy infrastructure are required.</strong>
        </div>
      </div>

      {/* Step Indicator */}
      <div
        role="tablist"
        aria-label="Onboarding Steps"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "10px",
          marginBottom: "24px",
          textAlign: "center",
        }}
      >
        {[
          { num: 1, title: "1. Store Connection" },
          { num: 2, title: "2. Currency & Aging" },
          { num: 3, title: "3. Default Policies" },
          { num: 4, title: "4. Verification & Launch" },
        ].map((s) => (
          <button
            key={s.num}
            type="button"
            role="tab"
            aria-selected={currentStep === s.num}
            onClick={() => setCurrentStep(s.num)}
            className={`trade-card ${currentStep === s.num ? "active-step" : ""}`}
            style={{
              padding: "12px",
              margin: 0,
              cursor: "pointer",
              border: currentStep === s.num ? "2px solid var(--p-color-interactive)" : "1px solid var(--p-color-border)",
              background: currentStep === s.num ? "var(--p-color-success-bg)" : "var(--p-color-bg-surface)",
              fontWeight: currentStep === s.num ? 700 : 500,
            }}
          >
            <div style={{ fontSize: "13px" }}>{s.title}</div>
          </button>
        ))}
      </div>

      {/* Step 1: Shopify Installation Status */}
      {currentStep === 1 && (
        <div className="trade-card" role="region" aria-label="Step 1: Shopify Installation Verification">
          <h2 className="trade-card-title" style={{ marginBottom: "16px" }}>Shopify Installation Verification</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px", background: "var(--p-color-bg-surface-secondary)", borderRadius: "6px" }}>
              <span>Connected Shopify Store:</span>
              <strong>{onboarding.shopDomain}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px", background: "var(--p-color-bg-surface-secondary)", borderRadius: "6px" }}>
              <span>App Bridge Authentication:</span>
              <span className="trade-badge trade-badge-active">Verified & Active</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px", background: "var(--p-color-bg-surface-secondary)", borderRadius: "6px" }}>
              <span>External Genesis Runtime / Database:</span>
              <span className="trade-badge trade-badge-info">Not Required (Shopify Native)</span>
            </div>
          </div>

          <div style={{ marginTop: "24px", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              className="trade-btn trade-btn-primary"
            >
              Continue to Currency & Terms →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Currency & Aging Basis */}
      {currentStep === 2 && (
        <div className="trade-card" role="region" aria-label="Step 2: Currency and Aging Preferences">
          <h2 className="trade-card-title" style={{ marginBottom: "16px" }}>Operating Currency & Regional Aging</h2>
          <Form method="post" onSubmit={() => setCurrentStep(3)}>
            <input type="hidden" name="intent" value="save_step" />
            <input type="hidden" name="step" value="2" />

            <div className="trade-field">
              <label htmlFor="operatingCurrency">Operating Ledger Currency</label>
              <select id="operatingCurrency" name="operatingCurrency" defaultValue={onboarding.operatingCurrency} className="trade-select">
                <option value="ZAR">ZAR — South African Rand (R)</option>
                <option value="USD">USD — US Dollar ($)</option>
                <option value="EUR">EUR — Euro (€)</option>
                <option value="GBP">GBP — British Pound (£)</option>
                <option value="CAD">CAD — Canadian Dollar (C$)</option>
                <option value="AUD">AUD — Australian Dollar (A$)</option>
              </select>
              <span className="trade-field-hint">Matches your Shopify store primary settlement currency</span>
            </div>

            <div className="trade-field">
              <label htmlFor="agingBasis">Default Aging Basis Profile</label>
              <select id="agingBasis" name="agingBasis" defaultValue={onboarding.agingBasis} className="trade-select">
                <option value="due_date">Due Date Aging (8 Standard Buckets: Current, 30, 60, 90, 120, 150, 180, 180+)</option>
                <option value="calendar_period">Accounting Calendar Period (Accounting month boundaries)</option>
              </select>
              <span className="trade-field-hint">Due date aging is recommended for retail counter credit</span>
            </div>

            <div style={{ marginTop: "24px", display: "flex", justifyContent: "space-between" }}>
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="trade-btn trade-btn-secondary"
              >
                ← Back
              </button>
              <button type="submit" className="trade-btn trade-btn-primary">
                Save & Continue to Policies →
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* Step 3: Default Trade Credit Policies */}
      {currentStep === 3 && (
        <div className="trade-card" role="region" aria-label="Step 3: Default Trade Credit Policies">
          <h2 className="trade-card-title" style={{ marginBottom: "16px" }}>Default Trade Policies</h2>
          <Form method="post" onSubmit={() => setCurrentStep(4)}>
            <input type="hidden" name="intent" value="save_step" />
            <input type="hidden" name="step" value="3" />

            <div className="trade-field">
              <label htmlFor="defaultCreditLimit">Default Credit Limit ({onboarding.operatingCurrency})</label>
              <input
                id="defaultCreditLimit"
                name="defaultCreditLimit"
                type="number"
                step="0.01"
                min="0"
                defaultValue={onboarding.defaultCreditLimit}
                required
                className="trade-input"
              />
              <span className="trade-field-hint">Assigned automatically to new trade accounts</span>
            </div>

            <div className="trade-field">
              <label htmlFor="defaultTermsType">Default Payment Terms</label>
              <select id="defaultTermsType" name="defaultTermsType" defaultValue={onboarding.defaultTermsType} className="trade-select">
                <option value="net_monthly">Net Days (e.g. Net 30)</option>
                <option value="eom">End of Month (EOM)</option>
                <option value="cod">Cash on Delivery (COD)</option>
              </select>
            </div>

            <div className="trade-field">
              <label htmlFor="defaultTermsDays">Default Payment Days</label>
              <input
                id="defaultTermsDays"
                name="defaultTermsDays"
                type="number"
                min="0"
                max="365"
                defaultValue={onboarding.defaultTermsDays}
                className="trade-input"
              />
            </div>

            <div style={{ marginTop: "24px", display: "flex", justifyContent: "space-between" }}>
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="trade-btn trade-btn-secondary"
              >
                ← Back
              </button>
              <button type="submit" className="trade-btn trade-btn-primary">
                Save & Continue to Verification →
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* Step 4: Verification & Complete */}
      {currentStep === 4 && (
        <div className="trade-card" role="region" aria-label="Step 4: Verification and Final Setup">
          <h2 className="trade-card-title" style={{ marginBottom: "16px" }}>Ready to Trade</h2>
          <p style={{ color: "var(--p-color-text-secondary)", marginBottom: "16px" }}>
            All configuration is stored directly in your Shopify app instance. Your initial sample trade debtor (Ubuntu Hardware Trade) has been seeded with realistic balances and open invoices for immediate testing.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "20px" }}>
            <div style={{ padding: "14px", border: "1px solid var(--p-color-border)", borderRadius: "6px" }}>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Shopify Connected</div>
              <div style={{ fontSize: "13px", color: "var(--p-color-success-text)" }}>✓ {onboarding.shopDomain}</div>
            </div>
            <div style={{ padding: "14px", border: "1px solid var(--p-color-border)", borderRadius: "6px" }}>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Currency</div>
              <div style={{ fontSize: "13px" }}>{onboarding.operatingCurrency} (South African Rand)</div>
            </div>
            <div style={{ padding: "14px", border: "1px solid var(--p-color-border)", borderRadius: "6px" }}>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Aging Engine</div>
              <div style={{ fontSize: "13px" }}>8-Bucket {onboarding.agingBasis.replace("_", " ")}</div>
            </div>
          </div>

          <Form method="post">
            <input type="hidden" name="intent" value="complete" />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "24px" }}>
              <button
                type="button"
                onClick={() => setCurrentStep(3)}
                className="trade-btn trade-btn-secondary"
              >
                ← Back
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="trade-btn trade-btn-primary"
                style={{ padding: "10px 24px" }}
              >
                {isSubmitting ? "Finalizing..." : "Complete Setup & Launch Suite"}
              </button>
            </div>
          </Form>
        </div>
      )}
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
