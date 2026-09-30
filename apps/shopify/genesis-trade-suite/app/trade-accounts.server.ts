import { formatMoney, parseMoney } from "../../../../packages/domain/src/money.ts";
import { calculateDueDate, bucketForDueDate } from "../../../../packages/domain/src/terms.ts";
import { evaluateCredit, type CreditDecision } from "../../../../packages/domain/src/credit.ts";

export interface DebtorAccountData {
  id: string;
  accountNumber: string;
  name: string;
  shopifyCustomerId: string;
  shopifyCompanyId?: string | null;
  currency: string;
  creditLimit: string;
  status: "active" | "hold" | "closed";
  termsType: "net_monthly" | "eom" | "cod";
  termsDays: number;
  agingBasis: "due_date" | "calendar_period";
  contactEmail: string;
  contactPhone: string;
  policyVersion: number;
  ledgerVersion: number;
  createdAt: string;
}

export interface DebtorDocumentData {
  id: string;
  debtorAccountId: string;
  documentNumber: string;
  documentType: "invoice" | "credit_note" | "payment";
  direction: "debit" | "credit";
  issuedOn: string;
  dueOn: string;
  amount: string;
  allocatedAmount: string;
  remainingAmount: string;
  currency: string;
}

export interface DebtorAllocationData {
  id: string;
  debtorAccountId: string;
  debitDocumentId: string;
  debitDocumentNumber: string;
  creditDocumentId: string;
  creditDocumentNumber: string;
  amount: string;
  allocatedAt: string;
  reversed: boolean;
  reversalReason?: string;
}

export interface DebtorAgingBuckets {
  current: string;
  d030: string;
  d060: string;
  d090: string;
  d120: string;
  d150: string;
  d180: string;
  over: string;
  total: string;
  unappliedCredit: string;
  netBalance: string;
}

export interface DebtorBalanceSummary {
  totalDebits: string;
  totalCredits: string;
  unappliedCredit: string;
  netBalance: string;
}

export interface DebtorExposureSummary {
  postedBalance: string;
  activeReservations: string;
  totalExposure: string;
  creditLimit: string;
  availableCredit: string;
  approved: boolean;
}

export interface OnboardingState {
  isCompleted: boolean;
  step: number;
  shopDomain: string;
  installationVerified: boolean;
  scopesVerified: boolean;
  requiresGenesisServer: false; // Invariant: No Genesis installation required
  operatingCurrency: string;
  agingBasis: "due_date" | "calendar_period";
  defaultCreditLimit: string;
  defaultTermsType: "net_monthly" | "eom" | "cod";
  defaultTermsDays: number;
  sampleAccountCreated: boolean;
}


/**
 * Operating mode detection:
 * - "durable_api": Connected to durable PostgreSQL ledger service via TRADE_API_URL.
 * - "demo_memory": Operating on in-memory preview data for development/preview.
 */
export function isDemoMode(): boolean {
  if (process.env.NODE_ENV === "production" && !process.env.TRADE_API_URL) {
    throw new Error(
      "TRADE_API_URL must be configured in production runtimes. Demo memory mode is strictly prohibited in production.",
    );
  }
  return !process.env.TRADE_API_URL;
}

export function getStorageMode(): "durable_api" | "demo_memory" {
  return isDemoMode() ? "demo_memory" : "durable_api";
}

/**
 * Extracts a Shopify session token from an incoming Remix/React Router request.
 * Supports Bearer Authorization header and standard URL parameters.
 */
export function extractSessionToken(request?: Request): string | undefined {
  if (!request) return undefined;

  const authHeader = request.headers.get("Authorization") || request.headers.get("authorization");
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  try {
    const url = new URL(request.url);
    const idToken = url.searchParams.get("id_token") || url.searchParams.get("session_token");
    if (idToken) {
      return idToken.trim();
    }
  } catch {
    // Relative or invalid URL fallback
  }

  return undefined;
}

/**
 * Robust HTTP client to communicate with the durable Trade API service.
 */
