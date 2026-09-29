import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  filterDocumentsForStatement,
  calculateStatementTotals,
  calculateStatementAging,
  buildStatementData,
  computeStatementSha256,
  type StatementDocumentItem,
  type StatementMerchantInfo,
  type StatementCustomerInfo,
} from "../../packages/domain/src/statements.ts";
import { renderStatementHtml, DEFAULT_MERCHANT_INFO } from "../../apps/worker/src/statements.ts";
import { formatMoney, parseMoney } from "../../packages/domain/src/money.ts";

const sampleMerchant: StatementMerchantInfo = {
  businessName: "Genesis Wholesale Ltd",
  tradingAddress: "42 Industrial Way, Cape Town, 8001, South Africa",
  taxNumber: "ZA4001122334",
  contactEmail: "accounts@genesiswholesale.co.za",
  contactPhone: "+27 21 555 1234",
  bankDetails: {
    bankName: "Standard Bank",
    accountNumber: "071234567",
    branchCode: "051001",
    accountType: "Business Current",
    reference: "ACCOUNT_NUMBER",
  },
};

const sampleCustomer: StatementCustomerInfo = {
  debtorAccountId: "11111111-1111-4111-8111-111111111111",
  accountNumber: "DEBT-001",
  name: "Apex Engineering Works",
  shopifyCustomerId: "gid://shopify/Customer/12345678",
  contactEmail: "accounts@apexeng.co.za",
  contactPhone: "+27 11 999 8888",
  billingAddress: "15 Factory Road, Epping, Cape Town, 7460",
};

test("TASK-018: filterDocumentsForStatement respects period and cutoff immutability", () => {
  const cutoff = "2026-08-31T23:59:59.000Z";
  const periodFrom = "2026-08-01";
  const periodTo = "2026-08-31";

  const docs: StatementDocumentItem[] = [
    // Pre-period document (opening balance)
    {
      id: "doc-1",
      documentNumber: "INV-001",
      documentType: "invoice",
      direction: "debit",
      issuedOn: "2026-07-15",
      dueOn: "2026-08-15",
      recordedAt: "2026-07-15T10:00:00.000Z",
      amount: "1000.0000",
      allocatedAmount: "0.0000",
      openAmount: "1000.0000",
      currency: "ZAR",
    },
    // In-period document
    {
      id: "doc-2",
      documentNumber: "INV-002",
      documentType: "invoice",
      direction: "debit",
      issuedOn: "2026-08-10",
      dueOn: "2026-09-10",
      recordedAt: "2026-08-10T11:00:00.000Z",
      amount: "2500.0000",
      allocatedAmount: "0.0000",
      openAmount: "2500.0000",
      currency: "ZAR",
    },
    // In-period payment
    {
      id: "doc-3",
      documentNumber: "RCT-001",
      documentType: "payment",
      direction: "credit",
      issuedOn: "2026-08-20",
      dueOn: "2026-08-20",
      recordedAt: "2026-08-20T14:30:00.000Z",
      amount: "1000.0000",
      allocatedAmount: "1000.0000",
      openAmount: "0.0000",
      currency: "ZAR",
    },
    // Late backdated document (issued in August, but recorded after August cutoff)
    {
      id: "doc-4",
      documentNumber: "INV-LATE",
      documentType: "invoice",
      direction: "debit",
      issuedOn: "2026-08-25",
      dueOn: "2026-09-25",
      recordedAt: "2026-09-05T09:00:00.000Z", // Recorded in September
      amount: "999.0000",
      allocatedAmount: "0.0000",
      openAmount: "999.0000",
      currency: "ZAR",
    },
    // Post-period document
    {
      id: "doc-5",
      documentNumber: "INV-003",
      documentType: "invoice",
      direction: "debit",
      issuedOn: "2026-09-02",
      dueOn: "2026-10-02",
      recordedAt: "2026-09-02T08:00:00.000Z",
      amount: "300.0000",
      allocatedAmount: "0.0000",
      openAmount: "300.0000",
      currency: "ZAR",
    },
  ];

  const { openingItems, periodItems } = filterDocumentsForStatement(docs, periodFrom, periodTo, cutoff);

  assert.equal(openingItems.length, 1);
  assert.equal(openingItems[0]!.documentNumber, "INV-001");

  assert.equal(periodItems.length, 2);
  assert.equal(periodItems[0]!.documentNumber, "INV-002");
  assert.equal(periodItems[1]!.documentNumber, "RCT-001");

  // Crucial invariant: doc-4 was recorded after cutoff, so it MUST NOT appear in August statement!
  const hasLate = periodItems.some((d) => d.documentNumber === "INV-LATE");
  assert.equal(hasLate, false, "Late backdated posting must be excluded from historical statement cutoff");
});

