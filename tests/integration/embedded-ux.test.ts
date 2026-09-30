import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { buildServer } from "../../apps/api/src/server.ts";
import { createMockSessionToken } from "../../apps/api/src/auth/shopify.ts";
import {
  getDebtorsList,
  getDebtorDetails,
  createDebtorAccount,
  updateDebtorPolicy,
  recordPaymentAndAllocate,
  reverseAllocation,
  getOnboardingState,
  updateOnboardingState,
  calculateAccountBalances,
  calculateAccountExposure,
  calculateAccountAging,
  extractSessionToken,
} from "../../apps/shopify/genesis-trade-suite/app/trade-accounts.server.ts";

const migration0001 = fileURLToPath(
  new URL("../../packages/database/migrations/0001_core.sql", import.meta.url),
);
const migration0002 = fileURLToPath(
  new URL("../../packages/database/migrations/0002_posting.sql", import.meta.url),
);
const migration0003 = fileURLToPath(
  new URL("../../packages/database/migrations/0003_allocation.sql", import.meta.url),
);
const migration0004 = fileURLToPath(
  new URL("../../packages/database/migrations/0004_reservations.sql", import.meta.url),
);
const migration0005 = fileURLToPath(
  new URL("../../packages/database/migrations/0005_idempotency.sql", import.meta.url),
);