async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    idempotencyKey?: string;
    request?: Request;
  } = {}
): Promise<T> {
  const baseUrl = process.env.TRADE_API_URL;
  if (!baseUrl) {
    throw new Error("TRADE_API_URL is not configured; running in demo simulation mode");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const sessionToken = extractSessionToken(options.request);
  if (sessionToken) {
    headers["Authorization"] = `Bearer ${sessionToken}`;
  } else if (process.env.TRADE_API_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.TRADE_API_TOKEN}`;
  } else if (process.env.NODE_ENV === "test" && !options.request) {
    headers["x-tenant-id"] = process.env.TEST_TENANT_ID || "tenant-shopify-demo";
    headers["x-actor-role"] = "owner";
    headers["x-actor-id"] = "actor-shopify-admin";
  }

  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as Record<string, any>;
    throw new Error(
      `Trade API HTTP ${res.status}: ${errorBody.message || errorBody.code || `error`}`
    );
  }

  return res.json() as Promise<T>;
}

// Initial state stores for development and preview (used when isDemoMode() is true)
const accountsStore: Map<string, DebtorAccountData> = new Map([
  [
    "acc-001",
    {
      id: "acc-001",
      accountNumber: "ACC-001",
      name: "Ubuntu Hardware Trade",
      shopifyCustomerId: "gid://shopify/Customer/8192837461",
      shopifyCompanyId: "gid://shopify/Company/10928374",
      currency: "ZAR",
      creditLimit: "25000.00",
      status: "active",
      termsType: "net_monthly",
      termsDays: 30,
      agingBasis: "due_date",
      contactEmail: "accounts@ubuntuhardware.co.za",
      contactPhone: "+27 11 555 0142",
      policyVersion: 1,
      ledgerVersion: 3,
      createdAt: "2026-09-01T08:00:00Z",
    },
  ],
  [
    "acc-002",
    {
      id: "acc-002",
      accountNumber: "ACC-002",
      name: "Cape Agri Supplies",
      shopifyCustomerId: "gid://shopify/Customer/8192837462",
      shopifyCompanyId: null,
      currency: "ZAR",
      creditLimit: "50000.00",
      status: "active",
      termsType: "net_monthly",
      termsDays: 60,
      agingBasis: "due_date",
      contactEmail: "orders@capeagri.co.za",
      contactPhone: "+27 21 555 9821",
      policyVersion: 1,
      ledgerVersion: 2,
      createdAt: "2026-09-05T09:30:00Z",
    },
  ],
  [
    "acc-003",
    {
      id: "acc-003",
      accountNumber: "ACC-003",
      name: "Highveld Industrial Tools",
      shopifyCustomerId: "gid://shopify/Customer/8192837463",
      shopifyCompanyId: "gid://shopify/Company/10928380",
      currency: "ZAR",
      creditLimit: "10000.00",
      status: "hold",
      termsType: "net_monthly",
      termsDays: 30,
      agingBasis: "due_date",
      contactEmail: "buyer@highveld.co.za",
      contactPhone: "+27 12 555 4410",
      policyVersion: 2,
      ledgerVersion: 4,
      createdAt: "2026-09-10T14:15:00Z",
    },
  ],
  [
    "acc-004",
    {
      id: "acc-004",
      accountNumber: "ACC-004",
      name: "Durban Marine Logistics",
      shopifyCustomerId: "gid://shopify/Customer/8192837464",
      shopifyCompanyId: null,
      currency: "ZAR",
      creditLimit: "30000.00",
      status: "active",
      termsType: "eom",
      termsDays: 30,
      agingBasis: "calendar_period",
      contactEmail: "finance@durbanmarine.co.za",
      contactPhone: "+27 31 555 8890",
      policyVersion: 1,
      ledgerVersion: 2,
      createdAt: "2026-09-15T11:00:00Z",
    },
  ],
]);

const documentsStore: Map<string, DebtorDocumentData[]> = new Map([
  [
    "acc-001",
    [
      {
        id: "doc-101",
        debtorAccountId: "acc-001",
        documentNumber: "INV-2026-001",
        documentType: "invoice",
        direction: "debit",
        issuedOn: "2026-07-15",
        dueOn: "2026-08-14",
        amount: "3200.00",
        allocatedAmount: "1200.00",
        remainingAmount: "2000.00",
        currency: "ZAR",
      },
      {
        id: "doc-102",
        debtorAccountId: "acc-001",
        documentNumber: "INV-2026-002",
        documentType: "invoice",
        direction: "debit",
        issuedOn: "2026-08-20",
        dueOn: "2026-09-19",
        amount: "1500.00",
        allocatedAmount: "0.00",
        remainingAmount: "1500.00",
        currency: "ZAR",
      },
      {
        id: "doc-103",
        debtorAccountId: "acc-001",
        documentNumber: "INV-2026-003",
        documentType: "invoice",
        direction: "debit",
        issuedOn: "2026-09-25",
        dueOn: "2026-10-25",
        amount: "2800.00",
        allocatedAmount: "0.00",
        remainingAmount: "2800.00",
        currency: "ZAR",
      },
    ],
  ],
  [
    "acc-002",
    [
      {
        id: "doc-201",
        debtorAccountId: "acc-002",
        documentNumber: "INV-2026-010",
        documentType: "invoice",
        direction: "debit",
        issuedOn: "2026-08-01",
        dueOn: "2026-09-30",
        amount: "12500.00",
        allocatedAmount: "0.00",
        remainingAmount: "12500.00",
        currency: "ZAR",
      },
      {
        id: "doc-202",
        debtorAccountId: "acc-002",
        documentNumber: "INV-2026-011",
        documentType: "invoice",
        direction: "debit",
        issuedOn: "2026-09-12",
        dueOn: "2026-11-11",
        amount: "5900.00",
        allocatedAmount: "0.00",
        remainingAmount: "5900.00",
        currency: "ZAR",
      },
    ],
  ],
  [
    "acc-003",
    [
      {
        id: "doc-301",
        debtorAccountId: "acc-003",
        documentNumber: "INV-2026-020",
        documentType: "invoice",
        direction: "debit",
        issuedOn: "2026-06-10",
        dueOn: "2026-07-10",
        amount: "9800.00",
        allocatedAmount: "0.00",
        remainingAmount: "9800.00",
        currency: "ZAR",
      },
    ],
  ],
  [
    "acc-004",
    [
      {
        id: "doc-401",
        debtorAccountId: "acc-004",
        documentNumber: "INV-2026-030",
        documentType: "invoice",
        direction: "debit",
        issuedOn: "2026-09-02",
        dueOn: "2026-09-30",
        amount: "4200.00",
        allocatedAmount: "0.00",
        remainingAmount: "4200.00",
        currency: "ZAR",
      },
    ],
  ],
]);

const allocationsStore: Map<string, DebtorAllocationData[]> = new Map([
  [
    "acc-001",
    [
      {
        id: "alloc-001",
        debtorAccountId: "acc-001",
        debitDocumentId: "doc-101",
        debitDocumentNumber: "INV-2026-001",
        creditDocumentId: "pay-101",
        creditDocumentNumber: "RCT-2026-001",
        amount: "1200.00",
        allocatedAt: "2026-08-15T10:00:00Z",
        reversed: false,
      },
    ],
  ],
]);

const reservationsStore: Map<string, { id: string; amount: string; status: string }[]> = new Map([
  ["acc-001", [{ id: "res-001", amount: "1200.00", status: "reserved" }]],
]);

let onboardingState: OnboardingState = {
  isCompleted: true,
  step: 4,
  shopDomain: "displaydeck.myshopify.com",
  installationVerified: true,
  scopesVerified: true,
  requiresGenesisServer: false,
  operatingCurrency: "ZAR",
  agingBasis: "due_date",
  defaultCreditLimit: "15000.00",
  defaultTermsType: "net_monthly",
  defaultTermsDays: 30,
  sampleAccountCreated: true,
};

function to2Decimals(units: bigint): string {
  const formatted = formatMoney(units);
  const parts = formatted.split(".");
  return `${parts[0]}.${(parts[1] || "00").slice(0, 2)}`;
}

// Pure calculation helpers
export function calculateAccountBalances(accountId: string): DebtorBalanceSummary {
  const docs = documentsStore.get(accountId) || [];
  let totalDebitsUnits = 0n;
  let totalCreditsUnits = 0n;
  let openDebitsUnits = 0n;
  let unappliedCreditsUnits = 0n;

  for (const doc of docs) {
    const raw = parseMoney(doc.amount);
    const remaining = parseMoney(doc.remainingAmount);

    if (doc.direction === "debit") {
      totalDebitsUnits += raw;
      openDebitsUnits += remaining;
    } else {
      totalCreditsUnits += raw;
      unappliedCreditsUnits += remaining;
    }
  }

  const netUnits = openDebitsUnits - unappliedCreditsUnits;

  return {
    totalDebits: to2Decimals(totalDebitsUnits),
    totalCredits: to2Decimals(totalCreditsUnits),
    unappliedCredit: to2Decimals(unappliedCreditsUnits),
    netBalance: to2Decimals(netUnits),
  };
}

export function calculateAccountExposure(accountId: string): DebtorExposureSummary {
  const account = accountsStore.get(accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  const balances = calculateAccountBalances(accountId);
  const netUnits = parseMoney(balances.netBalance);
  const limitUnits = parseMoney(account.creditLimit);

  const activeResList = reservationsStore.get(accountId) || [];
  let resUnits = 0n;
  for (const r of activeResList) {
    if (r.status === "reserved" || r.status === "submitting" || r.status === "uncertain") {
      resUnits += parseMoney(r.amount);
    }
  }

  const postedDebtUnits = netUnits > 0n ? netUnits : 0n;
  const totalExposureUnits = postedDebtUnits + resUnits;
  const availableUnits = limitUnits - totalExposureUnits;

  const isApproved = account.status === "active" && availableUnits > 0n;

  return {
    postedBalance: to2Decimals(postedDebtUnits),
    activeReservations: to2Decimals(resUnits),
    totalExposure: to2Decimals(totalExposureUnits),
    creditLimit: account.creditLimit,
    availableCredit: to2Decimals(availableUnits > 0n ? availableUnits : 0n),
    approved: isApproved,
  };
}

export function calculateAccountAging(accountId: string, asOfDate: string = "2026-09-28"): DebtorAgingBuckets {
  const docs = documentsStore.get(accountId) || [];
  const buckets: Record<string, bigint> = {
    current: 0n,
    d030: 0n,
    d060: 0n,
    d090: 0n,
    d120: 0n,
    d150: 0n,
    d180: 0n,
    over: 0n,
  };

  let unappliedCreditsUnits = 0n;
  let totalDebitsUnits = 0n;

  for (const doc of docs) {
    const rem = parseMoney(doc.remainingAmount);
    if (rem <= 0n) continue;

    if (doc.direction === "credit") {
      unappliedCreditsUnits += rem;
    } else {
      totalDebitsUnits += rem;
      const bucket = bucketForDueDate(doc.dueOn, asOfDate);
      buckets[bucket] = (buckets[bucket] || 0n) + rem;
    }
  }

  const netUnits = totalDebitsUnits - unappliedCreditsUnits;

  return {
    current: to2Decimals(buckets.current || 0n),
    d030: to2Decimals(buckets.d030 || 0n),
    d060: to2Decimals(buckets.d060 || 0n),
    d090: to2Decimals(buckets.d090 || 0n),
    d120: to2Decimals(buckets.d120 || 0n),
    d150: to2Decimals(buckets.d150 || 0n),
    d180: to2Decimals(buckets.d180 || 0n),
    over: to2Decimals(buckets.over || 0n),
    total: to2Decimals(totalDebitsUnits),
    unappliedCredit: to2Decimals(unappliedCreditsUnits),
    netBalance: to2Decimals(netUnits),
  };
}

// Service queries and mutations
export async function getDebtorsList(search?: string, statusFilter?: string, request?: Request) {
  if (!isDemoMode()) {
    const qs = new URLSearchParams();
      if (search && search.trim()) qs.set("search", search.trim());
      if (statusFilter && statusFilter !== "all") qs.set("status", statusFilter);
      qs.set("limit", "100");

      const data = await apiRequest<{
        items: Array<{
          id: string;
          account_number: string;
          legal_name: string;
          trade_name?: string | null;
          currency: string;
          credit_limit: string;
          status: "active" | "hold" | "closed";
          hold_reason?: string | null;
          aging_basis: "due_date" | "calendar_period";
          policy_version: number;
          ledger_version: number;
          created_at: string;
        }>;
      }>(`/v1/accounts?${qs.toString()}`, { request });

      const detailed = await Promise.all(
        data.items.map(async (acc) => {
          try {
            const detail = await apiRequest<{
              balance: DebtorBalanceSummary;
              credit: DebtorExposureSummary;
              account: {
                terms_type: DebtorAccountData["termsType"];
                terms_days: number;
                shopify_customer_id: string;
                shopify_company_id: string | null;
                contact_email: string;
                contact_phone: string;
              };
            }>(`/v1/accounts/${acc.id}`, { request });
            return {
              id: acc.id,
              accountNumber: acc.account_number,
              name: acc.legal_name,
              shopifyCustomerId: detail.account.shopify_customer_id,
              shopifyCompanyId: detail.account.shopify_company_id,
              currency: acc.currency,
              creditLimit: to2Decimals(parseMoney(acc.credit_limit)),
              status: acc.status,
              termsType: detail.account.terms_type,
              termsDays: detail.account.terms_days,
              agingBasis: acc.aging_basis || ("due_date" as const),
              contactEmail: detail.account.contact_email,
              contactPhone: detail.account.contact_phone,
              policyVersion: acc.policy_version,
              ledgerVersion: acc.ledger_version,
              createdAt: acc.created_at,
              netBalance: detail.balance?.netBalance ? to2Decimals(parseMoney(detail.balance.netBalance)) : "0.00",
              availableCredit: detail.credit?.availableCredit ? to2Decimals(parseMoney(detail.credit.availableCredit)) : to2Decimals(parseMoney(acc.credit_limit)),
              totalExposure: detail.credit?.totalExposure ? to2Decimals(parseMoney(detail.credit.totalExposure)) : "0.00",
            };
          } catch (error) {
            throw new Error(`Unable to load balances for ${acc.account_number}`, { cause: error });
          }
        })
      );
      return detailed;
  }

  let list = Array.from(accountsStore.values());

  if (statusFilter && statusFilter !== "all") {
    list = list.filter((acc) => acc.status === statusFilter);
  }

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter(
      (acc) =>
        acc.name.toLowerCase().includes(q) ||
        acc.accountNumber.toLowerCase().includes(q) ||
        acc.contactEmail.toLowerCase().includes(q)
    );
  }

  return list.map((acc) => {
    const balances = calculateAccountBalances(acc.id);
    const exposure = calculateAccountExposure(acc.id);
    return {
      ...acc,
      netBalance: balances.netBalance,
      availableCredit: exposure.availableCredit,
      totalExposure: exposure.totalExposure,
    };
  });
}

export async function getDebtorDetails(id: string, request?: Request) {
  if (!isDemoMode()) {
    try {
      const apiData = await apiRequest<{
        account: {
          id: string;
          account_number: string;
          legal_name: string;
          terms_type: DebtorAccountData["termsType"];
          terms_days: number;
          shopify_customer_id: string;
          shopify_company_id: string | null;
          contact_email: string;
          contact_phone: string;
          trade_name?: string | null;
          currency: string;
          credit_limit: string;
          status: "active" | "hold" | "closed";
          aging_basis: "due_date" | "calendar_period";
          policy_version: number;
          ledger_version: number;
          created_at: string;
        };
        balance: {
          totalDebit?: string;
          totalCredit?: string;
          totalDebits?: string;
          totalCredits?: string;
          unappliedCredit: string;
          netBalance: string;
          openDebits?: Array<{
            id: string;
            debtorAccountId: string;
            documentNumber: string;
            kind: string;
            direction: "debit" | "credit";
            amount: string;
            currency: string;
            issuedOn: string;
            dueOn: string | null;
            allocatedAmount: string;
            remainingAmount: string;
          }>;
          openCredits?: Array<{
            id: string;
            debtorAccountId: string;
            documentNumber: string;
            kind: string;
            direction: "debit" | "credit";
            amount: string;
            currency: string;
            issuedOn: string;
            dueOn: string | null;
            allocatedAmount: string;
            remainingAmount: string;
          }>;
        };
        credit: {
          postedBalance: string;
          activeReservations: string;
          totalExposure: string;
          creditLimit: string;
          availableCredit: string;
          approved: boolean;
        };
        aging: {
          snapshot?: {
            currentBucket: string;
            d030Bucket: string;
            d060Bucket: string;
            d090Bucket: string;
            d120Bucket: string;
            d150Bucket: string;
            d180Bucket: string;
            overBucket: string;
            totalOpen: string;
            unappliedCredit: string;
            netReceivable: string;
          };
          isFresh: boolean;
        };
        allocations?: Array<{
          id: string;
          debtor_account_id: string;
          debit_document_id: string;
          debit_document_number: string;
          credit_document_id: string;
          credit_document_number: string;
          amount: string;
          created_at: string;
          reversed: boolean;
          reversal_reason?: string;
        }>;
      }>(`/v1/accounts/${id}`, { request });

      const snap = apiData.aging?.snapshot;
      const mappedAccount: DebtorAccountData = {
        id: apiData.account.id,
        accountNumber: apiData.account.account_number,
        name: apiData.account.legal_name,
        shopifyCustomerId: apiData.account.shopify_customer_id,
        shopifyCompanyId: apiData.account.shopify_company_id,
        currency: apiData.account.currency,
        creditLimit: to2Decimals(parseMoney(apiData.account.credit_limit)),
        status: apiData.account.status,
        termsType: apiData.account.terms_type,
        termsDays: apiData.account.terms_days,
        agingBasis: apiData.account.aging_basis || "due_date",
        contactEmail: apiData.account.contact_email,
        contactPhone: apiData.account.contact_phone,
        policyVersion: apiData.account.policy_version,
        ledgerVersion: apiData.account.ledger_version,
        createdAt: apiData.account.created_at,
      };

      const mappedBalances: DebtorBalanceSummary = {
        totalDebits: to2Decimals(parseMoney(apiData.balance?.totalDebit || apiData.balance?.totalDebits || "0")),
        totalCredits: to2Decimals(parseMoney(apiData.balance?.totalCredit || apiData.balance?.totalCredits || "0")),
        unappliedCredit: to2Decimals(parseMoney(apiData.balance?.unappliedCredit || "0")),
        netBalance: to2Decimals(parseMoney(apiData.balance?.netBalance || "0")),
      };

      const mappedExposure: DebtorExposureSummary = {
        postedBalance: to2Decimals(parseMoney(apiData.credit?.postedBalance || "0")),
        activeReservations: to2Decimals(parseMoney(apiData.credit?.activeReservations || "0")),
        totalExposure: to2Decimals(parseMoney(apiData.credit?.totalExposure || "0")),
        creditLimit: to2Decimals(parseMoney(apiData.credit?.creditLimit || apiData.account.credit_limit)),
        availableCredit: to2Decimals(parseMoney(apiData.credit?.availableCredit || "0")),
        approved: apiData.credit?.approved ?? true,
      };

      const mappedAging: DebtorAgingBuckets = {
        current: to2Decimals(parseMoney(snap?.currentBucket || "0")),
        d030: to2Decimals(parseMoney(snap?.d030Bucket || "0")),
        d060: to2Decimals(parseMoney(snap?.d060Bucket || "0")),
        d090: to2Decimals(parseMoney(snap?.d090Bucket || "0")),
        d120: to2Decimals(parseMoney(snap?.d120Bucket || "0")),
        d150: to2Decimals(parseMoney(snap?.d150Bucket || "0")),
        d180: to2Decimals(parseMoney(snap?.d180Bucket || "0")),
        over: to2Decimals(parseMoney(snap?.overBucket || "0")),
        total: to2Decimals(parseMoney(snap?.totalOpen || "0")),
        unappliedCredit: to2Decimals(parseMoney(snap?.unappliedCredit || "0")),
        netBalance: to2Decimals(parseMoney(snap?.netReceivable || "0")),
      };

      const allDocs: DebtorDocumentData[] = [];
      if (apiData.balance?.openDebits) {
        for (const d of apiData.balance.openDebits) {
          allDocs.push({
            id: d.id,
            debtorAccountId: d.debtorAccountId,
            documentNumber: d.documentNumber,
            documentType: (d.kind as any) || "invoice",
            direction: "debit",
            issuedOn: d.issuedOn,
            dueOn: d.dueOn || d.issuedOn,
            amount: to2Decimals(parseMoney(d.amount)),
            allocatedAmount: to2Decimals(parseMoney(d.allocatedAmount)),
            remainingAmount: to2Decimals(parseMoney(d.remainingAmount)),
            currency: d.currency,
          });
        }
      }
      if (apiData.balance?.openCredits) {
        for (const c of apiData.balance.openCredits) {
          allDocs.push({
            id: c.id,
            debtorAccountId: c.debtorAccountId,
            documentNumber: c.documentNumber,
            documentType: (c.kind as any) || "payment",
            direction: "credit",
            issuedOn: c.issuedOn,
            dueOn: c.dueOn || c.issuedOn,
            amount: to2Decimals(parseMoney(c.amount)),
            allocatedAmount: to2Decimals(parseMoney(c.allocatedAmount)),
            remainingAmount: to2Decimals(parseMoney(c.remainingAmount)),
            currency: c.currency,
          });
        }
      }

      const mappedAllocations: DebtorAllocationData[] = (apiData.allocations || []).map((a) => ({
        id: a.id,
        debtorAccountId: a.debtor_account_id,
        debitDocumentId: a.debit_document_id,
        debitDocumentNumber: a.debit_document_number,
        creditDocumentId: a.credit_document_id,
        creditDocumentNumber: a.credit_document_number,
        amount: to2Decimals(parseMoney(a.amount)),
        allocatedAt: a.created_at,
        reversed: Boolean(a.reversed),
        reversalReason: a.reversal_reason,
      }));

      return {
        account: mappedAccount,
        balances: mappedBalances,
        exposure: mappedExposure,
        aging: mappedAging,
        documents: allDocs.length > 0 ? allDocs : (documentsStore.get(id) || []),
        allocations: mappedAllocations.length > 0 ? mappedAllocations : (allocationsStore.get(id) || []),
      };
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes("404")) {
        return null;
      }
      throw error;
    }
  }

  const account = accountsStore.get(id);
  if (!account) return null;

  const balances = calculateAccountBalances(id);
  const exposure = calculateAccountExposure(id);
  const aging = calculateAccountAging(id);
  const docs = documentsStore.get(id) || [];
  const allocs = allocationsStore.get(id) || [];

  return {
    account,
    balances,
    exposure,
    aging,
    documents: docs,
    allocations: allocs,
  };
}

export async function createDebtorAccount(data: {
  accountNumber: string;
  name: string;
  shopifyCustomerId: string;
  shopifyCompanyId?: string | null;
  currency: string;
  creditLimit: string;
  termsType: "net_monthly" | "eom" | "cod";
  termsDays: number;
  agingBasis: "due_date" | "calendar_period";
  contactEmail: string;
  contactPhone: string;
}, request?: Request): Promise<DebtorAccountData> {
  if (!isDemoMode()) {
    const idemKey = `idem-acc-${data.accountNumber}-${Date.now()}`;
    const res = await apiRequest<{
      account: {
        id: string;
        account_number: string;
        legal_name: string;
        currency: string;
        credit_limit: string;
        status: "active" | "hold" | "closed";
        aging_basis: "due_date" | "calendar_period";
        policy_version: number;
        ledger_version: number;
        created_at: string;
      };
    }>("/v1/accounts", {
      method: "POST",
      idempotencyKey: idemKey,
      request,
      body: {
        accountNumber: data.accountNumber.trim().toUpperCase(),
        legalName: data.name.trim(),
        termsType: data.termsType,
        termsDays: data.termsDays,
        shopifyCustomerId: data.shopifyCustomerId.trim(),
        shopifyCompanyId: data.shopifyCompanyId?.trim() || null,
        contactEmail: data.contactEmail.trim(),
        contactPhone: data.contactPhone.trim(),
        currency: data.currency || "ZAR",
        creditLimit: data.creditLimit || "10000.00",
        agingBasis: data.agingBasis || "due_date",
        status: "active",
      },
    });

    const created: DebtorAccountData = {
      id: res.account.id,
      accountNumber: res.account.account_number,
      name: res.account.legal_name,
      shopifyCustomerId: data.shopifyCustomerId.trim(),
      shopifyCompanyId: data.shopifyCompanyId?.trim() || null,
      currency: res.account.currency,
      creditLimit: to2Decimals(parseMoney(res.account.credit_limit)),
      status: res.account.status,
      termsType: data.termsType || "net_monthly",
      termsDays: Number(data.termsDays) || 30,
      agingBasis: res.account.aging_basis || "due_date",
      contactEmail: data.contactEmail?.trim() || "",
      contactPhone: data.contactPhone?.trim() || "",
      policyVersion: res.account.policy_version,
      ledgerVersion: res.account.ledger_version,
      createdAt: res.account.created_at,
    };
    accountsStore.set(created.id, created);
    documentsStore.set(created.id, []);
    allocationsStore.set(created.id, []);
    return created;
  }

  const id = `acc-${Date.now().toString(36)}`;
  const newAccount: DebtorAccountData = {
    id,
    accountNumber: data.accountNumber.trim().toUpperCase(),
    name: data.name.trim(),
    shopifyCustomerId: data.shopifyCustomerId.trim(),
    shopifyCompanyId: data.shopifyCompanyId?.trim() || null,
    currency: data.currency || "ZAR",
    creditLimit: data.creditLimit || "10000.00",
    status: "active",
    termsType: data.termsType || "net_monthly",
    termsDays: Number(data.termsDays) || 30,
    agingBasis: data.agingBasis || "due_date",
    contactEmail: data.contactEmail?.trim() || "",
    contactPhone: data.contactPhone?.trim() || "",
    policyVersion: 1,
    ledgerVersion: 1,
    createdAt: new Date().toISOString(),
  };

  accountsStore.set(id, newAccount);
  documentsStore.set(id, []);
  allocationsStore.set(id, []);
  return newAccount;
}

export async function updateDebtorPolicy(
  id: string,
  updates: {
    creditLimit?: string;
    status?: "active" | "hold" | "closed";
    termsType?: "net_monthly" | "eom" | "cod";
    termsDays?: number;
    expectedPolicyVersion: number;
    reason: string;
  },
  request?: Request
) {
  if (!isDemoMode()) {
    const idemKey = `idem-pol-${id}-${updates.expectedPolicyVersion}-${Date.now()}`;
    const res = await apiRequest<{
      account: {
        id: string;
        account_number: string;
        legal_name: string;
        credit_limit: string;
        status: "active" | "hold" | "closed";
        policy_version: number;
        ledger_version: number;
      };
    }>(`/v1/accounts/${id}/policy`, {
      method: "PATCH",
      idempotencyKey: idemKey,
      request,
      body: {
        reason: updates.reason,
        expectedPolicyVersion: updates.expectedPolicyVersion,
        termsType: updates.termsType,
        termsDays: updates.termsDays,
        creditLimit: updates.creditLimit,
        status: updates.status,
      },
    });

    const existing = accountsStore.get(id);
    const updated: DebtorAccountData = existing
      ? {
          ...existing,
          creditLimit: to2Decimals(parseMoney(res.account.credit_limit)),
          status: res.account.status,
          policyVersion: res.account.policy_version,
          ledgerVersion: res.account.ledger_version,
          termsType: updates.termsType || existing.termsType,
          termsDays: updates.termsDays || existing.termsDays,
        }
      : {
          id: res.account.id,
          accountNumber: res.account.account_number,
          name: res.account.legal_name,
          shopifyCustomerId: "",
          currency: "ZAR",
          creditLimit: to2Decimals(parseMoney(res.account.credit_limit)),
          status: res.account.status,
          termsType: updates.termsType || "net_monthly",
          termsDays: updates.termsDays || 30,
          agingBasis: "due_date",
          contactEmail: "",
          contactPhone: "",
          policyVersion: res.account.policy_version,
          ledgerVersion: res.account.ledger_version,
          createdAt: new Date().toISOString(),
        };

    accountsStore.set(id, updated);
    return updated;
  }

  const account = accountsStore.get(id);
  if (!account) {
    throw new Error("Account not found");
  }

  if (account.policyVersion !== updates.expectedPolicyVersion) {
    throw new Error(`Policy concurrency conflict: expected v${updates.expectedPolicyVersion}, currently at v${account.policyVersion}`);
  }

  if (!updates.reason || !updates.reason.trim()) {
    throw new Error("A valid reason is required for policy adjustments");
  }

  if (updates.creditLimit !== undefined) {
    account.creditLimit = updates.creditLimit;
  }
  if (updates.status !== undefined) {
    account.status = updates.status;
  }
  if (updates.termsType !== undefined) {
    account.termsType = updates.termsType;
  }
  if (updates.termsDays !== undefined) {
    account.termsDays = Number(updates.termsDays);
  }

  account.policyVersion += 1;
  accountsStore.set(id, { ...account });

  return account;
}

export async function recordPaymentAndAllocate(
  params: {
    debtorAccountId: string;
    receiptAmount: string;
    currency: string;
    paymentMode: "external_receipt" | "shopify_manual" | "shopify_pos_cash";
    reference: string;
    mode: "oldest_first" | "explicit";
    explicitAllocations?: { invoiceId: string; amount: string }[];
    idempotencyKey?: string;
  },
  request?: Request
): Promise<{
  allocatedTotal: string;
  unallocatedRemainder: string;
  newAllocationsCount: number;
  ledgerVersion: number;
  storageMode: "durable_api" | "demo_memory";
}> {
  // If durable API is available, dispatch mutations directly to API
  if (!isDemoMode()) {
    const paymentIdemKey =
      params.idempotencyKey ||
      `idem-pay-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const payResult = await apiRequest<any>("/v1/payments", {
      method: "POST",
      idempotencyKey: paymentIdemKey,
      request,
      body: {
        debtorAccountId: params.debtorAccountId,
        amount: params.receiptAmount,
        currency: params.currency,
        paymentMethod:
          params.paymentMode === "shopify_pos_cash" ? "cash" : "bank_transfer",
        effectiveDate: new Date().toISOString().split("T")[0],
        reference: params.reference,
        paymentMode: params.paymentMode,
        memo: `Shopify receipt ref ${params.reference}`,
        autoAllocate: params.mode === "oldest_first",
      },
    });

    const paymentDocId = payResult.paymentDocumentId || payResult.documentId;

    // If explicit mode and invoices specified, send explicit allocations
    if (params.mode === "explicit" && params.explicitAllocations?.length && paymentDocId) {
      for (const alloc of params.explicitAllocations) {
        const allocIdemKey = `${paymentIdemKey}-alloc-${alloc.invoiceId}`;
        await apiRequest("/v1/allocations", {
          method: "POST",
          idempotencyKey: allocIdemKey,
          request,
          body: {
            debtorAccountId: params.debtorAccountId,
            mode: "explicit",
            debitDocumentId: alloc.invoiceId,
            creditDocumentId: paymentDocId,
            amount: alloc.amount,
            effectiveDate: new Date().toISOString().split("T")[0],
          },
        });
      }
    }

    const allocatedUnits = params.mode === "explicit"
      ? (params.explicitAllocations ?? []).reduce((sum, item) => sum + parseMoney(item.amount), 0n)
      : (payResult.allocations ?? []).reduce((sum: bigint, item: { amount: string }) => sum + parseMoney(item.amount), 0n);
    return {
      allocatedTotal: to2Decimals(allocatedUnits),
      unallocatedRemainder: to2Decimals(parseMoney(params.receiptAmount) - allocatedUnits),
      newAllocationsCount: payResult.allocations?.length || (params.explicitAllocations?.length ?? 1),
      ledgerVersion: payResult.ledgerVersion || 1,
      storageMode: "durable_api",
    };
  }

  // Operating in in-memory demo preview simulation mode
  const account = accountsStore.get(params.debtorAccountId);
  if (!account) throw new Error("Account not found");

  const receiptUnits = parseMoney(params.receiptAmount);
  if (receiptUnits <= 0n) throw new Error("Receipt amount must be greater than zero");

  const docs = documentsStore.get(params.debtorAccountId) || [];
  const openInvoices = docs.filter((d) => d.direction === "debit" && parseMoney(d.remainingAmount) > 0n);

  let allocatedTotalUnits = 0n;
  const newAllocs: DebtorAllocationData[] = [];
  const paymentDocId = `pay-${Date.now()}`;
  const paymentDocNum = `RCT-${params.reference.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "PAY"}`;

  if (params.mode === "oldest_first") {
    // Sort oldest first by dueOn, then issuedOn
    openInvoices.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.issuedOn.localeCompare(b.issuedOn));
    let remainingReceipt = receiptUnits;

    for (const inv of openInvoices) {
      if (remainingReceipt <= 0n) break;
      const invRem = parseMoney(inv.remainingAmount);
      const applyUnits = remainingReceipt >= invRem ? invRem : remainingReceipt;

      inv.allocatedAmount = to2Decimals(parseMoney(inv.allocatedAmount) + applyUnits);
      inv.remainingAmount = to2Decimals(invRem - applyUnits);
      remainingReceipt -= applyUnits;
      allocatedTotalUnits += applyUnits;

      newAllocs.push({
        id: `alloc-${Date.now()}-${inv.id}`,
        debtorAccountId: params.debtorAccountId,
        debitDocumentId: inv.id,
        debitDocumentNumber: inv.documentNumber,
        creditDocumentId: paymentDocId,
        creditDocumentNumber: paymentDocNum,
        amount: to2Decimals(applyUnits),
        allocatedAt: new Date().toISOString(),
        reversed: false,
      });
    }
  } else if (params.mode === "explicit" && params.explicitAllocations) {
    for (const item of params.explicitAllocations) {
      const applyUnits = parseMoney(item.amount);
      if (applyUnits <= 0n) continue;

      const inv = openInvoices.find((i) => i.id === item.invoiceId);
      if (!inv) throw new Error(`Invoice ${item.invoiceId} not found or already closed`);

      const invRem = parseMoney(inv.remainingAmount);
      if (applyUnits > invRem) {
        throw new Error(`Allocation of ${item.amount} exceeds invoice ${inv.documentNumber} remaining balance of ${inv.remainingAmount}`);
      }

      if (allocatedTotalUnits + applyUnits > receiptUnits) {
        throw new Error(`Total allocations exceed receipt amount of ${params.receiptAmount}`);
      }

      inv.allocatedAmount = to2Decimals(parseMoney(inv.allocatedAmount) + applyUnits);
      inv.remainingAmount = to2Decimals(invRem - applyUnits);
      allocatedTotalUnits += applyUnits;

      newAllocs.push({
        id: `alloc-${Date.now()}-${inv.id}`,
        debtorAccountId: params.debtorAccountId,
        debitDocumentId: inv.id,
        debitDocumentNumber: inv.documentNumber,
        creditDocumentId: paymentDocId,
        creditDocumentNumber: paymentDocNum,
        amount: to2Decimals(applyUnits),
        allocatedAt: new Date().toISOString(),
        reversed: false,
      });
    }
  }

  const remainderUnits = receiptUnits - allocatedTotalUnits;

  // Add payment document to debtor records
  docs.push({
    id: paymentDocId,
    debtorAccountId: params.debtorAccountId,
    documentNumber: paymentDocNum,
    documentType: "payment",
    direction: "credit",
    issuedOn: new Date().toISOString().split("T")[0]!,
    dueOn: new Date().toISOString().split("T")[0]!,
    amount: params.receiptAmount,
    allocatedAmount: to2Decimals(allocatedTotalUnits),
    remainingAmount: to2Decimals(remainderUnits),
    currency: params.currency,
  });

  const existingAllocs = allocationsStore.get(params.debtorAccountId) || [];
  allocationsStore.set(params.debtorAccountId, [...newAllocs, ...existingAllocs]);
  account.ledgerVersion += 1;

  return {
    allocatedTotal: to2Decimals(allocatedTotalUnits),
    unallocatedRemainder: to2Decimals(remainderUnits),
    newAllocationsCount: newAllocs.length,
    ledgerVersion: account.ledgerVersion,
    storageMode: "demo_memory",
  };
}