test("TASK-018: calculateStatementTotals verifies closing = opening + debits - credits", () => {
  const openingItems: StatementDocumentItem[] = [
    {
      id: "d1",
      documentNumber: "INV-PRE-1",
      documentType: "invoice",
      direction: "debit",
      issuedOn: "2026-07-01",
      dueOn: "2026-07-31",
      recordedAt: "2026-07-01T10:00:00Z",
      amount: "5000.0000",
      allocatedAmount: "0.0000",
      openAmount: "5000.0000",
      currency: "ZAR",
    },
    {
      id: "d2",
      documentNumber: "PMT-PRE-1",
      documentType: "payment",
      direction: "credit",
      issuedOn: "2026-07-15",
      dueOn: "2026-07-15",
      recordedAt: "2026-07-15T10:00:00Z",
      amount: "2000.0000",
      allocatedAmount: "2000.0000",
      openAmount: "0.0000",
      currency: "ZAR",
    },
  ];

  const periodItems: StatementDocumentItem[] = [
    {
      id: "d3",
      documentNumber: "INV-AUG-1",
      documentType: "invoice",
      direction: "debit",
      issuedOn: "2026-08-05",
      dueOn: "2026-09-05",
      recordedAt: "2026-08-05T10:00:00Z",
      amount: "1500.0000",
      allocatedAmount: "0.0000",
      openAmount: "1500.0000",
      currency: "ZAR",
    },
    {
      id: "d4",
      documentNumber: "CRN-AUG-1",
      documentType: "credit_note",
      direction: "credit",
      issuedOn: "2026-08-12",
      dueOn: "2026-08-12",
      recordedAt: "2026-08-12T10:00:00Z",
      amount: "300.0000",
      allocatedAmount: "0.0000",
      openAmount: "300.0000",
      currency: "ZAR",
    },
  ];

  const totals = calculateStatementTotals(openingItems, periodItems, "ZAR");

  assert.equal(totals.openingBalance, "3000.0000"); // 5000 - 2000
  assert.equal(totals.totalDebits, "1500.0000");
  assert.equal(totals.totalCredits, "300.0000");
  assert.equal(totals.closingBalance, "4200.0000"); // 3000 + 1500 - 300 = 4200

  const op = parseMoney(totals.openingBalance);
  const deb = parseMoney(totals.totalDebits);
  const cred = parseMoney(totals.totalCredits);
  const close = parseMoney(totals.closingBalance);
  assert.equal(close, op + deb - cred);
});

