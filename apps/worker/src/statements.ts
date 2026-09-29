import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DbClient } from "../../../packages/database/tenant-context.ts";
import { withTenantContext } from "../../../packages/database/tenant-context.ts";
import { parseMoney, formatMoney } from "../../../packages/domain/src/money.ts";
import {
  buildStatementData,
  computeStatementSha256,
  type StatementData,
  type StatementDocumentItem,
  type StatementMerchantInfo,
  type StatementCustomerInfo,
} from "../../../packages/domain/src/statements.ts";
import { getStatementStorage } from "../../../packages/domain/src/storage.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface StatementRunParams {
  periodFrom: string; // YYYY-MM-DD
  periodTo: string; // YYYY-MM-DD
  cutoffRecordedAt?: string; // ISO string, defaults to now
  generation?: number;
  actorId: string;
}

export interface StatementRunResult {
  statementRunId: string;
  periodFrom: string;
  periodTo: string;
  cutoffRecordedAt: string;
  generation: number;
  status: "building" | "ready" | "complete";
  statementsCount: number;
  totalDebits: string;
  totalCredits: string;
  netClosingBalance: string;
}

export const DEFAULT_MERCHANT_INFO: StatementMerchantInfo = {
  businessName: "Genesis Retailers (Pty) Ltd",
  tradingAddress: "124 Main Road, Paarl, Western Cape, 7646, South Africa",
  taxNumber: "ZA4920194820",
  contactEmail: "accounts@genesisretail.co.za",
  contactPhone: "+27 21 872 1000",
  bankDetails: {
    bankName: "First National Bank",
    accountNumber: "62891024810",
    branchCode: "250655",
    accountType: "Current Account",
    reference: "ACCOUNT_NUMBER",
  },
};

import { generateStatementPdf } from "./pdf.ts";

/**
 * HTML escaping helper to prevent XSS / markup injection in statement documents.
 */
export function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Loads the HTML statement template.
 */
export function getStatementTemplate(): string {
  const templatePath = path.resolve(__dirname, "../templates/statement.html");
  if (fs.existsSync(templatePath)) {
    return fs.readFileSync(templatePath, "utf-8");
  }
  // Fallback inline template
  return `<!DOCTYPE html><html><body><h1>Statement {{customer.accountNumber}}</h1><p>Closing: {{totals.currency}} {{totals.closingBalance}}</p></body></html>`;
}

/**
 * Renders the statement HTML artifact with deterministic formatting, safe HTML escaping, and SHA-256 calculation.
 */