export async function reverseAllocation(
  params: {
    debtorAccountId: string;
    allocationId: string;
    reason: string;
    idempotencyKey?: string;
  },
  request?: Request
): Promise<{
  success: boolean;
  reversedAllocationId: string;
  restoredAmount: string;
  ledgerVersion: number;
  storageMode: "durable_api" | "demo_memory";
}> {
  if (!isDemoMode()) {
    const revIdemKey =
      params.idempotencyKey ||
      `idem-rev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const revResult = await apiRequest<any>(
      `/v1/allocations/${params.allocationId}/reverse`,
      {
        method: "POST",
        idempotencyKey: revIdemKey,
        request,
        body: {
          reason: params.reason,
          effectiveDate: new Date().toISOString().split("T")[0],
        },
      }
    );

    return {
      success: true,
      reversedAllocationId: params.allocationId,
      restoredAmount: revResult.restoredAmount || "0.00",
      ledgerVersion: revResult.ledgerVersion || 1,
      storageMode: "durable_api",
    };
  }

  const account = accountsStore.get(params.debtorAccountId);
  if (!account) throw new Error("Account not found");

  const allocs = allocationsStore.get(params.debtorAccountId) || [];
  const alloc = allocs.find((a) => a.id === params.allocationId);
  if (!alloc) throw new Error("Allocation not found");

  if (alloc.reversed) {
    throw new Error("Allocation has already been reversed");
  }

  const docs = documentsStore.get(params.debtorAccountId) || [];
  const debitDoc = docs.find((d) => d.id === alloc.debitDocumentId);
  const creditDoc = docs.find((d) => d.id === alloc.creditDocumentId);

  const amountUnits = parseMoney(alloc.amount);

  if (debitDoc) {
    debitDoc.allocatedAmount = to2Decimals(parseMoney(debitDoc.allocatedAmount) - amountUnits);
    debitDoc.remainingAmount = to2Decimals(parseMoney(debitDoc.remainingAmount) + amountUnits);
  }

  if (creditDoc) {
    creditDoc.allocatedAmount = to2Decimals(parseMoney(creditDoc.allocatedAmount) - amountUnits);
    creditDoc.remainingAmount = to2Decimals(parseMoney(creditDoc.remainingAmount) + amountUnits);
  }

  alloc.reversed = true;
  alloc.reversalReason = params.reason;
  account.ledgerVersion += 1;

  return {
    success: true,
    reversedAllocationId: alloc.id,
    restoredAmount: alloc.amount,
    ledgerVersion: account.ledgerVersion,
    storageMode: "demo_memory",
  };
}

export async function getOnboardingState(request?: Request): Promise<OnboardingState> {
  if (!isDemoMode()) {
    const saved = await apiRequest<Partial<OnboardingState>>("/v1/onboarding", { request });
    return { ...onboardingState, isCompleted: false, step: 1, ...saved };
  }
  return { ...onboardingState };
}

export async function updateOnboardingState(updates: Partial<OnboardingState>, request?: Request): Promise<OnboardingState> {
  const definedUpdates = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));
  if (!isDemoMode()) {
    const saved = await apiRequest<Partial<OnboardingState>>("/v1/onboarding", { method: "PATCH", body: definedUpdates, request });
    return { ...onboardingState, isCompleted: false, step: 1, ...saved };
  }
  onboardingState = {
    ...onboardingState,
    ...definedUpdates,
    requiresGenesisServer: false, // Invariant: pure Shopify native
  };
  return { ...onboardingState };
}

export interface StatementRecord {
  id: string;
  statementRunId: string;
  debtorAccountId: string;
  accountNumber: string;
  legalName: string;
  openingBalance: string;
  debits: string;
  credits: string;
  closingBalance: string;
  currency: string;
  ledgerVersion: number;
  status: string;
  pdfObjectKey: string;
  pdfSha256: string;
  downloadUrl: string;
  createdAt: string;
}

export interface StatementRunRecord {
  statementRunId: string;
  statementId: string;
  debtorAccountId: string;
  periodFrom: string;
  periodTo: string;
  generation: number;
  status: string;
  statementsCount: number;
  totalDebits: string;
  totalCredits: string;
  netClosingBalance: string;
}

export interface StatementDeliveryRecord {
  id: string;
  statementId: string;
  channel: string;
  recipientSecretRef: string;
  idempotencyKey: string;
  providerMessageId: string | null;
  status: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  createdAt: string;
}

export async function getStatement(statementId: string, request?: Request): Promise<StatementRecord> {
  if (!isDemoMode()) {
    const res = await apiRequest<{ data: StatementRecord } | StatementRecord>(
      `/v1/statements/${statementId}`,
      { request },
    );
    return "data" in res ? res.data : res;
  }
  return {
    id: statementId,
    statementRunId: "run-demo-001",
    debtorAccountId: "acc-demo-001",
    accountNumber: "ACC-001",
    legalName: "Ubuntu Hardware Trade",
    openingBalance: "3500.00",
    debits: "4500.00",
    credits: "0.00",
    closingBalance: "8000.00",
    currency: "ZAR",
    ledgerVersion: 1,
    status: "ready",
    pdfObjectKey: "statements/demo/ACC-001.pdf",
    pdfSha256: "demo-sha256-hash",
    downloadUrl: `/v1/statements/download?key=statements/demo/ACC-001.pdf&sig=demo`,
    createdAt: new Date().toISOString(),
  };
}

export async function buildStatementRun(
  params: { debtorAccountId: string; periodFrom: string; periodTo: string },
  idempotencyKey: string,
  request?: Request,
): Promise<StatementRunRecord> {
  if (isDemoMode()) {
    throw new Error("Statement runs require the durable Trade API; preview mode cannot build persisted statements.");
  }

  return await apiRequest<StatementRunRecord>("/v1/statements/run", {
    method: "POST",
    idempotencyKey,
    request,
    body: params,
  });
}

export async function deliverStatement(
  statementId: string,
  params: { recipientEmail: string; idempotencyKey: string },
  request?: Request,
): Promise<StatementDeliveryRecord> {
  if (!isDemoMode()) {
    return await apiRequest<StatementDeliveryRecord>(`/v1/statements/${statementId}/deliver`, {
      method: "POST",
      idempotencyKey: params.idempotencyKey,
      body: {
        recipientEmail: params.recipientEmail,
        channel: "email",
        immediate: true,
      },
      request,
    });
  }
  return {
    id: `del-demo-${Date.now()}`,
    statementId,
    channel: "email",
    recipientSecretRef: `${params.recipientEmail.charAt(0)}***@demo#hash`,
    idempotencyKey: params.idempotencyKey,
    providerMessageId: `msg_demo_${Date.now()}`,
    status: "accepted",
    attemptCount: 1,
    lastAttemptAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

export async function getStatementDeliveries(
  statementId: string,
  request?: Request,
): Promise<StatementDeliveryRecord[]> {
  if (!isDemoMode()) {
    const res = await apiRequest<{ deliveries: StatementDeliveryRecord[] }>(
      `/v1/statements/${statementId}/deliveries`,
      { request },
    );
    return res.deliveries;
  }
  return [];
}