test("TASK-018: calculateStatementAging distributes open amounts across 8 buckets", () => {
  const asOf = "2026-08-31";
  const openDocs: StatementDocumentItem[] = [
    // Current: due after asOf
    {
      id: "d1",
      documentNumber: "INV-CURR",
      documentType: "invoice",
      direction: "debit",
      issuedOn: "2026-08-15",
      dueOn: "2026-09-15", // +15 days
      recordedAt: "2026-08-15T00:00:00Z",
      amount: "100.0000",
      allocatedAmount: "0.0000",
      openAmount: "100.0000",
      currency: "ZAR",
    },
    // 1-30 days overdue
    {
      id: "d2",
      documentNumber: "INV-30",
      documentType: "invoice",
      direction: "debit",
      issuedOn: "2026-07-20",
      dueOn: "2026-08-20", // 11 days overdue
      recordedAt: "2026-07-20T00:00:00Z",
      amount: "200.0000",
      allocatedAmount: "0.0000",
      openAmount: "200.0000",
      currency: "ZAR",
    },
    // 31-60 days overdue
    {
      id: "d3",
      documentNumber: "INV-60",
      documentType: "invoice",
      direction: "debit",
      issuedOn: "2026-06-15",
      dueOn: "2026-07-15", // 47 days overdue
      recordedAt: "2026-06-15T00:00:00Z",
      amount: "300.0000",
      allocatedAmount: "0.0000",
      openAmount: "300.0000",
      currency: "ZAR",
    },
    // Over 180 days overdue
    {
      id: "d4",
      documentNumber: "INV-OLD",
      documentType: "invoice",
      direction: "debit",
      issuedOn: "2025-12-01",
      dueOn: "2025-12-31", // >240 days overdue
      recordedAt: "2025-12-01T00:00:00Z",
      amount: "500.0000",
      allocatedAmount: "0.0000",
      openAmount: "500.0000",
      currency: "ZAR",
    },
    // Unapplied credit note
    {
      id: "d5",
      documentNumber: "CRN-UNAPP",
      documentType: "credit_note",
      direction: "credit",
      issuedOn: "2026-08-28",
      dueOn: "2026-08-28",
      recordedAt: "2026-08-28T00:00:00Z",
      amount: "150.0000",
      allocatedAmount: "0.0000",
      openAmount: "150.0000",
      currency: "ZAR",
    },
  ];

  const aging = calculateStatementAging(openDocs, asOf);

  assert.equal(aging.current, "100.0000");
  assert.equal(aging.d030, "200.0000");
  assert.equal(aging.d060, "300.0000");
  assert.equal(aging.d090, "0.0000");
  assert.equal(aging.d120, "0.0000");
  assert.equal(aging.d150, "0.0000");
  assert.equal(aging.d180, "0.0000");
  assert.equal(aging.over, "500.0000");
  assert.equal(aging.total, "1100.0000"); // 100 + 200 + 300 + 500
  assert.equal(aging.unappliedCredit, "150.0000");
  assert.equal(aging.netBalance, "950.0000"); // 1100 - 150
});

