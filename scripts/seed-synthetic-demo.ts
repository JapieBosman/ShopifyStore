import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DbClient } from "../packages/database/tenant-context.ts";
import { withTenantContext } from "../packages/database/tenant-context.ts";
import { initApiDatabase } from "../apps/api/src/db.ts";
import { postJournal, type PostingBundle } from "../packages/domain/src/posting.ts";
import {
  executeExplicitAllocation,
  reverseAllocation,
  getDebtorBalanceSummary,
} from "../packages/domain/src/allocation.ts";
import { buildAgingSnapshot } from "../packages/domain/src/aging.ts";
import { executeStatementRun } from "../apps/worker/src/statements.ts";
import {
  enqueueStatementDelivery,
  processQueuedDeliveries,
} from "../apps/worker/src/delivery.ts";
import {
  MockStatementEmailProvider,
  setStatementEmailProvider,
} from "../packages/domain/src/delivery.ts";

export interface SeedOptions {
  tenantAId?: string;
  tenantBId?: string;
  primaryShop?: string;
  secondaryShop?: string;
  asOfDate?: string;
  force?: boolean;
}

export interface SeedAccountSummary {
  id: string;
  accountNumber: string;
  name: string;
  limit: string;
  status: string;
  netBalance: string;
}

export interface SeedDocumentSummary {
  id: string;
  number: string;
  amount: string;
}

export interface SeedResult {
  success: boolean;
  alreadySeeded: boolean;
  tenants: {
    tenantA: { id: string; name: string; currency: string };
    tenantB: { id: string; name: string; currency: string };
  };
  actors: {
    ownerId: string;
    managerId: string;
    bookkeeperId: string;
    cashierId: string;
  };
  accounts: {
    ubuntuHardware: SeedAccountSummary;
    capeAgri: SeedAccountSummary;
    bolandConstruction: SeedAccountSummary;
    highveldIndustrial: SeedAccountSummary;
    durbanMarine: SeedAccountSummary;
    usDebtor?: { id: string; accountNumber: string; currency: string };
  };
  documents: {
    inv1001: SeedDocumentSummary;
    inv1002: SeedDocumentSummary;
    inv2001: SeedDocumentSummary;
    rct1001: SeedDocumentSummary;
    inv1010: SeedDocumentSummary;
    rct1010: SeedDocumentSummary;
    inv1020: SeedDocumentSummary;
  };
  statement?: {
    statementRunId: string;
    statementId: string;
    closingBalance: string;
    pdfSha256: string;
    pdfObjectKey: string;
  };
  delivery?: {
    deliveryId: string;
    status: string;
    providerMessageId: string | null;
  };
}

export const DEFAULT_TENANT_A_ID = "33333333-3333-4333-8333-333333333333";
export const DEFAULT_TENANT_B_ID = "44444444-4444-4444-8444-444444444444";
export const DEFAULT_PRIMARY_SHOP = "displaydeck.myshopify.com";
export const DEFAULT_SECONDARY_SHOP = "apex-building.myshopify.com";

export const ACCOUNT_IDS = {
  ACC_001: "11111111-1111-4111-8111-111111111111",
  ACC_002: "22222222-2222-4222-8222-222222222222",
  ACC_003: "55555555-5555-4555-8555-555555555555",
  ACC_004: "66666666-6666-4666-8666-666666666666",
  ACC_US_01: "77777777-7777-4777-8777-777777777777",
};

/**
 * Programmatic seeding function for synthetic trade demo.
 * Ensures idempotent setup of multi-tenant accounts, financial subledgers,
 * 8-bucket aging snapshots, statement runs, PDF binaries, and delivery records.
 */