describe("TASK-017: Embedded Web UX & API Contracts", () => {
  it("debtor list and search: filters by query and status, and calculates aggregate metrics", async () => {
    const all = await getDebtorsList();
    assert.ok(all.length >= 4, "Should have at least 4 baseline trade debtors");

    // Search by name
    const searchUbuntu = await getDebtorsList("Ubuntu");
    assert.equal(searchUbuntu.length, 1);
    assert.equal(searchUbuntu[0]?.accountNumber, "ACC-001");

    // Search by account number
    const searchAcc002 = await getDebtorsList("ACC-002");
    assert.equal(searchAcc002.length, 1);
    assert.equal(searchAcc002[0]?.name, "Cape Agri Supplies");

    // Filter by status: hold
    const holdAccounts = await getDebtorsList(undefined, "hold");
    assert.ok(holdAccounts.length >= 1);
    assert.equal(holdAccounts[0]?.accountNumber, "ACC-003");

    // Filter by status: active
    const activeAccounts = await getDebtorsList(undefined, "active");
    for (const acc of activeAccounts) {
      assert.equal(acc.status, "active");
    }
  });

  it("debtor details & exposure: computes live balance, active reservations, and available credit", async () => {
    const details = await getDebtorDetails("acc-001");
    assert.ok(details, "Debtor acc-001 must exist");

    const { account, balances, exposure, aging, documents } = details;

    // Validate account metadata and mapping
    assert.equal(account.accountNumber, "ACC-001");
    assert.equal(account.currency, "ZAR");
    assert.equal(account.shopifyCustomerId, "gid://shopify/Customer/8192837461");
    assert.equal(account.shopifyCompanyId, "gid://shopify/Company/10928374");

    // Exposure calculations: posted balance + active reservation = total exposure
    assert.equal(exposure.creditLimit, "25000.00");
    const postedNum = parseFloat(exposure.postedBalance);
    const resNum = parseFloat(exposure.activeReservations);
    const totalExpNum = parseFloat(exposure.totalExposure);
    const availNum = parseFloat(exposure.availableCredit);

    assert.equal(totalExpNum, postedNum + resNum, "Total exposure must equal posted balance + active reservations");
    assert.equal(availNum, 25000 - totalExpNum, "Available credit must equal limit minus exposure");

    // Open invoices visibility
    assert.ok(documents.length >= 3);
    for (const doc of documents) {
      const amt = parseFloat(doc.amount);
      const alloc = parseFloat(doc.allocatedAmount);
      const rem = parseFloat(doc.remainingAmount);
      assert.equal(rem, amt - alloc, "Remaining amount must equal amount minus allocated amount");
    }
  });

  it("8-bucket aging: calculates all eight buckets with freshness and unapplied credit offsets", async () => {
    const aging = calculateAccountAging("acc-001", "2026-09-28");

    // Verify all 8 bucket properties exist
    assert.ok("current" in aging);
    assert.ok("d030" in aging);
    assert.ok("d060" in aging);
    assert.ok("d090" in aging);
    assert.ok("d120" in aging);
    assert.ok("d150" in aging);
    assert.ok("d180" in aging);
    assert.ok("over" in aging);

    // Mathematical invariant: sum(open debits) - unapplied credit = netBalance
    const bucketSum =
      parseFloat(aging.current) +
      parseFloat(aging.d030) +
      parseFloat(aging.d060) +
      parseFloat(aging.d090) +
      parseFloat(aging.d120) +
      parseFloat(aging.d150) +
      parseFloat(aging.d180) +
      parseFloat(aging.over);

    const totalOpen = parseFloat(aging.total);
    const unapplied = parseFloat(aging.unappliedCredit);
    const net = parseFloat(aging.netBalance);

    assert.equal(bucketSum, totalOpen, "Sum of aging buckets must equal total open debits");
    assert.equal(totalOpen - unapplied, net, "Total open debits minus unapplied credit must equal net balance");
  });

  it("policy settings: enforces optimistic concurrency versioning and audit reason requirements", async () => {
    const details = await getDebtorDetails("acc-002");
    assert.ok(details);
    const initialVersion = details.account.policyVersion;

    // Successful update with matching expectedPolicyVersion
    const updated = await updateDebtorPolicy("acc-002", {
      creditLimit: "55000.00",
      status: "active",
      expectedPolicyVersion: initialVersion,
      reason: "Annual credit limit expansion approved by management",
    });

    assert.equal(updated.creditLimit, "55000.00");
    assert.equal(updated.policyVersion, initialVersion + 1);

    // Stale version precondition rejection (Optimistic Concurrency Conflict)
    await assert.rejects(
      async () => {
        await updateDebtorPolicy("acc-002", {
          creditLimit: "60000.00",
          expectedPolicyVersion: initialVersion, // Stale!
          reason: "Concurrent change attempt",
        });
      },
      /concurrency conflict/i
    );

    // Audit reason required
    await assert.rejects(
      async () => {
        await updateDebtorPolicy("acc-002", {
          creditLimit: "60000.00",
          expectedPolicyVersion: updated.policyVersion,
          reason: "   ", // Empty!
        });
      },
      /reason is required/i
    );
  });

  it("allocation workbench: FIFO oldest-first allocates across invoices and makes unapplied remainder visible", async () => {
    // Record payment of 3000 against acc-001 (which has open invoices: 2000 remaining on INV-001, 1500 on INV-002, 2800 on INV-003)
    const result = await recordPaymentAndAllocate({
      debtorAccountId: "acc-001",
      receiptAmount: "3000.00",
      currency: "ZAR",
      paymentMode: "external_receipt",
      reference: "EFT-TEST-001",
      mode: "oldest_first",
    });

    // 2000 allocated to INV-001 (closes it), 1000 allocated to INV-002 (500 remaining)
    assert.equal(result.allocatedTotal, "3000.00");
    assert.equal(result.unallocatedRemainder, "0.00", "Remainder must be exactly 0.00 when fully allocated");

    // Overpayment scenario: payment of 4000 against remaining open debits
    const overpaymentResult = await recordPaymentAndAllocate({
      debtorAccountId: "acc-004", // acc-004 has INV-2026-030 with 4200.00
      receiptAmount: "5000.00",
      currency: "ZAR",
      paymentMode: "shopify_manual",
      reference: "OVERPAY-001",
      mode: "oldest_first",
    });

    // 4200 allocated, 800 unapplied remainder visible!
    assert.equal(overpaymentResult.allocatedTotal, "4200.00");
    assert.equal(overpaymentResult.unallocatedRemainder, "800.00", "Unapplied remainder must be visible as 800.00");
  });

  it("allocation workbench: explicit allocation prevents over-allocation and supports reversal", async () => {
    const details = await getDebtorDetails("acc-002");
    assert.ok(details);
    const invoice = details.documents[0]!;

    // Explicit allocation exceeding invoice balance fails closed
    await assert.rejects(
      async () => {
        await recordPaymentAndAllocate({
          debtorAccountId: "acc-002",
          receiptAmount: "20000.00",
          currency: "ZAR",
          paymentMode: "shopify_pos_cash",
          reference: "POS-CASH-01",
          mode: "explicit",
          explicitAllocations: [{ invoiceId: invoice.id, amount: "15000.00" }], // Exceeds 12500 invoice remaining
        });
      },
      /exceeds invoice.*remaining balance/i
    );

    // Valid explicit allocation
    const result = await recordPaymentAndAllocate({
      debtorAccountId: "acc-002",
      receiptAmount: "10000.00",
      currency: "ZAR",
      paymentMode: "shopify_pos_cash",
      reference: "POS-CASH-02",
      mode: "explicit",
      explicitAllocations: [{ invoiceId: invoice.id, amount: "6000.00" }],
    });

    assert.equal(result.allocatedTotal, "6000.00");
    assert.equal(result.unallocatedRemainder, "4000.00");

    // Reversal test
    const updatedDetails = await getDebtorDetails("acc-002");
    const lastAlloc = updatedDetails?.allocations[0]!;
    assert.equal(lastAlloc.reversed, false);

    const reversalResult = await reverseAllocation({
      debtorAccountId: "acc-002",
      allocationId: lastAlloc.id,
      reason: "Correction of cashier entry",
    });

    assert.equal(reversalResult.success, true);
    assert.equal(reversalResult.restoredAmount, "6000.00");

    // Double-reversal rejection
    await assert.rejects(
      async () => {
        await reverseAllocation({
          debtorAccountId: "acc-002",
          allocationId: lastAlloc.id,
          reason: "Double reversal attempt",
        });
      },
      /already been reversed/i
    );
  });

  it("debtor creation: creates trade account mapped to Shopify customer and company GID", async () => {
    const created = await createDebtorAccount({
      accountNumber: "ACC-099",
      name: "Stellenbosch Industrial Timber",
      shopifyCustomerId: "gid://shopify/Customer/9900112233",
      shopifyCompanyId: "gid://shopify/Company/88776655",
      currency: "ZAR",
      creditLimit: "45000.00",
      termsType: "net_monthly",
      termsDays: 45,
      agingBasis: "due_date",
      contactEmail: "accounts@stellenboschtimber.co.za",
      contactPhone: "+27 21 888 1234",
    });

    assert.equal(created.accountNumber, "ACC-099");
    assert.equal(created.shopifyCustomerId, "gid://shopify/Customer/9900112233");
    assert.equal(created.shopifyCompanyId, "gid://shopify/Company/88776655");
    assert.equal(created.creditLimit, "45000.00");
    assert.equal(created.termsDays, 45);
    assert.equal(created.policyVersion, 1);
    assert.equal(created.ledgerVersion, 1);

    const fetched = await getDebtorDetails(created.id);
    assert.ok(fetched);
    assert.equal(fetched.account.name, "Stellenbosch Industrial Timber");
    assert.equal(fetched.balances.netBalance, "0.00");
    assert.equal(fetched.exposure.availableCredit, "45000.00");
  });

  it("allocation workbench: rejects zero or negative receipt amounts", async () => {
    await assert.rejects(
      async () => {
        await recordPaymentAndAllocate({
          debtorAccountId: "acc-001",
          receiptAmount: "0.00",
          currency: "ZAR",
          paymentMode: "external_receipt",
          reference: "ZERO-REF",
          mode: "oldest_first",
        });
      },
      /greater than zero/i
    );

    await assert.rejects(
      async () => {
        await recordPaymentAndAllocate({
          debtorAccountId: "acc-001",
          receiptAmount: "-500.00",
          currency: "ZAR",
          paymentMode: "external_receipt",
          reference: "NEG-REF",
          mode: "oldest_first",
        });
      },
      /plain decimal|greater than zero/i
    );
  });

  it("onboarding acceptance: needs only Shopify installation, never Genesis runtime or SQL Server", async () => {
    const onboarding = await getOnboardingState();

    // Verify Shopify connection
    assert.ok(onboarding.shopDomain.includes("myshopify.com"));
    assert.equal(onboarding.installationVerified, true);
    assert.equal(onboarding.scopesVerified, true);

    // Strict architectural invariant: NO Genesis server or SQL Server dependency
    assert.equal(
      onboarding.requiresGenesisServer,
      false,
      "Acceptance invariant violated: onboarding must never require Genesis server or SQL credentials"
    );

    // Regional preferences update
    const updated = await updateOnboardingState({
      operatingCurrency: "USD",
      agingBasis: "calendar_period",
      defaultCreditLimit: "20000.00",
    });

    assert.equal(updated.operatingCurrency, "USD");
    assert.equal(updated.agingBasis, "calendar_period");
    assert.equal(updated.requiresGenesisServer, false);
  });

  it("session token forwarding: forwards genuine per-request session tokens from React Router request context to Fastify API", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(readFileSync(migration0001, "utf8"));
      await db.exec(readFileSync(migration0002, "utf8"));
      await db.exec(readFileSync(migration0003, "utf8"));
      await db.exec(readFileSync(migration0004, "utf8"));
      await db.exec(readFileSync(migration0005, "utf8"));

      const tenantId = "33333333-3333-4333-8333-333333333333";
      const shopDomain = "displaydeck.myshopify.com";
      const apiSecret = "shpss_test_secret_key_12345";
      const clientId = "test_client_id_67890";

      // 1. Seed tenant, ledger accounts, installation, actor, payment term, and debtor account
      await db.query(
        "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'DisplayDeck Wholesale', 'ZAR', 'UTC', 'active')",
        [tenantId],
      );
      await db.query("SELECT seed_standard_ledger_accounts($1)", [tenantId]);

      await db.query(
        `INSERT INTO installation (tenant_id, shop_gid, shop_domain, status, installed_at, token_secret_ref, scopes)
         VALUES ($1, 'gid://shopify/Shop/1', $2, 'active', now(), 'secrets://test/token', ARRAY['read_customers'])`,
        [tenantId, shopDomain],
      );

      await db.query(
        `INSERT INTO actor (tenant_id, external_subject, display_name, role)
         VALUES
           ($1, 'gid://shopify/User/20', 'Live Bookkeeper', 'bookkeeper'),
           ($1, 'gid://shopify/User/10', 'Live Manager', 'manager')`,
        [tenantId],
      );

      const termRes = await db.query<{ id: string }>(
        "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
        [tenantId],
      );

      const debtorRes = await db.query<{ id: string }>(
        `INSERT INTO debtor_account (
          tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
        ) VALUES (
          $1, 'LIVE-DEBT-01', 'Live Steel & Concrete Ltd', 'ZAR', $2, 75000.00, 'active', 'due_date'
        ) RETURNING id`,
        [tenantId, termRes.rows[0]!.id],
      );
      const debtorId = debtorRes.rows[0]!.id;

      // 2. Start Fastify server on an ephemeral port
      const server = buildServer({
        db,
        apiSecretKey: apiSecret,
        clientId,
      });
      const listenAddress = await server.listen({ port: 0, host: "127.0.0.1" });

      const prevApiUrl = process.env.TRADE_API_URL;
      const prevApiToken = process.env.TRADE_API_TOKEN;
      process.env.TRADE_API_URL = listenAddress;
      delete process.env.TRADE_API_TOKEN; // Ensure NO static fallback token is used

      try {
        // 3. Create genuine signed Shopify session tokens for bookkeeper and manager
        const bookkeeperSessionToken = createMockSessionToken(
          { dest: shopDomain, aud: clientId, sub: "gid://shopify/User/20" },
          apiSecret,
        );
        const managerSessionToken = createMockSessionToken(
          { dest: shopDomain, aud: clientId, sub: "gid://shopify/User/10" },
          apiSecret,
        );

        // 4. Create mock React Router request carrying bookkeeper session token
        const bookkeeperRequest = new Request("https://displaydeck.myshopify.com/app/accounts", {
          headers: {
            Authorization: `Bearer ${bookkeeperSessionToken}`,
          },
        });

        // 5. Query debtor list through trade-accounts.server.ts with request
        const list = await getDebtorsList(undefined, undefined, bookkeeperRequest);
        assert.ok(Array.isArray(list), "Must return array of debtor accounts from PostgreSQL");
        assert.equal(list.length, 1);
        assert.equal(list[0]?.accountNumber, "LIVE-DEBT-01");
        assert.equal(list[0]?.name, "Live Steel & Concrete Ltd");

        // 6. Query debtor details through trade-accounts.server.ts with request
        const details = await getDebtorDetails(debtorId, bookkeeperRequest);
        assert.ok(details);
        assert.equal(details.account.accountNumber, "LIVE-DEBT-01");
        assert.equal(details.account.creditLimit, "75000.00");

        // 7. Verify Bookkeeper is denied manage_policy
        await assert.rejects(
          async () => {
            await updateDebtorPolicy(
              debtorId,
              {
                creditLimit: "85000.00",
                expectedPolicyVersion: 1,
                reason: "Unauthorized attempt",
              },
              bookkeeperRequest,
            );
          },
          /not authorized to perform 'manage_policy'/i,
          "Bookkeeper must be forbidden from updating debtor credit policy",
        );

        // 8. Manager with genuine session token successfully mutates policy through trade-accounts.server.ts
        const managerRequest = new Request(`https://displaydeck.myshopify.com/app/accounts/${debtorId}`, {
          headers: {
            Authorization: `Bearer ${managerSessionToken}`,
          },
        });
        const updated = await updateDebtorPolicy(
          debtorId,
          {
            creditLimit: "85000.00",
            expectedPolicyVersion: 1,
            reason: "Annual credit line increase",
            termsType: "eom",
            termsDays: 15,
          },
          managerRequest,
        );
        assert.equal(updated.creditLimit, "85000.00");
        assert.equal(updated.policyVersion, 2);
        const changedPolicy = await getDebtorDetails(debtorId, managerRequest);
        assert.equal(changedPolicy!.account.termsType, "eom");
        assert.equal(changedPolicy!.account.termsDays, 15);
        const newAccount = await createDebtorAccount({
          accountNumber: "LIVE-DEBT-02", name: "Synthetic mapped customer",
          shopifyCustomerId: "gid://shopify/Customer/999001",
          shopifyCompanyId: "gid://shopify/Company/999002",
          currency: "ZAR", creditLimit: "1000.00", termsType: "cod", termsDays: 0,
          agingBasis: "due_date", contactEmail: "synthetic@example.test", contactPhone: "",
        }, managerRequest);
        const mapped = await getDebtorDetails(newAccount.id, managerRequest);
        assert.equal(mapped!.account.shopifyCustomerId, "gid://shopify/Customer/999001");
        assert.equal(mapped!.account.shopifyCompanyId, "gid://shopify/Company/999002");
        assert.equal(mapped!.account.contactEmail, "synthetic@example.test");
        assert.equal(mapped!.account.termsType, "cod");
        assert.equal(mapped!.account.termsDays, 0);

        // 8. An unauthenticated request without session token fails closed with 401
        const unauthenticatedRequest = new Request("https://displaydeck.myshopify.com/app/accounts");
        await assert.rejects(
          async () => {
            await getDebtorsList(undefined, undefined, unauthenticatedRequest);
          },
          /Trade API HTTP 401/i,
          "Request without session token must fail closed with HTTP 401",
        );
      } finally {
        if (prevApiUrl) process.env.TRADE_API_URL = prevApiUrl;
        else delete process.env.TRADE_API_URL;
        if (prevApiToken) process.env.TRADE_API_TOKEN = prevApiToken;
        await server.close();
      }
    } finally {
      await db.close();
    }
  });
});