test("TASK-018: 1-line, 10-line, and 200-line statement rendering and deterministic SHA-256", () => {
  const artifactsDir = path.resolve(process.cwd(), "artifacts/statements");
  fs.mkdirSync(artifactsDir, { recursive: true });

  // 1. Single-line statement
  const data1Line = buildStatementData({
    statementId: "stmt-0001-single-line",
    statementRunId: "run-0001",
    periodFrom: "2026-08-01",
    periodTo: "2026-08-31",
    cutoffRecordedAt: "2026-08-31T23:59:59.000Z",
    generation: 1,
    merchant: sampleMerchant,
    customer: sampleCustomer,
    allDocuments: [
      {
        id: "doc-1",
        documentNumber: "INV-00101",
        documentType: "invoice",
        direction: "debit",
        issuedOn: "2026-08-15",
        dueOn: "2026-09-15",
        recordedAt: "2026-08-15T10:00:00.000Z",
        amount: "1250.5000",
        allocatedAmount: "0.0000",
        openAmount: "1250.5000",
        currency: "ZAR",
      },
    ],
    openDocumentsAtCutoff: [
      {
        id: "doc-1",
        documentNumber: "INV-00101",
        documentType: "invoice",
        direction: "debit",
        issuedOn: "2026-08-15",
        dueOn: "2026-09-15",
        recordedAt: "2026-08-15T10:00:00.000Z",
        amount: "1250.5000",
        allocatedAmount: "0.0000",
        openAmount: "1250.5000",
        currency: "ZAR",
      },
    ],
    ledgerVersion: 1,
    policyVersion: 1,
    currency: "ZAR",
  });

  const { html: html1, sha256: sha1 } = renderStatementHtml(data1Line);
  fs.writeFileSync(path.join(artifactsDir, "statement-1-line.html"), html1, "utf8");

  assert.ok(html1.includes("INV-00101"));
  assert.ok(html1.includes("1250.5000"));
  assert.ok(html1.includes(sha1));
  assert.ok(html1.includes(sampleMerchant.bankDetails.bankName));
  assert.ok(html1.includes("Remittance Advice"));

  // 2. 10-line statement
  const tenDocs: StatementDocumentItem[] = [];
  for (let i = 1; i <= 10; i++) {
    const isCredit = i % 4 === 0;
    tenDocs.push({
      id: `doc-10-${i}`,
      documentNumber: isCredit ? `RCT-00${i}` : `INV-00${i}`,
      documentType: isCredit ? "payment" : "invoice",
      direction: isCredit ? "credit" : "debit",
      issuedOn: `2026-08-${String(i * 2).padStart(2, "0")}`,
      dueOn: `2026-09-${String(i * 2).padStart(2, "0")}`,
      recordedAt: `2026-08-${String(i * 2).padStart(2, "0")}T10:00:00.000Z`,
      amount: `${i * 100}.0000`,
      allocatedAmount: "0.0000",
      openAmount: `${i * 100}.0000`,
      currency: "ZAR",
    });
  }

  const data10Line = buildStatementData({
    statementId: "stmt-0002-ten-line",
    statementRunId: "run-0001",
    periodFrom: "2026-08-01",
    periodTo: "2026-08-31",
    cutoffRecordedAt: "2026-08-31T23:59:59.000Z",
    generation: 1,
    merchant: sampleMerchant,
    customer: sampleCustomer,
    allDocuments: tenDocs,
    openDocumentsAtCutoff: tenDocs,
    ledgerVersion: 5,
    policyVersion: 2,
    currency: "ZAR",
  });

  const { html: html10, sha256: sha10 } = renderStatementHtml(data10Line);
  fs.writeFileSync(path.join(artifactsDir, "statement-10-line.html"), html10, "utf8");

  assert.equal(data10Line.items.length, 10);
  assert.ok(html10.includes("INV-001"));
  assert.ok(html10.includes("RCT-004"));
  assert.ok(html10.includes(sha10));

  // 3. 200-line statement
  const twoHundredDocs: StatementDocumentItem[] = [];
  for (let i = 1; i <= 200; i++) {
    const isCredit = i % 5 === 0;
    const day = (i % 28) + 1;
    twoHundredDocs.push({
      id: `doc-200-${i}`,
      documentNumber: isCredit ? `RCT-200-${i}` : `INV-200-${i}`,
      documentType: isCredit ? "payment" : "invoice",
      direction: isCredit ? "credit" : "debit",
      issuedOn: `2026-08-${String(day).padStart(2, "0")}`,
      dueOn: `2026-09-${String(day).padStart(2, "0")}`,
      recordedAt: `2026-08-${String(day).padStart(2, "0")}T10:00:00.000Z`,
      amount: "50.0000",
      allocatedAmount: "0.0000",
      openAmount: "50.0000",
      currency: "ZAR",
    });
  }

  const data200Line = buildStatementData({
    statementId: "stmt-0003-two-hundred-line",
    statementRunId: "run-0001",
    periodFrom: "2026-08-01",
    periodTo: "2026-08-31",
    cutoffRecordedAt: "2026-08-31T23:59:59.000Z",
    generation: 1,
    merchant: sampleMerchant,
    customer: sampleCustomer,
    allDocuments: twoHundredDocs,
    openDocumentsAtCutoff: twoHundredDocs,
    ledgerVersion: 10,
    policyVersion: 2,
    currency: "ZAR",
  });

  const { html: html200, sha256: sha200 } = renderStatementHtml(data200Line);
  fs.writeFileSync(path.join(artifactsDir, "statement-200-line.html"), html200, "utf8");

  assert.equal(data200Line.items.length, 200);
  assert.ok(html200.includes("INV-200-1"));
  assert.ok(html200.includes("RCT-200-200"));
  assert.ok(html200.includes(sha200));

  // Verify deterministic SHA-256 reproducibility:
  // Rebuilding identical data must produce the exact same SHA-256 hash byte for byte.
  const data200LineRepro = buildStatementData({
    statementId: "stmt-0003-two-hundred-line",
    statementRunId: "run-0001",
    periodFrom: "2026-08-01",
    periodTo: "2026-08-31",
    cutoffRecordedAt: "2026-08-31T23:59:59.000Z",
    generation: 1,
    merchant: sampleMerchant,
    customer: sampleCustomer,
    allDocuments: twoHundredDocs,
    openDocumentsAtCutoff: twoHundredDocs,
    ledgerVersion: 10,
    policyVersion: 2,
    currency: "ZAR",
  });
  const { sha256: sha200Repro } = renderStatementHtml(data200LineRepro);
  assert.equal(sha200, sha200Repro, "SHA-256 hash must be 100% deterministic and reproducible");
});