export async function seedSyntheticDemo(
  db: DbClient,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const tenantAId = options.tenantAId || process.env.TEST_TENANT_ID || DEFAULT_TENANT_A_ID;
  const tenantBId = options.tenantBId || DEFAULT_TENANT_B_ID;
  const primaryShop = options.primaryShop || process.env.SHOPIFY_SHOP_DOMAIN || DEFAULT_PRIMARY_SHOP;
  const secondaryShop = options.secondaryShop || DEFAULT_SECONDARY_SHOP;
  const asOfDate = options.asOfDate || "2026-09-29";

  // 1. Ensure Tenant A & Standard Ledger Accounts
  await db.query(
    `INSERT INTO tenant (id, name, base_currency, timezone, status)
     VALUES ($1, 'DisplayDeck Trade Store', 'ZAR', 'UTC', 'active')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status`,
    [tenantAId],
  );
  await db.query("SELECT seed_standard_ledger_accounts($1)", [tenantAId]);

  // Ensure Tenant B (Isolation Check)
  await db.query(
    `INSERT INTO tenant (id, name, base_currency, timezone, status)
     VALUES ($1, 'Apex Building Supplies (USD)', 'USD', 'UTC', 'active')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status`,
    [tenantBId],
  );
  await db.query("SELECT seed_standard_ledger_accounts($1)", [tenantBId]);

  // 2. Installations & Locations
  const instARes = await db.query<{ id: string }>(
    `INSERT INTO installation (tenant_id, shop_gid, shop_domain, status, installed_at, token_secret_ref, scopes)
     VALUES ($1, 'gid://shopify/Shop/1', $2, 'active', now(), 'secrets://test/token-a', ARRAY['read_customers','read_orders'])
     ON CONFLICT (tenant_id, shop_domain) DO UPDATE SET status = 'active'
     RETURNING id`,
    [tenantAId, primaryShop],
  );
  const installationAId = instARes.rows[0]!.id;

  await db.query(
    `INSERT INTO location (tenant_id, installation_id, shopify_location_gid, name, timezone)
     VALUES ($1, $2, 'gid://shopify/Location/1', 'Main Store Counter', 'UTC')
     ON CONFLICT (tenant_id, shopify_location_gid) DO NOTHING`,
    [tenantAId, installationAId],
  );

  const instBRes = await db.query<{ id: string }>(
    `INSERT INTO installation (tenant_id, shop_gid, shop_domain, status, installed_at, token_secret_ref, scopes)
     VALUES ($1, 'gid://shopify/Shop/2', $2, 'active', now(), 'secrets://test/token-b', ARRAY['read_customers','read_orders'])
     ON CONFLICT (tenant_id, shop_domain) DO UPDATE SET status = 'active'
     RETURNING id`,
    [tenantBId, secondaryShop],
  );
  const installationBId = instBRes.rows[0]!.id;

  await db.query(
    `INSERT INTO location (tenant_id, installation_id, shopify_location_gid, name, timezone)
     VALUES ($1, $2, 'gid://shopify/Location/2', 'US Regional Warehouse', 'UTC')
     ON CONFLICT (tenant_id, shopify_location_gid) DO NOTHING`,
    [tenantBId, installationBId],
  );

  // 3. Payment Terms for Tenant A
  const term30Res = await db.query<{ id: string }>(
    `INSERT INTO payment_term (tenant_id, code, kind, days)
     VALUES ($1, 'NET30', 'net_days', 30)
     ON CONFLICT (tenant_id, code) DO UPDATE SET days = EXCLUDED.days
     RETURNING id`,
    [tenantAId],
  );
  const term30Id = term30Res.rows[0]!.id;

  const term60Res = await db.query<{ id: string }>(
    `INSERT INTO payment_term (tenant_id, code, kind, days)
     VALUES ($1, 'NET60', 'net_days', 60)
     ON CONFLICT (tenant_id, code) DO UPDATE SET days = EXCLUDED.days
     RETURNING id`,
    [tenantAId],
  );
  const term60Id = term60Res.rows[0]!.id;

  const termEomRes = await db.query<{ id: string }>(
    `INSERT INTO payment_term (tenant_id, code, kind, days)
     VALUES ($1, 'EOM', 'end_of_month', 30)
     ON CONFLICT (tenant_id, code) DO UPDATE SET days = EXCLUDED.days
     RETURNING id`,
    [tenantAId],
  );
  const termEomId = termEomRes.rows[0]!.id;

  // Payment Term for Tenant B
  const termBRes = await db.query<{ id: string }>(
    `INSERT INTO payment_term (tenant_id, code, kind, days)
     VALUES ($1, 'NET30', 'net_days', 30)
     ON CONFLICT (tenant_id, code) DO UPDATE SET days = EXCLUDED.days
     RETURNING id`,
    [tenantBId],
  );
  const termBId = termBRes.rows[0]!.id;

  // 4. Actors for Tenant A
  const actorOwnerRes = await db.query<{ id: string }>(
    `INSERT INTO actor (tenant_id, external_subject, display_name, role)
     VALUES ($1, 'gid://shopify/User/1', 'Owner Admin', 'owner')
     ON CONFLICT (tenant_id, external_subject) DO UPDATE SET role = EXCLUDED.role
     RETURNING id`,
    [tenantAId],
  );
  const actorManagerRes = await db.query<{ id: string }>(
    `INSERT INTO actor (tenant_id, external_subject, display_name, role)
     VALUES ($1, 'gid://shopify/User/10', 'Megan Manager', 'manager')
     ON CONFLICT (tenant_id, external_subject) DO UPDATE SET role = EXCLUDED.role
     RETURNING id`,
    [tenantAId],
  );
  const actorBookkeeperRes = await db.query<{ id: string }>(
    `INSERT INTO actor (tenant_id, external_subject, display_name, role)
     VALUES ($1, 'gid://shopify/User/20', 'Brian Bookkeeper', 'bookkeeper')
     ON CONFLICT (tenant_id, external_subject) DO UPDATE SET role = EXCLUDED.role
     RETURNING id`,
    [tenantAId],
  );
  const actorCashierRes = await db.query<{ id: string }>(
    `INSERT INTO actor (tenant_id, external_subject, display_name, role)
     VALUES ($1, 'gid://shopify/User/30', 'Chloe Cashier', 'cashier')
     ON CONFLICT (tenant_id, external_subject) DO UPDATE SET role = EXCLUDED.role
     RETURNING id`,
    [tenantAId],
  );

  const ownerId = actorOwnerRes.rows[0]!.id;
  const managerId = actorManagerRes.rows[0]!.id;
  const bookkeeperId = actorBookkeeperRes.rows[0]!.id;
  const cashierId = actorCashierRes.rows[0]!.id;

  // Actor for Tenant B
  await db.query(
    `INSERT INTO actor (tenant_id, external_subject, display_name, role)
     VALUES ($1, 'gid://shopify/User/100', 'US Manager', 'manager')
     ON CONFLICT (tenant_id, external_subject) DO UPDATE SET role = EXCLUDED.role`,
    [tenantBId],
  );

  // 5. Debtor Accounts for Tenant A
  // ACC-001: Ubuntu Hardware Trade (Active, R 25,000 limit, NET30, due_date)
  await db.query(
    `INSERT INTO debtor_account (
       id, tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
     ) VALUES ($1, $2, 'ACC-001', 'Ubuntu Hardware Trade', 'ZAR', $3, 25000.0000, 'active', 'due_date')
     ON CONFLICT (id) DO UPDATE SET legal_name = EXCLUDED.legal_name, credit_limit = EXCLUDED.credit_limit, status = EXCLUDED.status`,
    [ACCOUNT_IDS.ACC_001, tenantAId, term30Id],
  );

  // ACC-002: Cape Agri Supplies (Active, R 50,000 limit, NET60, due_date)
  await db.query(
    `INSERT INTO debtor_account (
       id, tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
     ) VALUES ($1, $2, 'ACC-002', 'Cape Agri Supplies', 'ZAR', $3, 50000.0000, 'active', 'due_date')
     ON CONFLICT (id) DO UPDATE SET legal_name = EXCLUDED.legal_name, credit_limit = EXCLUDED.credit_limit, status = EXCLUDED.status`,
    [ACCOUNT_IDS.ACC_002, tenantAId, term60Id],
  );

  // ACC-003: Highveld Industrial Tools (Hold, R 10,000 limit, NET30, due_date)
  await db.query(
    `INSERT INTO debtor_account (
       id, tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, hold_reason, aging_basis
     ) VALUES ($1, $2, 'ACC-003', 'Highveld Industrial Tools', 'ZAR', $3, 10000.0000, 'hold', 'Exceeded credit limit and overdue invoices under review', 'due_date')
     ON CONFLICT (id) DO UPDATE SET legal_name = EXCLUDED.legal_name, credit_limit = EXCLUDED.credit_limit, status = EXCLUDED.status, hold_reason = EXCLUDED.hold_reason`,
    [ACCOUNT_IDS.ACC_003, tenantAId, term30Id],
  );

  // ACC-004: Durban Marine Logistics (Closed, R 30,000 limit, EOM, calendar_period)
  await db.query(
    `INSERT INTO debtor_account (
       id, tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
     ) VALUES ($1, $2, 'ACC-004', 'Durban Marine Logistics', 'ZAR', $3, 30000.0000, 'closed', 'calendar_period')
     ON CONFLICT (id) DO UPDATE SET legal_name = EXCLUDED.legal_name, status = EXCLUDED.status`,
    [ACCOUNT_IDS.ACC_004, tenantAId, termEomId],
  );

  // Debtor Account for Tenant B
  await db.query(
    `INSERT INTO debtor_account (
       id, tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
     ) VALUES ($1, $2, 'ACC-US-01', 'Pacific Timber Supplies', 'USD', $3, 10000.0000, 'active', 'due_date')
     ON CONFLICT (id) DO UPDATE SET legal_name = EXCLUDED.legal_name, credit_limit = EXCLUDED.credit_limit, status = EXCLUDED.status`,
    [ACCOUNT_IDS.ACC_US_01, tenantBId, termBId],
  );

  // 6. Billing Contacts & Customer Identities for Tenant A
  await db.query(
    `INSERT INTO billing_contact (id, tenant_id, debtor_account_id, name, email, phone, send_statements)
     VALUES ('b1111111-1111-4111-8111-111111111111', $1, $2, 'Accounts Dept', 'accounts@ubuntuhardware.co.za', '+27 11 555 0142', true)
     ON CONFLICT (tenant_id, id) DO UPDATE SET email = EXCLUDED.email, send_statements = EXCLUDED.send_statements`,
    [tenantAId, ACCOUNT_IDS.ACC_001],
  );
  await db.query(
    `INSERT INTO debtor_identity (tenant_id, debtor_account_id, kind, shopify_gid)
     VALUES ($1, $2, 'customer', 'gid://shopify/Customer/8192837461')
     ON CONFLICT (tenant_id, kind, shopify_gid) DO NOTHING`,
    [tenantAId, ACCOUNT_IDS.ACC_001],
  );

  await db.query(
    `INSERT INTO billing_contact (id, tenant_id, debtor_account_id, name, email, phone, send_statements)
     VALUES ('b2222222-2222-4222-8222-222222222222', $1, $2, 'Finance Team', 'orders@capeagri.co.za', '+27 21 555 9821', true)
     ON CONFLICT (tenant_id, id) DO UPDATE SET email = EXCLUDED.email, send_statements = EXCLUDED.send_statements`,
    [tenantAId, ACCOUNT_IDS.ACC_002],
  );
  await db.query(
    `INSERT INTO debtor_identity (tenant_id, debtor_account_id, kind, shopify_gid)
     VALUES ($1, $2, 'customer', 'gid://shopify/Customer/8192837462')
     ON CONFLICT (tenant_id, kind, shopify_gid) DO NOTHING`,
    [tenantAId, ACCOUNT_IDS.ACC_002],
  );

  await db.query(
    `INSERT INTO billing_contact (id, tenant_id, debtor_account_id, name, email, phone, send_statements)
     VALUES ('b3333333-3333-4333-8333-333333333333', $1, $2, 'Procurement Buyer', 'buyer@highveld.co.za', '+27 12 555 4410', false)
     ON CONFLICT (tenant_id, id) DO UPDATE SET email = EXCLUDED.email, send_statements = EXCLUDED.send_statements`,
    [tenantAId, ACCOUNT_IDS.ACC_003],
  );

  await db.query(
    `INSERT INTO billing_contact (id, tenant_id, debtor_account_id, name, email, phone, send_statements)
     VALUES ('b4444444-4444-4444-8444-444444444444', $1, $2, 'Accounts Payable', 'finance@durbanmarine.co.za', '+27 31 555 8890', false)
     ON CONFLICT (tenant_id, id) DO UPDATE SET email = EXCLUDED.email, send_statements = EXCLUDED.send_statements`,
    [tenantAId, ACCOUNT_IDS.ACC_004],
  );

  // 7. Check if financial journals already exist (Idempotency)
  const existingJrnCheck = await db.query<{ id: string }>(
    "SELECT id FROM journal WHERE tenant_id = $1 AND idempotency_key = 'idem-seed-jrn-001'",
    [tenantAId],
  );

  let inv1001DocId = "";
  let inv1002DocId = "";
  let inv2001DocId = "";
  let rct1001DocId = "";
  let inv1010DocId = "";
  let rct1010DocId = "";
  let inv1020DocId = "";

  const accountsRes = await db.query<{ id: string; code: string }>(
    "SELECT id, code FROM ledger_account WHERE tenant_id = $1",
    [tenantAId],
  );
  const arAccountId = accountsRes.rows.find((a) => a.code === "1200")!.id;
  const bankAccountId = accountsRes.rows.find((a) => a.code === "1010")!.id;
  const salesAccountId = accountsRes.rows.find((a) => a.code === "4010")!.id;

  if (existingJrnCheck.rows.length === 0) {
    // -------------------------------------------------------------------------
    // Post Financial Transactions for Tenant A
    // -------------------------------------------------------------------------

    // ACC-001 Invoices & Partial Payment
    // INV-2026-001: R 3,200.00 (Issued 2026-07-15, Due 2026-08-14)
    const p1 = await postJournal(db, tenantAId, {
      actorId: bookkeeperId,
      currency: "ZAR",
      effectiveDate: "2026-07-15",
      sourceKind: "order",
      sourceKey: "seed:order:inv-2026-001",
      idempotencyKey: "idem-seed-jrn-001",
      memo: "Invoice INV-2026-001 for Ubuntu Hardware Trade",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: ACCOUNT_IDS.ACC_001, direction: "debit", amount: "3200.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "3200.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: ACCOUNT_IDS.ACC_001,
          documentNumber: "INV-2026-001",
          kind: "invoice",
          direction: "debit",
          amount: "3200.0000",
          currency: "ZAR",
          issuedOn: "2026-07-15",
          dueOn: "2026-08-14",
          sourceEventKey: "seed:inv-2026-001",
        },
      ],
    });
    inv1001DocId = p1.documentIds[0]!;

    // INV-2026-002: R 1,500.00 (Issued 2026-08-20, Due 2026-09-19)
    const p2 = await postJournal(db, tenantAId, {
      actorId: bookkeeperId,
      currency: "ZAR",
      effectiveDate: "2026-08-20",
      sourceKind: "order",
      sourceKey: "seed:order:inv-2026-002",
      idempotencyKey: "idem-seed-jrn-002",
      memo: "Invoice INV-2026-002 for Ubuntu Hardware Trade",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: ACCOUNT_IDS.ACC_001, direction: "debit", amount: "1500.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "1500.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: ACCOUNT_IDS.ACC_001,
          documentNumber: "INV-2026-002",
          kind: "invoice",
          direction: "debit",
          amount: "1500.0000",
          currency: "ZAR",
          issuedOn: "2026-08-20",
          dueOn: "2026-09-19",
          sourceEventKey: "seed:inv-2026-002",
        },
      ],
    });
    inv1002DocId = p2.documentIds[0]!;

    // INV-2026-003: R 2,800.00 (Issued 2026-09-25, Due 2026-10-25)
    const p3 = await postJournal(db, tenantAId, {
      actorId: bookkeeperId,
      currency: "ZAR",
      effectiveDate: "2026-09-25",
      sourceKind: "order",
      sourceKey: "seed:order:inv-2026-003",
      idempotencyKey: "idem-seed-jrn-003",
      memo: "Invoice INV-2026-003 for Ubuntu Hardware Trade",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: ACCOUNT_IDS.ACC_001, direction: "debit", amount: "2800.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "2800.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: ACCOUNT_IDS.ACC_001,
          documentNumber: "INV-2026-003",
          kind: "invoice",
          direction: "debit",
          amount: "2800.0000",
          currency: "ZAR",
          issuedOn: "2026-09-25",
          dueOn: "2026-10-25",
          sourceEventKey: "seed:inv-2026-003",
        },
      ],
    });
    inv2001DocId = p3.documentIds[0]!;

    // RCT-2026-001: R 1,200.00 (Issued 2026-08-25)
    const p4 = await postJournal(db, tenantAId, {
      actorId: bookkeeperId,
      currency: "ZAR",
      effectiveDate: "2026-08-25",
      sourceKind: "payment",
      sourceKey: "seed:payment:rct-2026-001",
      idempotencyKey: "idem-seed-jrn-004",
      memo: "Payment RCT-2026-001 from Ubuntu Hardware Trade",
      lines: [
        { ledgerAccountId: bankAccountId, direction: "debit", amount: "1200.0000", currency: "ZAR" },
        { ledgerAccountId: arAccountId, debtorAccountId: ACCOUNT_IDS.ACC_001, direction: "credit", amount: "1200.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: ACCOUNT_IDS.ACC_001,
          documentNumber: "RCT-2026-001",
          kind: "payment",
          direction: "credit",
          amount: "1200.0000",
          currency: "ZAR",
          issuedOn: "2026-08-25",
          sourceEventKey: "seed:rct-2026-001",
        },
      ],
    });
    rct1001DocId = p4.documentIds[0]!;

    // ACC-002: Overpayment Scenario
    // INV-2026-010: R 12,500.00 (Issued 2026-08-01, Due 2026-09-30)
    const p5 = await postJournal(db, tenantAId, {
      actorId: bookkeeperId,
      currency: "ZAR",
      effectiveDate: "2026-08-01",
      sourceKind: "order",
      sourceKey: "seed:order:inv-2026-010",
      idempotencyKey: "idem-seed-jrn-005",
      memo: "Invoice INV-2026-010 for Cape Agri Supplies",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: ACCOUNT_IDS.ACC_002, direction: "debit", amount: "12500.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "12500.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: ACCOUNT_IDS.ACC_002,
          documentNumber: "INV-2026-010",
          kind: "invoice",
          direction: "debit",
          amount: "12500.0000",
          currency: "ZAR",
          issuedOn: "2026-08-01",
          dueOn: "2026-09-30",
          sourceEventKey: "seed:inv-2026-010",
        },
      ],
    });
    inv1010DocId = p5.documentIds[0]!;

    // RCT-2026-010: R 15,000.00 (Issued 2026-08-15)
    const p6 = await postJournal(db, tenantAId, {
      actorId: bookkeeperId,
      currency: "ZAR",
      effectiveDate: "2026-08-15",
      sourceKind: "payment",
      sourceKey: "seed:payment:rct-2026-010",
      idempotencyKey: "idem-seed-jrn-006",
      memo: "Overpayment receipt RCT-2026-010 from Cape Agri Supplies",
      lines: [
        { ledgerAccountId: bankAccountId, direction: "debit", amount: "15000.0000", currency: "ZAR" },
        { ledgerAccountId: arAccountId, debtorAccountId: ACCOUNT_IDS.ACC_002, direction: "credit", amount: "15000.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: ACCOUNT_IDS.ACC_002,
          documentNumber: "RCT-2026-010",
          kind: "payment",
          direction: "credit",
          amount: "15000.0000",
          currency: "ZAR",
          issuedOn: "2026-08-15",
          sourceEventKey: "seed:rct-2026-010",
        },
      ],
    });
    rct1010DocId = p6.documentIds[0]!;

    // ACC-003: Overdue Invoice on Hold
    // INV-2026-020: R 11,500.00 (Issued 2026-05-15, Due 2026-06-14)
    const p7 = await postJournal(db, tenantAId, {
      actorId: bookkeeperId,
      currency: "ZAR",
      effectiveDate: "2026-05-15",
      sourceKind: "order",
      sourceKey: "seed:order:inv-2026-020",
      idempotencyKey: "idem-seed-jrn-007",
      memo: "Invoice INV-2026-020 for Highveld Industrial Tools",
      lines: [
        { ledgerAccountId: arAccountId, debtorAccountId: ACCOUNT_IDS.ACC_003, direction: "debit", amount: "11500.0000", currency: "ZAR" },
        { ledgerAccountId: salesAccountId, direction: "credit", amount: "11500.0000", currency: "ZAR" },
      ],
      documents: [
        {
          debtorAccountId: ACCOUNT_IDS.ACC_003,
          documentNumber: "INV-2026-020",
          kind: "invoice",
          direction: "debit",
          amount: "11500.0000",
          currency: "ZAR",
          issuedOn: "2026-05-15",
          dueOn: "2026-06-14",
          sourceEventKey: "seed:inv-2026-020",
        },
      ],
    });
    inv1020DocId = p7.documentIds[0]!;

    // -------------------------------------------------------------------------
    // Post Transactions for Tenant B (USD Isolation Check)
    // -------------------------------------------------------------------------
    const accountsBRes = await db.query<{ id: string; code: string }>(
      "SELECT id, code FROM ledger_account WHERE tenant_id = $1",
      [tenantBId],
    );
    const arBId = accountsBRes.rows.find((a) => a.code === "1200")!.id;
    const salesBId = accountsBRes.rows.find((a) => a.code === "4010")!.id;

    await postJournal(db, tenantBId, {
      actorId: (await db.query<{ id: string }>("SELECT id FROM actor WHERE tenant_id = $1 LIMIT 1", [tenantBId])).rows[0]!.id,
      currency: "USD",
      effectiveDate: "2026-08-15",
      sourceKind: "order",
      sourceKey: "seed:order:inv-usd-001",
      idempotencyKey: "idem-seed-jrn-usd-001",
      memo: "Invoice INV-USD-001 for Pacific Timber Supplies",
      lines: [
        { ledgerAccountId: arBId, debtorAccountId: ACCOUNT_IDS.ACC_US_01, direction: "debit", amount: "12500.0000", currency: "USD" },
        { ledgerAccountId: salesBId, direction: "credit", amount: "12500.0000", currency: "USD" },
      ],
      documents: [
        {
          debtorAccountId: ACCOUNT_IDS.ACC_US_01,
          documentNumber: "INV-USD-001",
          kind: "invoice",
          direction: "debit",
          amount: "12500.0000",
          currency: "USD",
          issuedOn: "2026-08-15",
          dueOn: "2026-09-15",
          sourceEventKey: "seed:inv-usd-001",
        },
      ],
    });

    // -------------------------------------------------------------------------
    // Execute Allocations & Reversals for Tenant A
    // -------------------------------------------------------------------------
    // ALLOC-001: Allocate RCT-2026-001 (R 1,200.00) to INV-2026-001
    await executeExplicitAllocation(db, tenantAId, {
      actorId: bookkeeperId,
      debtorAccountId: ACCOUNT_IDS.ACC_001,
      debitDocumentId: inv1001DocId,
      creditDocumentId: rct1001DocId,
      amount: "1200.0000",
      effectiveDate: "2026-08-25",
      idempotencyKey: "idem-seed-alloc-001",
    });

    // ALLOC-002: Allocate RCT-2026-010 (R 12,500.00) to INV-2026-010
    const alloc2Result = await executeExplicitAllocation(db, tenantAId, {
      actorId: bookkeeperId,
      debtorAccountId: ACCOUNT_IDS.ACC_002,
      debitDocumentId: inv1010DocId,
      creditDocumentId: rct1010DocId,
      amount: "12500.0000",
      effectiveDate: "2026-08-15",
      idempotencyKey: "idem-seed-alloc-002",
    });

    // Immutable reversal demonstration: reverse ALLOC-002, restoring open debt & unapplied credit
    await reverseAllocation(db, tenantAId, {
      actorId: bookkeeperId,
      allocationId: alloc2Result.allocationId,
      reason: "Audit test: reversal of explicit allocation to prove subledger restoration",
      effectiveDate: "2026-08-16",
    });

    // Re-allocate RCT-2026-010 to leave Cape Agri in target overpayment state
    await executeExplicitAllocation(db, tenantAId, {
      actorId: bookkeeperId,
      debtorAccountId: ACCOUNT_IDS.ACC_002,
      debitDocumentId: inv1010DocId,
      creditDocumentId: rct1010DocId,
      amount: "12500.0000",
      effectiveDate: "2026-08-17",
      idempotencyKey: "idem-seed-alloc-002b",
    });
  } else {
    // If journals already exist, resolve document IDs
    const docs = await db.query<{ id: string; document_number: string }>(
      "SELECT id, document_number FROM document WHERE tenant_id = $1",
      [tenantAId],
    );
    inv1001DocId = docs.rows.find((d) => d.document_number === "INV-2026-001")?.id || "";
    inv1002DocId = docs.rows.find((d) => d.document_number === "INV-2026-002")?.id || "";
    inv2001DocId = docs.rows.find((d) => d.document_number === "INV-2026-003")?.id || "";
    rct1001DocId = docs.rows.find((d) => d.document_number === "RCT-2026-001")?.id || "";
    inv1010DocId = docs.rows.find((d) => d.document_number === "INV-2026-010")?.id || "";
    rct1010DocId = docs.rows.find((d) => d.document_number === "RCT-2026-010")?.id || "";
    inv1020DocId = docs.rows.find((d) => d.document_number === "INV-2026-020")?.id || "";
  }

  // 8. 8-Bucket Aging Snapshots for all Tenant A accounts
  await buildAgingSnapshot(db, tenantAId, {
    debtorAccountId: ACCOUNT_IDS.ACC_001,
    asOfDate,
    basis: "due_date",
  });
  await buildAgingSnapshot(db, tenantAId, {
    debtorAccountId: ACCOUNT_IDS.ACC_002,
    asOfDate,
    basis: "due_date",
  });
  await buildAgingSnapshot(db, tenantAId, {
    debtorAccountId: ACCOUNT_IDS.ACC_003,
    asOfDate,
    basis: "due_date",
  });
  await buildAgingSnapshot(db, tenantAId, {
    debtorAccountId: ACCOUNT_IDS.ACC_004,
    asOfDate,
    basis: "calendar_period",
  });

  // 9. Statement Run for September 2026
  let statementRunId = "";
  let statementId = "";
  let closingBalance = "";
  let pdfSha256 = "";
  let pdfObjectKey = "";

  const existingRunRes = await db.query<{ id: string }>(
    `SELECT id FROM statement_run
     WHERE tenant_id = $1 AND period_from = '2026-09-01' AND period_to = '2026-09-30' AND generation = 1`,
    [tenantAId],
  );

  if (existingRunRes.rows.length === 0) {
    const runResult = await executeStatementRun(db, tenantAId, {
      periodFrom: "2026-09-01",
      periodTo: "2026-09-30",
      cutoffRecordedAt: "2026-09-30T23:59:59.999Z",
      generation: 1,
      actorId: bookkeeperId,
    });
    statementRunId = runResult.statementRunId;
  } else {
    statementRunId = existingRunRes.rows[0]!.id;
  }

  const stmtRes = await db.query<{
    id: string;
    closing_balance: string;
    pdf_sha256: string;
    pdf_object_key: string;
  }>(
    `SELECT id, closing_balance, pdf_sha256, pdf_object_key
     FROM statement
     WHERE tenant_id = $1 AND statement_run_id = $2 AND debtor_account_id = $3`,
    [tenantAId, statementRunId, ACCOUNT_IDS.ACC_001],
  );

  if (stmtRes.rows.length > 0) {
    statementId = stmtRes.rows[0]!.id;
    closingBalance = String(stmtRes.rows[0]!.closing_balance);
    pdfSha256 = stmtRes.rows[0]!.pdf_sha256;
    pdfObjectKey = stmtRes.rows[0]!.pdf_object_key;
  }

  // 10. Statement Delivery Dispatch
  let deliveryId = "";
  let deliveryStatus = "accepted";
  let providerMsgId: string | null = "msg_synth_demo_001";

  if (statementId) {
    const mockEmail = new MockStatementEmailProvider();
    setStatementEmailProvider(mockEmail);

    const deliveryRecord = await enqueueStatementDelivery(db, tenantAId, {
      statementId,
      channel: "email",
      recipientEmail: "accounts@ubuntuhardware.co.za",
      idempotencyKey: "idem-seed-deliver-001",
    });
    deliveryId = deliveryRecord.id;

    if (deliveryRecord.status === "queued") {
      const processRes = await processQueuedDeliveries(db, tenantAId, {
        limit: 1,
        recipientEmailOverride: "accounts@ubuntuhardware.co.za",
      });
      const d = processRes.deliveries.find((del) => del.id === deliveryId);
      deliveryStatus = d?.status || "accepted";
      providerMsgId = d?.providerMessageId || "msg_synth_demo_001";
    } else {
      deliveryStatus = deliveryRecord.status;
      providerMsgId = deliveryRecord.providerMessageId;
    }
  }

  // Fetch final balance summaries
  const sum1 = await getDebtorBalanceSummary(db, tenantAId, ACCOUNT_IDS.ACC_001);
  const sum2 = await getDebtorBalanceSummary(db, tenantAId, ACCOUNT_IDS.ACC_002);
  const sum3 = await getDebtorBalanceSummary(db, tenantAId, ACCOUNT_IDS.ACC_003);
  const sum4 = await getDebtorBalanceSummary(db, tenantAId, ACCOUNT_IDS.ACC_004);

  return {
    success: true,
    alreadySeeded: existingJrnCheck.rows.length > 0,
    tenants: {
      tenantA: { id: tenantAId, name: "DisplayDeck Trade Store", currency: "ZAR" },
      tenantB: { id: tenantBId, name: "Apex Building Supplies (USD)", currency: "USD" },
    },
    actors: {
      ownerId,
      managerId,
      bookkeeperId,
      cashierId,
    },
    accounts: {
      ubuntuHardware: {
        id: ACCOUNT_IDS.ACC_001,
        accountNumber: "ACC-001",
        name: "Ubuntu Hardware Trade",
        limit: "25000.0000",
        status: "active",
        netBalance: sum1.netBalance,
      },
      capeAgri: {
        id: ACCOUNT_IDS.ACC_002,
        accountNumber: "ACC-002",
        name: "Cape Agri Supplies",
        limit: "50000.0000",
        status: "active",
        netBalance: sum2.netBalance,
      },
      bolandConstruction: {
        id: ACCOUNT_IDS.ACC_003,
        accountNumber: "ACC-003",
        name: "Highveld Industrial Tools",
        limit: "10000.0000",
        status: "hold",
        netBalance: sum3.netBalance,
      },
      highveldIndustrial: {
        id: ACCOUNT_IDS.ACC_003,
        accountNumber: "ACC-003",
        name: "Highveld Industrial Tools",
        limit: "10000.0000",
        status: "hold",
        netBalance: sum3.netBalance,
      },
      durbanMarine: {
        id: ACCOUNT_IDS.ACC_004,
        accountNumber: "ACC-004",
        name: "Durban Marine Logistics",
        limit: "30000.0000",
        status: "closed",
        netBalance: sum4.netBalance,
      },
      usDebtor: {
        id: ACCOUNT_IDS.ACC_US_01,
        accountNumber: "ACC-US-01",
        currency: "USD",
      },
    },
    documents: {
      inv1001: { id: inv1001DocId, number: "INV-2026-001", amount: "3200.0000" },
      inv1002: { id: inv1002DocId, number: "INV-2026-002", amount: "1500.0000" },
      inv2001: { id: inv2001DocId, number: "INV-2026-003", amount: "2800.0000" },
      rct1001: { id: rct1001DocId, number: "RCT-2026-001", amount: "1200.0000" },
      inv1010: { id: inv1010DocId, number: "INV-2026-010", amount: "12500.0000" },
      rct1010: { id: rct1010DocId, number: "RCT-2026-010", amount: "15000.0000" },
      inv1020: { id: inv1020DocId, number: "INV-2026-020", amount: "11500.0000" },
    },
    statement: statementId
      ? {
          statementRunId,
          statementId,
          closingBalance,
          pdfSha256,
          pdfObjectKey,
        }
      : undefined,
    delivery: deliveryId
      ? {
          deliveryId,
          status: deliveryStatus,
          providerMessageId: providerMsgId,
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Direct CLI Execution
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  (async () => {
    console.log("[SEED-DEMO] Initializing database connection...");
    const db = await initApiDatabase({
      seedDemo: false,
    });

    try {
      console.log("[SEED-DEMO] Running synthetic demo seeder...");
      const result = await seedSyntheticDemo(db);

      console.log(`[SEED-DEMO] Seeding completed successfully (alreadySeeded: ${result.alreadySeeded})`);
      console.log("\n=======================================================");
      console.log("  GENESIS TRADE SUITE — SYNTHETIC DEMO FIXTURES");
      console.log("=======================================================");
      console.log(`Primary Tenant:   ${result.tenants.tenantA.name} (${result.tenants.tenantA.currency}) [${result.tenants.tenantA.id}]`);
      console.log(`Secondary Tenant: ${result.tenants.tenantB.name} (${result.tenants.tenantB.currency}) [${result.tenants.tenantB.id}]`);
      console.log("-------------------------------------------------------");
      console.log("Trade Accounts Seeded:");
      console.log(`  * ${result.accounts.ubuntuHardware.accountNumber} - ${result.accounts.ubuntuHardware.name}`);
      console.log(`    Status: ${result.accounts.ubuntuHardware.status} | Limit: R ${result.accounts.ubuntuHardware.limit} | Net Balance: R ${result.accounts.ubuntuHardware.netBalance}`);
      console.log(`  * ${result.accounts.capeAgri.accountNumber} - ${result.accounts.capeAgri.name}`);
      console.log(`    Status: ${result.accounts.capeAgri.status} | Limit: R ${result.accounts.capeAgri.limit} | Net Balance: R ${result.accounts.capeAgri.netBalance} (Overpayment Credit)`);
      console.log(`  * ${result.accounts.highveldIndustrial.accountNumber} - ${result.accounts.highveldIndustrial.name}`);
      console.log(`    Status: ${result.accounts.highveldIndustrial.status} | Limit: R ${result.accounts.highveldIndustrial.limit} | Net Balance: R ${result.accounts.highveldIndustrial.netBalance} (Credit Hold)`);
      console.log(`  * ${result.accounts.durbanMarine.accountNumber} - ${result.accounts.durbanMarine.name}`);
      console.log(`    Status: ${result.accounts.durbanMarine.status} | Limit: R ${result.accounts.durbanMarine.limit} | Net Balance: R ${result.accounts.durbanMarine.netBalance} (Closed Account)`);
      console.log("-------------------------------------------------------");
      if (result.statement) {
        console.log(`Statement Run:    ${result.statement.statementRunId}`);
        console.log(`Statement ID:     ${result.statement.statementId} (Closing: R ${result.statement.closingBalance})`);
        console.log(`PDF SHA-256:      ${result.statement.pdfSha256}`);
      }
      if (result.delivery) {
        console.log(`Delivery ID:      ${result.delivery.deliveryId} (Status: ${result.delivery.status})`);
        console.log(`Provider Msg ID:  ${result.delivery.providerMessageId}`);
      }
      console.log("=======================================================\n");
    } catch (err) {
      console.error("[SEED-DEMO] Fatal seeding error:", err);
      process.exitCode = 1;
    } finally {
      await db.close?.();
    }
  })();
}
