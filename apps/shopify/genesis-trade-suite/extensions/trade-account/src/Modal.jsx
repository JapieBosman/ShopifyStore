import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { i18n } = shopify;

  // Fictional demonstration account (clearly marked as synthetic preview)
  const [selectedAccount] = useState({
    accountNumber: "ACC-001 [DEMO]",
    customerName: "Ubuntu Hardware Trade (Simulated)",
    creditLimit: "25000.00",
    currentBalance: "3500.00",
    availableCredit: "21500.00",
    currency: "ZAR",
    status: "active",
  });

  const [orderAmount, setOrderAmount] = useState("4500.00");
  const [poNumber, setPoNumber] = useState("");
  const [supervisorPin, setSupervisorPin] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [isOverriding, setIsOverriding] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState("idle"); // idle | simulated_normal | simulated_override | error
  const [statusMessage, setStatusMessage] = useState("");

  const parsedAvail = parseFloat(selectedAccount.availableCredit) || 0;
  const parsedOrder = parseFloat(orderAmount) || 0;
  const exceedsLimit = parsedOrder > parsedAvail;
  const requiresOverride = exceedsLimit || selectedAccount.status === "hold";

  const handleSimulateAction = () => {
    if (!poNumber.trim()) {
      setStatusMessage("Purchase Order (PO) number is required for trade charges.");
      setSimulationStatus("error");
      return;
    }

    if (requiresOverride && !isOverriding) {
      setIsOverriding(true);
      setStatusMessage("Simulated order exceeds available credit limit. Supervisor override required.");
      return;
    }

    if (requiresOverride && isOverriding) {
      if (!supervisorPin.trim() || !overrideReason.trim()) {
        setStatusMessage("Supervisor PIN and override justification are required for the simulation.");
        setSimulationStatus("error");
        return;
      }
      setSimulationStatus("simulated_override");
      setStatusMessage(
        `[SIMULATED MOCK ONLY - NO REAL CHARGE RECORDED] Client-side override simulation passed for ${selectedAccount.customerName} (PO #${poNumber.trim()}). No live credit reservation or server ledger write occurred. Real device POS integration is gated under TASK-003 / TASK-021.`
      );
      return;
    }

    setSimulationStatus("simulated_normal");
    setStatusMessage(
      `[SIMULATED MOCK ONLY - NO REAL CHARGE RECORDED] Client-side mock authorization completed for ${selectedAccount.currency} ${parsedOrder.toFixed(2)} under PO #${poNumber.trim()}. No live server reservation or financial ledger entry was created.`
    );
  };

  return (
    <s-page heading={i18n.translate("modal_heading")}>
      <s-scroll-box>
        <s-box padding="base">
          {/* Prominent Mandatory Simulation Disclaimer Banner */}
          <s-banner title={i18n.translate("simulation_warning_title")} tone="warning">
            <s-text>{i18n.translate("simulation_warning_body")}</s-text>
          </s-banner>

          {/* Simulation Outcome Banners */}
          {simulationStatus === "simulated_normal" && (
            <s-banner title="Simulation Result (Not a Real Approval)" tone="info">
              <s-text>{statusMessage}</s-text>
            </s-banner>
          )}

          {simulationStatus === "simulated_override" && (
            <s-banner title="Simulated Override (Not a Real Approval)" tone="info">
              <s-text>{statusMessage}</s-text>
            </s-banner>
          )}

          {simulationStatus === "error" && (
            <s-banner title="Input Validation Required" tone="critical">
              <s-text>{statusMessage}</s-text>
            </s-banner>
          )}

          {/* Account & Balance Info (Mock Data) */}
          <s-section heading="Simulated Customer Trade Account">
            <s-stack direction="vertical" spacing="tight">
              <s-text>
                <strong>Customer:</strong> {selectedAccount.customerName} ({selectedAccount.accountNumber})
              </s-text>
              <s-text>
                <strong>Status:</strong> {selectedAccount.status === "active" ? "Active (Simulated)" : "On Hold (Simulated)"}
              </s-text>
              <s-divider />
              <s-stack direction="horizontal" distribution="equalSpacing">
                <s-box>
                  <s-text tone="subdued">Credit Limit</s-text>
                  <s-text>
                    <strong>
                      {selectedAccount.currency} {selectedAccount.creditLimit}
                    </strong>
                  </s-text>
                </s-box>
                <s-box>
                  <s-text tone="subdued">Current Balance</s-text>
                  <s-text>
                    <strong>
                      {selectedAccount.currency} {selectedAccount.currentBalance}
                    </strong>
                  </s-text>
                </s-box>
                <s-box>
                  <s-text tone="subdued">Available Credit</s-text>
                  <s-text>
                    <strong>
                      {selectedAccount.currency} {selectedAccount.availableCredit}
                    </strong>
                  </s-text>
                </s-box>
              </s-stack>
            </s-stack>
          </s-section>

          {/* Transaction & PO Input */}
          <s-section heading="Simulated Transaction Details">
            <s-stack direction="vertical" spacing="tight">
              <s-text-field
                label="Order / Cart Total Amount (Simulated)"
                value={orderAmount}
                onInput={(e) => setOrderAmount(e.target.value)}
              />
              <s-text-field
                label="Purchase Order (PO) Number"
                placeholder="e.g. PO-8921"
                value={poNumber}
                onInput={(e) => setPoNumber(e.target.value)}
                helpText="Required for trade account invoicing."
              />
            </s-stack>
          </s-section>

          {/* Credit Check Status */}
          {exceedsLimit && (
            <s-banner title="Simulated Credit Limit Exceeded" tone="warning">
              <s-text>
                Order amount ({selectedAccount.currency} {parsedOrder.toFixed(2)}) exceeds simulated available credit (
                {selectedAccount.currency} {selectedAccount.availableCredit}). Supervisor override is required to test this branch.
              </s-text>
            </s-banner>
          )}

          {/* Supervisor Override Authorization Section (Mock) */}
          {isOverriding && (
            <s-section heading="Supervisor Override Simulation (Mock Only)">
              <s-stack direction="vertical" spacing="tight">
                <s-text-field
                  label="Supervisor PIN (Demo Mock)"
                  type="password"
                  placeholder="Enter demo PIN (e.g. 1234)"
                  value={supervisorPin}
                  onInput={(e) => setSupervisorPin(e.target.value)}
                />
                <s-text-field
                  label="Override Reason / Justification"
                  placeholder="e.g. Customer credit line extension approved by manager"
                  value={overrideReason}
                  onInput={(e) => setOverrideReason(e.target.value)}
                />
              </s-stack>
            </s-section>
          )}

          {/* Action Buttons */}
          <s-box padding="small">
            <s-stack direction="vertical" spacing="tight">
              {simulationStatus !== "simulated_normal" && simulationStatus !== "simulated_override" && (
                <s-button
                  type="primary"
                  onClick={handleSimulateAction}
                >
                  {isOverriding
                    ? "Simulate Supervisor Override (Mock Only)"
                    : "Simulate Charge Authorization (No Real Charge)"}
                </s-button>
              )}
            </s-stack>
          </s-box>
        </s-box>
      </s-scroll-box>
    </s-page>
  );
}
