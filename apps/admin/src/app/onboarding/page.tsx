"use client";

import { useState } from "react";
import Link from "next/link";

export default function OnboardingPage() {
  const [step, setStep] = useState<number>(1);
  const [currency, setCurrency] = useState<string>("ZAR");
  const [agingBasis, setAgingBasis] = useState<string>("due_date");
  const [creditLimit, setCreditLimit] = useState<number>(15000);
  const [termsDays, setTermsDays] = useState<number>(30);
  const [completed, setCompleted] = useState<boolean>(false);

  return (
    <>
      <p className="eyebrow">Setup & Configuration</p>
      <h1>Shopify-Native Trade Suite Onboarding</h1>
      <p className="lead">
        Configure your retail accounting preferences. Onboarding connects directly to your Shopify store and requires zero Genesis server installation or SQL Server credentials.
      </p>

      {/* Prominent Architectural Invariant Notice */}
      <div style={{ background: "#e1f0f7", border: "1px solid #b2d7e8", padding: "16px", borderRadius: "8px", margin: "20px 0", color: "#025982" }}>
        <strong>Shopify-Native Architecture:</strong> Genesis Trade Accounts is a modern cloud SaaS application.
        It runs entirely on Shopify App Bridge and modern cloud APIs. <strong>No Genesis Windows runtime, no SQL Server credentials, and no on-premise hardware setup are required.</strong>
      </div>

      {completed ? (
        <div style={{ background: "white", padding: "32px", borderRadius: "10px", border: "1px solid #dce6de", textAlign: "center" }}>
          <h2 style={{ color: "#175b42" }}>✓ Setup Complete!</h2>
          <p style={{ color: "#465a4f", maxWidth: "540px", margin: "12px auto 24px" }}>
            Your Shopify store is configured with {currency} currency and 8-bucket {agingBasis === "due_date" ? "Due-Date" : "Calendar Period"} aging. Default credit limit is set to {currency} {creditLimit.toFixed(2)}.
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            <Link href="/accounts" className="btn btn-primary">
              View Trade Accounts Directory →
            </Link>
            <Link href="/allocations" className="btn btn-secondary">
              Open Payment Workbench →
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ background: "white", padding: "24px", borderRadius: "10px", border: "1px solid #dce6de", margin: "20px 0" }}>
          {/* Step 1: Shopify Installation */}
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: "18px", marginTop: 0 }}>Step 1: Shopify Store Installation</h2>
              <p style={{ color: "#5a6e62", marginBottom: "18px" }}>
                Verifying Shopify app installation, App Bridge tokens, and store permissions.
              </p>
              <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "#f8faf8", borderRadius: "6px" }}>
                  <span>Shopify Store:</span>
                  <strong>displaydeck.myshopify.com</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "#f8faf8", borderRadius: "6px" }}>
                  <span>App Bridge Session:</span>
                  <span className="badge badge-active">Authenticated</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "#f8faf8", borderRadius: "6px" }}>
                  <span>External Genesis Server:</span>
                  <span className="badge badge-info">Not Required (Shopify Native)</span>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setStep(2)} className="btn btn-primary">
                  Continue to Currency & Terms →
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Currency & Aging */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: "18px", marginTop: 0 }}>Step 2: Currency & Aging Basis</h2>
              <div className="admin-form">
                <div className="form-field">
                  <label htmlFor="currency">Operating Currency</label>
                  <select
                    id="currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    <option value="ZAR">ZAR — South African Rand (R)</option>
                    <option value="USD">USD — US Dollar ($)</option>
                    <option value="EUR">EUR — Euro (€)</option>
                    <option value="GBP">GBP — British Pound (£)</option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="agingBasis">Aging Basis</label>
                  <select
                    id="agingBasis"
                    value={agingBasis}
                    onChange={(e) => setAgingBasis(e.target.value)}
                  >
                    <option value="due_date">Due Date Aging (8 Standard Buckets: Current, 30, 60, 90, 120, 150, 180, 180+)</option>
                    <option value="calendar_period">Accounting Calendar Period</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "24px" }}>
                <button type="button" onClick={() => setStep(1)} className="btn btn-secondary">
                  ← Back
                </button>
                <button type="button" onClick={() => setStep(3)} className="btn btn-primary">
                  Continue to Default Policies →
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Default Policies */}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: "18px", marginTop: 0 }}>Step 3: Default Trade Credit Policies</h2>
              <div className="admin-form">
                <div className="form-field">
                  <label htmlFor="creditLimit">Default Credit Limit ({currency})</label>
                  <input
                    id="creditLimit"
                    type="number"
                    step="0.01"
                    min="0"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="termsDays">Default Payment Days</label>
                  <input
                    id="termsDays"
                    type="number"
                    min="0"
                    max="365"
                    value={termsDays}
                    onChange={(e) => setTermsDays(parseInt(e.target.value) || 30)}
                  />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "24px" }}>
                <button type="button" onClick={() => setStep(2)} className="btn btn-secondary">
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => setCompleted(true)}
                  className="btn btn-primary"
                >
                  Complete Setup & Launch
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <Link className="back" href="/">← Return to overview</Link>
    </>
  );
}