export function renderStatementHtml(data: StatementData, customTemplate?: string): { html: string; sha256: string } {
  let template = customTemplate || getStatementTemplate();

  // Conditionals
  const hasD030 = parseMoney(data.aging.d030) > 0n;
  const hasD060 = parseMoney(data.aging.d060) > 0n;
  const hasD090 = parseMoney(data.aging.d090) > 0n;
  const hasD120 = parseMoney(data.aging.d120) > 0n;
  const hasD150 = parseMoney(data.aging.d150) > 0n;
  const hasD180 = parseMoney(data.aging.d180) > 0n;
  const hasOver = parseMoney(data.aging.over) > 0n;

  template = template.replace(/\{\{#if merchant\.taxNumber\}\}([\s\S]*?)\{\{\/if\}\}/g, data.merchant.taxNumber ? "$1" : "");
  template = template.replace(/\{\{#if customer\.contactPhone\}\}([\s\S]*?)\{\{\/if\}\}/g, data.customer.contactPhone ? "$1" : "");
  template = template.replace(/\{\{#if customer\.billingAddress\}\}([\s\S]*?)\{\{\/if\}\}/g, data.customer.billingAddress ? "$1" : "");

  template = template.replace(/\{\{#if aging\.hasD030\}\}([\s\S]*?)\{\{\/if\}\}/g, hasD030 ? "$1" : "");
  template = template.replace(/\{\{#if aging\.hasD060\}\}([\s\S]*?)\{\{\/if\}\}/g, hasD060 ? "$1" : "");
  template = template.replace(/\{\{#if aging\.hasD090\}\}([\s\S]*?)\{\{\/if\}\}/g, hasD090 ? "$1" : "");
  template = template.replace(/\{\{#if aging\.hasD120\}\}([\s\S]*?)\{\{\/if\}\}/g, hasD120 ? "$1" : "");
  template = template.replace(/\{\{#if aging\.hasD150\}\}([\s\S]*?)\{\{\/if\}\}/g, hasD150 ? "$1" : "");
  template = template.replace(/\{\{#if aging\.hasD180\}\}([\s\S]*?)\{\{\/if\}\}/g, hasD180 ? "$1" : "");
  template = template.replace(/\{\{#if aging\.hasOver\}\}([\s\S]*?)\{\{\/if\}\}/g, hasOver ? "$1" : "");

  // Safely escaped variable replacements
  template = template.replace(/\{\{customer\.name\}\}/g, escapeHtml(data.customer.name));
  template = template.replace(/\{\{customer\.accountNumber\}\}/g, escapeHtml(data.customer.accountNumber));
  template = template.replace(/\{\{customer\.contactEmail\}\}/g, escapeHtml(data.customer.contactEmail));
  template = template.replace(/\{\{customer\.contactPhone\}\}/g, escapeHtml(data.customer.contactPhone || ""));
  template = template.replace(/\{\{customer\.billingAddress\}\}/g, escapeHtml(data.customer.billingAddress || ""));

  template = template.replace(/\{\{merchant\.businessName\}\}/g, escapeHtml(data.merchant.businessName));
  template = template.replace(/\{\{merchant\.tradingAddress\}\}/g, escapeHtml(data.merchant.tradingAddress));
  template = template.replace(/\{\{merchant\.taxNumber\}\}/g, escapeHtml(data.merchant.taxNumber || ""));
  template = template.replace(/\{\{merchant\.contactEmail\}\}/g, escapeHtml(data.merchant.contactEmail));
  template = template.replace(/\{\{merchant\.contactPhone\}\}/g, escapeHtml(data.merchant.contactPhone));
  template = template.replace(/\{\{merchant\.bankDetails\.bankName\}\}/g, escapeHtml(data.merchant.bankDetails.bankName));
  template = template.replace(/\{\{merchant\.bankDetails\.accountNumber\}\}/g, escapeHtml(data.merchant.bankDetails.accountNumber));
  template = template.replace(/\{\{merchant\.bankDetails\.branchCode\}\}/g, escapeHtml(data.merchant.bankDetails.branchCode));
  template = template.replace(/\{\{merchant\.bankDetails\.accountType\}\}/g, escapeHtml(data.merchant.bankDetails.accountType));

  template = template.replace(/\{\{statementId\}\}/g, escapeHtml(data.statementId));
  template = template.replace(/\{\{periodFrom\}\}/g, escapeHtml(data.periodFrom));
  template = template.replace(/\{\{periodTo\}\}/g, escapeHtml(data.periodTo));
  template = template.replace(/\{\{generation\}\}/g, String(data.generation));
  template = template.replace(/\{\{cutoffRecordedAt\}\}/g, escapeHtml(data.cutoffRecordedAt));
  template = template.replace(/\{\{ledgerVersion\}\}/g, String(data.ledgerVersion));
  template = template.replace(/\{\{policyVersion\}\}/g, String(data.policyVersion));

  template = template.replace(/\{\{totals\.currency\}\}/g, escapeHtml(data.totals.currency));
  template = template.replace(/\{\{totals\.openingBalance\}\}/g, escapeHtml(data.totals.openingBalance));
  template = template.replace(/\{\{totals\.totalDebits\}\}/g, escapeHtml(data.totals.totalDebits));
  template = template.replace(/\{\{totals\.totalCredits\}\}/g, escapeHtml(data.totals.totalCredits));
  template = template.replace(/\{\{totals\.closingBalance\}\}/g, escapeHtml(data.totals.closingBalance));

  // Aging replacements
  template = template.replace(/\{\{aging\.current\}\}/g, escapeHtml(data.aging.current));
  template = template.replace(/\{\{aging\.d030\}\}/g, escapeHtml(data.aging.d030));
  template = template.replace(/\{\{aging\.d060\}\}/g, escapeHtml(data.aging.d060));
  template = template.replace(/\{\{aging\.d090\}\}/g, escapeHtml(data.aging.d090));
  template = template.replace(/\{\{aging\.d120\}\}/g, escapeHtml(data.aging.d120));
  template = template.replace(/\{\{aging\.d150\}\}/g, escapeHtml(data.aging.d150));
  template = template.replace(/\{\{aging\.d180\}\}/g, escapeHtml(data.aging.d180));
  template = template.replace(/\{\{aging\.over\}\}/g, escapeHtml(data.aging.over));
  template = template.replace(/\{\{aging\.unappliedCredit\}\}/g, escapeHtml(data.aging.unappliedCredit));

  // Items table rendering
  let runningUnits = parseMoney(data.totals.openingBalance);
  let rowsHtml = "";

  for (const item of data.items) {
    const itemUnits = parseMoney(item.amount);
    const isDebit = item.direction === "debit";
    const isCredit = item.direction === "credit";

    if (isDebit) {
      runningUnits += itemUnits;
    } else {
      runningUnits -= itemUnits;
    }

    const runningFormatted = formatMoney(runningUnits);

    rowsHtml += `
      <tr>
        <td>${escapeHtml(item.issuedOn)}</td>
        <td><strong>${escapeHtml(item.documentNumber)}</strong></td>
        <td>${escapeHtml(item.documentType)}</td>
        <td>${escapeHtml(item.dueOn)}</td>
        <td class="num">${isDebit ? `${escapeHtml(data.totals.currency)} ${escapeHtml(item.amount)}` : "—"}</td>
        <td class="num">${isCredit ? `${escapeHtml(data.totals.currency)} ${escapeHtml(item.amount)}` : "—"}</td>
        <td class="num">${escapeHtml(data.totals.currency)} ${escapeHtml(runningFormatted)}</td>
      </tr>`;
  }

  // Replace block loop with rendered rows
  const loopRegex = /\{\{#each items\}\}[\s\S]*?\{\{\/each\}\}/;
  template = template.replace(loopRegex, rowsHtml);

  // Embed verified deterministic SHA-256
  template = template.replace(/\{\{pdfSha256\}\}/g, escapeHtml(data.pdfSha256));

  return { html: template, sha256: data.pdfSha256 };
}

interface DebtorRow {
  id: string;
  account_number: string;
  legal_name: string;
  trade_name?: string;
  shopify_customer_gid?: string;
  contact_email?: string;
  contact_phone?: string;
  currency: string;
  policy_version: number;
  ledger_version: number;
  aging_basis: string;
}

/**
 * Worker function to execute a statement run across all debtors in a tenant.
 */
export async function executeStatementRun(
  db: DbClient,
  tenantId: string,
  params: StatementRunParams,
  merchantInfo: StatementMerchantInfo = DEFAULT_MERCHANT_INFO,
): Promise<StatementRunResult> {
  return await withTenantContext(db, tenantId, async (client) => {
    const cutoffRecordedAt = params.cutoffRecordedAt || new Date().toISOString();
    const generation = params.generation || 1;

    // 1. Create statement_run record
    const runRes = await client.query(
      `INSERT INTO statement_run (
        tenant_id, period_from, period_to, cutoff_recorded_at, generation, status, actor_id
      ) VALUES ($1, $2, $3, $4, $5, 'building', $6)
      RETURNING id, period_from, period_to, cutoff_recorded_at, generation, status`,
      [tenantId, params.periodFrom, params.periodTo, cutoffRecordedAt, generation, params.actorId]
    );
    const runRow = runRes.rows[0];
    if (!runRow) {
      throw new Error("Failed to insert statement run");
    }
    const statementRunId = runRow.id as string;

    // 2. Fetch all active/hold debtor accounts with optional customer identity and billing contacts
    const debtorsRes = await client.query(
      `SELECT da.id, da.account_number, da.legal_name, da.trade_name, da.currency,
              da.policy_version, da.ledger_version, da.aging_basis,
              di.shopify_gid as shopify_customer_gid,
              bc.email as contact_email, bc.phone as contact_phone
       FROM debtor_account da
       LEFT JOIN debtor_identity di ON di.tenant_id = da.tenant_id AND di.debtor_account_id = da.id AND di.kind = 'customer'
       LEFT JOIN billing_contact bc ON bc.tenant_id = da.tenant_id AND bc.debtor_account_id = da.id AND bc.send_statements = true
       WHERE da.tenant_id = $1 AND da.status != 'closed'
       ORDER BY da.account_number ASC`,
      [tenantId]
    );

    let statementsCount = 0;
    let totalDebitsUnits = 0n;
    let totalCreditsUnits = 0n;
    let netClosingUnits = 0n;

    for (const debtor of debtorsRes.rows as unknown as DebtorRow[]) {
      // 3. Fetch all documents recorded up to cutoff (matching created_at against cutoff timestamp)
      const docsRes = await client.query(
        `SELECT id, document_number, kind as document_type, direction, issued_on::text, due_on::text,
                created_at::text as recorded_at, amount::text, currency
         FROM document
         WHERE tenant_id = $1 AND debtor_account_id = $2 AND created_at <= $3
         ORDER BY issued_on ASC, document_number ASC`,
        [tenantId, debtor.id, cutoffRecordedAt]
      );

      const allDocs: StatementDocumentItem[] = docsRes.rows.map((r: any) => ({
        id: r.id,
        documentNumber: r.document_number,
        documentType: r.document_type,
        direction: r.direction,
        issuedOn: r.issued_on,
        dueOn: r.due_on,
        recordedAt: r.recorded_at,
        amount: r.amount,
        allocatedAmount: "0.0000",
        openAmount: r.amount,
        currency: r.currency,
      }));

      // Calculate open amounts from allocations up to cutoff
      for (const doc of allDocs) {
        const allocRes = await client.query(
          `SELECT COALESCE(SUM(amount), 0)::text as allocated
           FROM allocation
           WHERE tenant_id = $1 AND (debit_document_id = $2 OR credit_document_id = $2)
             AND created_at <= $3
             AND id NOT IN (SELECT allocation_id FROM allocation_reversal WHERE tenant_id = $1 AND created_at <= $3)`,
          [tenantId, doc.id, cutoffRecordedAt]
        );
        const allocAmt = (allocRes.rows[0]?.allocated as string | undefined) ?? "0.0000";
        doc.allocatedAmount = allocAmt;
        const totalU = parseMoney(doc.amount);
        const allocU = parseMoney(allocAmt);
        doc.openAmount = formatMoney(totalU > allocU ? totalU - allocU : 0n);
      }

      const openDocsAtCutoff = allDocs.filter((d) => parseMoney(d.openAmount) > 0n);

      const uuidRes = await client.query("SELECT gen_random_uuid() as id");
      const statementId = uuidRes.rows[0]?.id as string;

      const customerInfo: StatementCustomerInfo = {
        debtorAccountId: debtor.id,
        accountNumber: debtor.account_number,
        name: debtor.legal_name,
        shopifyCustomerId: debtor.shopify_customer_gid || `gid://shopify/Customer/${debtor.account_number}`,
        contactEmail: debtor.contact_email || `billing@${debtor.account_number.toLowerCase()}.example.com`,
        contactPhone: debtor.contact_phone || "+27 21 000 0000",
      };

      const statementData = buildStatementData({
        statementId,
        statementRunId,
        periodFrom: params.periodFrom,
        periodTo: params.periodTo,
        cutoffRecordedAt,
        generation,
        merchant: merchantInfo,
        customer: customerInfo,
        allDocuments: allDocs,
        openDocumentsAtCutoff: openDocsAtCutoff,
        ledgerVersion: Number(debtor.ledger_version),
        policyVersion: Number(debtor.policy_version),
        currency: debtor.currency,
      });

      const { html } = renderStatementHtml(statementData);
      const { pdfBuffer, sha256: pdfSha256 } = generateStatementPdf(statementData);
      const pdfObjectKey = `statements/${tenantId}/${statementRunId}/${debtor.account_number}.pdf`;

      // Persist PDF binary artifact to durable statement storage provider (Local/S3/GCS)
      const storage = getStatementStorage();
      await storage.put(pdfObjectKey, pdfBuffer, {
        contentType: "application/pdf",
        metadata: {
          tenantId,
          statementRunId,
          debtorAccountId: debtor.id,
          accountNumber: debtor.account_number,
        },
      });

      // 4. Insert statement record with verified PDF binary object key and exact PDF byte SHA-256
      await client.query(
        `INSERT INTO statement (
          id, tenant_id, statement_run_id, debtor_account_id,
          opening_balance, debits, credits, closing_balance, currency,
          ledger_version, pdf_object_key, pdf_sha256, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ready')`,
        [
          statementId,
          tenantId,
          statementRunId,
          debtor.id,
          statementData.totals.openingBalance,
          statementData.totals.totalDebits,
          statementData.totals.totalCredits,
          statementData.totals.closingBalance,
          debtor.currency,
          debtor.ledger_version,
          pdfObjectKey,
          pdfSha256,
        ]
      );

      // 5. Insert statement_item records
      let lineNum = 1;
      for (const item of statementData.items) {
        await client.query(
          `INSERT INTO statement_item (
            tenant_id, statement_id, document_id, line_number, open_amount
          ) VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, statementId, item.id, lineNum++, item.openAmount]
        );
      }

      statementsCount++;
      totalDebitsUnits += parseMoney(statementData.totals.totalDebits);
      totalCreditsUnits += parseMoney(statementData.totals.totalCredits);
      netClosingUnits += parseMoney(statementData.totals.closingBalance);
    }

    // 6. Update statement_run status to ready
    await client.query(
      `UPDATE statement_run SET status = 'ready' WHERE tenant_id = $1 AND id = $2`,
      [tenantId, statementRunId]
    );

    // 7. Emit atomic outbox event
    const outboxPayload = JSON.stringify({
      statementRunId,
      periodFrom: params.periodFrom,
      periodTo: params.periodTo,
      statementsCount,
      totalDebits: formatMoney(totalDebitsUnits),
      totalCredits: formatMoney(totalCreditsUnits),
      netClosingBalance: formatMoney(netClosingUnits),
    });

    await client.query(
      `INSERT INTO outbox (
        tenant_id, kind, aggregate_id, idempotency_key, payload
      ) VALUES ($1, 'statement/run_completed', $2, $3, $4)`,
      [
        tenantId,
        statementRunId,
        `stmt-run-outbox-${statementRunId}`,
        outboxPayload,
      ]
    );

    return {
      statementRunId,
      periodFrom: params.periodFrom,
      periodTo: params.periodTo,
      cutoffRecordedAt,
      generation,
      status: "ready",
      statementsCount,
      totalDebits: formatMoney(totalDebitsUnits),
      totalCredits: formatMoney(totalCreditsUnits),
      netClosingBalance: formatMoney(netClosingUnits),
    };
  });
}