test("TASK-018: escapeHtml sanitizes dangerous user and merchant inputs", () => {
  const maliciousCustomer: StatementCustomerInfo = {
    ...sampleCustomer,
    name: 'Mega Corp <script>alert("hack")</script>',
    contactEmail: 'attacker@corp.com" onfocus="alert(1)',
    billingAddress: "123 Elm St & Co. <b>Building 4</b>",
  };

  const maliciousData = buildStatementData({
    statementId: "stmt-xss-test",
    statementRunId: "run-0001",
    periodFrom: "2026-08-01",
    periodTo: "2026-08-31",
    cutoffRecordedAt: "2026-08-31T23:59:59.000Z",
    generation: 1,
    merchant: sampleMerchant,
    customer: maliciousCustomer,
    allDocuments: [],
    openDocumentsAtCutoff: [],
    ledgerVersion: 1,
    policyVersion: 1,
    currency: "ZAR",
  });

  const { html } = renderStatementHtml(maliciousData);

  assert.ok(!html.includes("<script>alert("), "Raw unescaped script tag must not exist in HTML");
  assert.ok(html.includes("&lt;script&gt;alert(&quot;hack&quot;)&lt;/script&gt;"), "Script tag must be safely HTML escaped");
  assert.ok(html.includes("&amp; Co."), "Ampersand must be escaped");
  assert.ok(html.includes("&lt;b&gt;Building 4&lt;/b&gt;"), "Tags in address must be escaped");
});

