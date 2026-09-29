import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("TASK-017: Embedded UX Keyboard Accessibility & Contracts", () => {
  it("accounts directory component contains keyboard accessibility and ARIA landmarks", () => {
    const routePath = path.resolve("apps/shopify/genesis-trade-suite/app/routes/app.accounts.tsx");
    const content = fs.readFileSync(routePath, "utf-8");

    // Check keyboard shortcut for search
    assert.ok(content.includes('e.key === "/"'), "Must contain keyboard shortcut listener for '/' search focus");
    assert.ok(content.includes('role="search"'), "Must contain accessible role='search'");
    assert.ok(content.includes('role="region"'), "Must contain accessible role='region' for table and metrics");
    assert.ok(content.includes('role="tablist"'), "Must contain status filter tablist with accessible tab roles");
    assert.ok(content.includes('aria-label='), "Must contain explicit aria-labels for assistive technologies");
    assert.ok(content.includes('tabIndex={0}'), "Table rows or interactive elements must be focusable via tabIndex");
  });

  it("allocation workbench contains live remainder visibility and aria-live announcements", () => {
    const routePath = path.resolve("apps/shopify/genesis-trade-suite/app/routes/app.allocations.tsx");
    const content = fs.readFileSync(routePath, "utf-8");

    // Check remainder visibility
    assert.ok(content.includes("Unapplied Remainder"), "Must prominently display unapplied remainder");
    assert.ok(content.includes('aria-live="polite"'), "Remainder summary bar must have aria-live='polite' for real-time screen reader announcements");
    assert.ok(content.includes('role="status"'), "Remainder box must declare role='status'");
    assert.ok(content.includes("isOverAllocated"), "Must check for over-allocation and warn the user");
    assert.ok(content.includes("paymentMode"), "Must support visible selection of payment channel modes");
    assert.ok(content.includes("oldest_first") && content.includes("explicit"), "Must support both oldest-first FIFO and explicit allocation modes");
  });

  it("debtor details route contains 8-bucket aging and optimistic concurrency policy form", () => {
    const routePath = path.resolve("apps/shopify/genesis-trade-suite/app/routes/app.accounts.$id.tsx");
    const content = fs.readFileSync(routePath, "utf-8");

    // Check 8-bucket aging
    for (const bucket of ["Current", "1–30 Days", "31–60 Days", "61–90 Days", "91–120 Days", "121–150 Days", "151–180 Days", "180+ Days"]) {
      assert.ok(content.includes(bucket), `Must include ${bucket} in 8-bucket aging display`);
    }

    // Check optimistic concurrency form field
    assert.ok(content.includes('name="expectedPolicyVersion"'), "Must include expectedPolicyVersion in policy form for optimistic concurrency");
    assert.ok(content.includes('name="reason"'), "Must include required reason field for audit logging");
  });

  it("onboarding flow strictly requires only Shopify installation, with zero Genesis server/SQL references", () => {
    const routePath = path.resolve("apps/shopify/genesis-trade-suite/app/routes/app.onboarding.tsx");
    const content = fs.readFileSync(routePath, "utf-8");

    // Check invariant text in onboarding
    assert.ok(
      content.includes("No Genesis Windows server, no SQL Server credentials") ||
      content.includes("No Genesis server, no SQL Server credentials"),
      "Onboarding must visibly state no Genesis server or SQL Server is required"
    );
    assert.ok(content.includes("shopDomain"), "Onboarding must verify Shopify store domain");
    assert.ok(!content.includes("sqlserver://") && !content.includes("genesis_host"), "Must not ask for SQL Server or Genesis host configurations");
  });

  it("isDemoMode fails closed in production when TRADE_API_URL is unconfigured", async () => {
    const { isDemoMode } = await import("../../apps/shopify/genesis-trade-suite/app/trade-accounts.server.ts");
    const origEnv = process.env.NODE_ENV;
    const origUrl = process.env.TRADE_API_URL;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.TRADE_API_URL;
      assert.throws(
        () => isDemoMode(),
        /TRADE_API_URL must be configured in production runtimes/,
        "Must throw in production when TRADE_API_URL is missing",
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origUrl) process.env.TRADE_API_URL = origUrl;
      else delete process.env.TRADE_API_URL;
    }
  });
});