test("TASK-018: generateStatementPdf creates verified PDF 1.4 binary artifacts with exact SHA-256", async () => {
  const { generateStatementPdf } = await import("../../apps/worker/src/pdf.ts");
  const artifactsDir = path.resolve(process.cwd(), "artifacts/statements");
  fs.mkdirSync(artifactsDir, { recursive: true });

  const data = buildStatementData({
    statementId: "stmt-pdf-verify-01",
    statementRunId: "run-0001",
    periodFrom: "2026-08-01",
    periodTo: "2026-08-31",
    cutoffRecordedAt: "2026-08-31T23:59:59.000Z",
    generation: 1,
    merchant: sampleMerchant,
    customer: sampleCustomer,
    allDocuments: [
      {
        id: "d1",
        documentNumber: "INV-PDF-001",
        documentType: "invoice",
        direction: "debit",
        issuedOn: "2026-08-10",
        dueOn: "2026-09-10",
        recordedAt: "2026-08-10T10:00:00Z",
        amount: "3450.0000",
        allocatedAmount: "0.0000",
        openAmount: "3450.0000",
        currency: "ZAR",
      },
    ],
    openDocumentsAtCutoff: [
      {
        id: "d1",
        documentNumber: "INV-PDF-001",
        documentType: "invoice",
        direction: "debit",
        issuedOn: "2026-08-10",
        dueOn: "2026-09-10",
        recordedAt: "2026-08-10T10:00:00Z",
        amount: "3450.0000",
        allocatedAmount: "0.0000",
        openAmount: "3450.0000",
        currency: "ZAR",
      },
    ],
    ledgerVersion: 3,
    policyVersion: 1,
    currency: "ZAR",
  });

  const { pdfBuffer: pdf1, sha256: sha1 } = generateStatementPdf(data);

  // 1. Verify PDF header and trailer
  assert.ok(pdf1.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"), "Must have valid %PDF-1.4 header");
  assert.ok(pdf1.subarray(pdf1.length - 20).toString("latin1").includes("%%EOF"), "Must terminate with %%EOF");

  // 2. Verify ISO 32000-1 Catalog & Pages Root hierarchy
  const pdf1Text = pdf1.toString("utf8");
  assert.ok(pdf1Text.includes("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj"), "Object 1 must be Catalog pointing to Pages root at Object 2");
  assert.ok(pdf1Text.includes("2 0 obj\n<< /Type /Pages /Kids [ 6 0 R ] /Count 1 >>\nendobj"), "Object 2 must be Pages root with /Count 1");
  assert.ok(pdf1Text.includes("6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 595.28 841.89 ] /Contents 7 0 R"), "Object 6 must be Page with Parent 2 0 R and Contents 7 0 R");

  // 3. Verify SHA-256 matches exact hash of buffer bytes
  const crypto = await import("node:crypto");
  assert.equal(sha1, crypto.createHash("sha256").update(pdf1).digest("hex"), "SHA-256 must match exact bytes");

  // 4. Save 1-line artifact
  fs.writeFileSync(path.join(artifactsDir, "statement-1-line.pdf"), pdf1);
  assert.ok(fs.existsSync(path.join(artifactsDir, "statement-1-line.pdf")));

  function createSampleStatement(count: number, statementId: string) {
    const docs: StatementDocumentItem[] = [];
    for (let i = 1; i <= count; i++) {
      const isCredit = i % 5 === 0;
      const day = (i % 28) + 1;
      docs.push({
        id: `doc-${statementId}-${i}`,
        documentNumber: isCredit ? `RCT-BATCH-${String(i).padStart(4, "0")}` : `INV-BATCH-${String(i).padStart(4, "0")}`,
        documentType: isCredit ? "payment" : "invoice",
        direction: isCredit ? "credit" : "debit",
        issuedOn: `2026-08-${String(day).padStart(2, "0")}`,
        dueOn: `2026-09-${String(day).padStart(2, "0")}`,
        recordedAt: `2026-08-${String(day).padStart(2, "0")}T10:00:00.000Z`,
        amount: "50.0000",
        allocatedAmount: "0.0000",
        openAmount: "50.0000",
        currency: "ZAR",
      });
    }

    return buildStatementData({
      statementId,
      statementRunId: "run-0001",
      periodFrom: "2026-08-01",
      periodTo: "2026-08-31",
      cutoffRecordedAt: "2026-08-31T23:59:59.000Z",
      generation: 1,
      merchant: sampleMerchant,
      customer: sampleCustomer,
      allDocuments: docs,
      openDocumentsAtCutoff: docs,
      ledgerVersion: count,
      policyVersion: 1,
      currency: "ZAR",
    });
  }

  // 5. Test 10-line statement PDF
  const data10 = createSampleStatement(10, "stmt-10-line");
  const { pdfBuffer: pdf10, sha256: sha10 } = generateStatementPdf(data10);
  assert.ok(pdf10.length > 0);
  fs.writeFileSync(path.join(artifactsDir, "statement-10-line.pdf"), pdf10);
  assert.ok(fs.existsSync(path.join(artifactsDir, "statement-10-line.pdf")));

  // 6. Test 200-line statement PDF - Multi-page pagination without dropping ANY transactions
  const data200 = createSampleStatement(200, "stmt-200-line");
  const { pdfBuffer: pdf200, sha256: sha200 } = generateStatementPdf(data200);
  const pdf200Text = pdf200.toString("utf8");

  // Verify multiple pages are created in Pages root
  const countMatch = pdf200Text.match(/\/Count (\d+)/);
  assert.ok(countMatch, "PDF must define /Count in Pages root");
  const pageCount = parseInt(countMatch[1]!, 10);
  assert.ok(pageCount >= 5, `200-line statement must span at least 5 pages (actual: ${pageCount})`);

  // Verify Catalog points to Pages root
  assert.ok(pdf200Text.includes("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj"));

  // Verify EVERY single transaction item from 1 to 200 is present in the PDF!
  for (let i = 1; i <= 200; i++) {
    const isCredit = i % 5 === 0;
    const docNum = isCredit ? `RCT-BATCH-${String(i).padStart(4, "0")}` : `INV-BATCH-${String(i).padStart(4, "0")}`;
    assert.ok(pdf200Text.includes(docNum), `Transaction ${docNum} must exist in generated multi-page PDF`);
  }

  // Save 200-line artifact
  fs.writeFileSync(path.join(artifactsDir, "statement-200-line.pdf"), pdf200);
  assert.ok(fs.existsSync(path.join(artifactsDir, "statement-200-line.pdf")));
});
