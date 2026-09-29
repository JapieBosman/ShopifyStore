import type { DbClient } from "../../database/tenant-context.ts";
import { withTenantContext } from "../../database/tenant-context.ts";
import { parseMoney, formatMoney, assertSingleCurrency, validateCurrency } from "./money.ts";

export interface PostingLine {
  ledgerAccountId: string;
  debtorAccountId?: string | null;
  direction: "debit" | "credit";
  amount: string; // decimal string
  currency: string;
  memo?: string | null;
}

export interface DocumentLineInput {
  variantGid?: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  netAmount: string;
  taxAmount?: string;
  grossAmount: string;
  taxSnapshot?: Record<string, unknown>;
}

export interface DocumentInput {
  debtorAccountId: string;
  documentNumber: string;
  kind:
    | "invoice"
    | "credit_note"
    | "payment"
    | "debit_adjustment"
    | "credit_adjustment"
    | "interest"
    | "opening_debit"
    | "opening_credit";
  direction: "debit" | "credit";
  amount: string;
  currency: string;
  issuedOn: string; // YYYY-MM-DD
  dueOn?: string | null;
  shopifyOrderGid?: string | null;
  sourceEventKey: string;
  originalDocumentId?: string | null;
  poNumber?: string | null;
  jobReference?: string | null;
  billingSnapshot?: Record<string, unknown>;
  shippingSnapshot?: Record<string, unknown>;
  termsSnapshot?: Record<string, unknown>;
  lines?: DocumentLineInput[];
}

export interface PostingBundle {
  actorId: string;
  currency: string;
  effectiveDate: string; // YYYY-MM-DD
  sourceKind: string;
  sourceKey: string;
  idempotencyKey: string;
  memo?: string | null;
  lines: PostingLine[];
  documents?: DocumentInput[];
}

export interface PostingResult {
  journalId: string;
  documentIds: string[];
  totalAmount: string;
  currency: string;
  isDuplicate: boolean;
}

export interface ReversePostingCommand {
  actorId: string;
  originalJournalId: string;
  idempotencyKey: string;
  effectiveDate: string;
  memo?: string | null;
}

export interface ReversePostingResult {
  reversalJournalId: string;
  originalJournalId: string;
  reversalDocumentIds: string[];
  totalAmount: string;
  currency: string;
  isDuplicate: boolean;
}

/**
 * Validates aggregate balance, line counts, and currency uniformity of a posting bundle.
 */
export function validatePostingBundle(bundle: PostingBundle): { totalUnits: bigint } {
  if (!bundle.lines || bundle.lines.length < 2) {
    throw new RangeError(`A journal posting must contain at least 2 lines, got ${bundle.lines?.length ?? 0}`);
  }

  // Validate currency code
  validateCurrency(bundle.currency);

  // Validate all lines and documents share the exact same currency
  const currencies = [
    bundle.currency,
    ...bundle.lines.map((l) => l.currency),
    ...(bundle.documents ?? []).map((d) => d.currency),
  ];
  assertSingleCurrency(currencies);

  let totalDebit = 0n;
  let totalCredit = 0n;

  for (const line of bundle.lines) {
    const units = parseMoney(line.amount);
    if (units <= 0n) {
      throw new RangeError(`Journal line amount must be positive, got '${line.amount}'`);
    }
    if (line.direction === "debit") {
      totalDebit += units;
    } else if (line.direction === "credit") {
      totalCredit += units;
    } else {
      throw new TypeError(`Invalid line direction: '${line.direction}'`);
    }
  }

  if (totalDebit !== totalCredit) {
    throw new RangeError(
      `Unbalanced journal posting: total debit (${formatMoney(totalDebit)}) does not equal total credit (${formatMoney(totalCredit)})`,
    );
  }

  return { totalUnits: totalDebit };
}

/**
 * Atomically posts a balanced double-entry journal, documents, outbox and audit events.
 * Enforces debtor account row locking in UUID order to prevent deadlocks.
 */
export async function postJournal(
  client: DbClient,
  tenantId: string,
  bundle: PostingBundle,
): Promise<PostingResult> {
  return withTenantContext(client, tenantId, async (tx) => {
    // 1. Check idempotency and duplicate source
    const existingJournalRes = await tx.query<{ id: string; currency: string }>(
      `SELECT id, currency 
       FROM journal 
       WHERE tenant_id = $1 
         AND (idempotency_key = $2 OR (source_kind = $3 AND source_key = $4))`,
      [tenantId, bundle.idempotencyKey, bundle.sourceKind, bundle.sourceKey],
    );

    if (existingJournalRes.rows.length > 0) {
      const existingJournal = existingJournalRes.rows[0]!;
      const existingDocsRes = await tx.query<{ id: string; amount: string }>(
        "SELECT id, amount FROM document WHERE tenant_id = $1 AND journal_id = $2",
        [tenantId, existingJournal.id],
      );
      let total = "0.0000";
      if (existingDocsRes.rows.length > 0) {
        total = existingDocsRes.rows[0]!.amount;
      }
      return {
        journalId: existingJournal.id,
        documentIds: existingDocsRes.rows.map((d) => d.id),
        totalAmount: total,
        currency: existingJournal.currency,
        isDuplicate: true,
      };
    }

    // 2. Validate bundle invariants
    const { totalUnits } = validatePostingBundle(bundle);

    // 3. Lock affected debtor accounts in deterministic UUID order
    const debtorAccountIds = [
      ...new Set([
        ...bundle.lines.map((l) => l.debtorAccountId).filter((id): id is string => Boolean(id)),
        ...(bundle.documents ?? []).map((d) => d.debtorAccountId),
      ]),
    ].sort();

    if (debtorAccountIds.length > 0) {
      const lockedRes = await tx.query<{ id: string; currency: string }>(
        `SELECT id, currency 
         FROM debtor_account 
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) 
         ORDER BY id 
         FOR UPDATE`,
        [tenantId, debtorAccountIds],
      );

      if (lockedRes.rows.length !== debtorAccountIds.length) {
        throw new RangeError("One or more debtor accounts in posting bundle do not exist");
      }

      for (const account of lockedRes.rows) {
        if (account.currency !== bundle.currency) {
          throw new RangeError(
            `Debtor account ${account.id} currency (${account.currency}) does not match posting currency (${bundle.currency})`,
          );
        }
      }
    }

    // 4. Insert Journal
    const journalRes = await tx.query<{ id: string }>(
      `INSERT INTO journal (
        tenant_id, currency, effective_date, posted_at, actor_id, source_kind, source_key, idempotency_key, memo
      ) VALUES (
        $1, $2, $3, now(), $4, $5, $6, $7, $8
      ) RETURNING id`,
      [
        tenantId,
        bundle.currency,
        bundle.effectiveDate,
        bundle.actorId,
        bundle.sourceKind,
        bundle.sourceKey,
        bundle.idempotencyKey,
        bundle.memo ?? null,
      ],
    );
    const journalId = journalRes.rows[0]!.id;

    // 5. Insert Journal Lines
    for (let i = 0; i < bundle.lines.length; i++) {
      const line = bundle.lines[i]!;
      const debit = line.direction === "debit" ? line.amount : "0.0000";
      const credit = line.direction === "credit" ? line.amount : "0.0000";
      await tx.query(
        `INSERT INTO journal_line (
          tenant_id, journal_id, line_number, ledger_account_id, debtor_account_id, debit, credit
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )`,
        [
          tenantId,
          journalId,
          i + 1,
          line.ledgerAccountId,
          line.debtorAccountId ?? null,
          debit,
          credit,
        ],
      );
    }

    // 6. Insert Documents & Lines if present
    const documentIds: string[] = [];
    if (bundle.documents && bundle.documents.length > 0) {
      for (const doc of bundle.documents) {
        const docRes = await tx.query<{ id: string }>(
          `INSERT INTO document (
            tenant_id, debtor_account_id, journal_id, document_number, kind, direction,
            amount, currency, issued_on, due_on, shopify_order_gid, source_event_key,
            original_document_id, po_number, job_reference, billing_snapshot, shipping_snapshot, terms_snapshot
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18
          ) RETURNING id`,
          [
            tenantId,
            doc.debtorAccountId,
            journalId,
            doc.documentNumber,
            doc.kind,
            doc.direction,
            doc.amount,
            doc.currency,
            doc.issuedOn,
            doc.dueOn ?? null,
            doc.shopifyOrderGid ?? null,
            doc.sourceEventKey,
            doc.originalDocumentId ?? null,
            doc.poNumber ?? null,
            doc.jobReference ?? null,
            JSON.stringify(doc.billingSnapshot ?? {}),
            JSON.stringify(doc.shippingSnapshot ?? {}),
            JSON.stringify(doc.termsSnapshot ?? {}),
          ],
        );
        const docId = docRes.rows[0]!.id;
        documentIds.push(docId);

        // Document lines
        if (doc.lines && doc.lines.length > 0) {
          for (let li = 0; li < doc.lines.length; li++) {
            const dl = doc.lines[li]!;
            await tx.query(
              `INSERT INTO document_line (
                tenant_id, document_id, line_number, variant_gid, description,
                quantity, unit_price, net_amount, tax_amount, gross_amount, tax_snapshot
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
              )`,
              [
                tenantId,
                docId,
                li + 1,
                dl.variantGid ?? null,
                dl.description,
                dl.quantity,
                dl.unitPrice,
                dl.netAmount,
                dl.taxAmount ?? "0.0000",
                dl.grossAmount,
                JSON.stringify(dl.taxSnapshot ?? {}),
              ],
            );
          }
        }
      }
    }

    // 7. Increment debtor accounts' ledger_version
    if (debtorAccountIds.length > 0) {
      await tx.query(
        `UPDATE debtor_account 
         SET ledger_version = ledger_version + 1 
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, debtorAccountIds],
      );
    }

    // 8. Atomic Outbox and Audit Event
    await tx.query(
      `INSERT INTO outbox (tenant_id, kind, aggregate_id, idempotency_key, payload)
       VALUES ($1, 'ledger/journal_posted', $2, $3, $4)`,
      [
        tenantId,
        journalId,
        `outbox:journal:${journalId}`,
        JSON.stringify({
          journalId,
          documentIds,
          totalAmount: formatMoney(totalUnits),
          currency: bundle.currency,
        }),
      ],
    );

    await tx.query(
      `INSERT INTO audit_event (
        tenant_id, actor_id, action, entity_type, entity_id, correlation_id, details
      ) VALUES (
        $1, $2, 'post', 'journal', $3, gen_random_uuid(), $4
      )`,
      [
        tenantId,
        bundle.actorId,
        journalId,
        JSON.stringify({ sourceKind: bundle.sourceKind, sourceKey: bundle.sourceKey }),
      ],
    );

    return {
      journalId,
      documentIds,
      totalAmount: formatMoney(totalUnits),
      currency: bundle.currency,
      isDuplicate: false,
    };
  });
}

/**
 * Reverses a posted journal by creating a balanced reversal journal with inverse debit/credit lines.
 * Leaves the original journal and document intact, linking reverses_journal_id and balancing net to zero.
 */
export async function reversePosting(
  client: DbClient,
  tenantId: string,
  command: ReversePostingCommand,
): Promise<ReversePostingResult> {
  return withTenantContext(client, tenantId, async (tx) => {
    // 1. Check idempotency
    const existingReversalRes = await tx.query<{ id: string; currency: string }>(
      `SELECT id, currency 
       FROM journal 
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, command.idempotencyKey],
    );
    if (existingReversalRes.rows.length > 0) {
      const existingReversal = existingReversalRes.rows[0]!;
      const existingDocsRes = await tx.query<{ id: string; amount: string }>(
        "SELECT id, amount FROM document WHERE tenant_id = $1 AND journal_id = $2",
        [tenantId, existingReversal.id],
      );
      let total = "0.0000";
      if (existingDocsRes.rows.length > 0) {
        total = existingDocsRes.rows[0]!.amount;
      }
      return {
        reversalJournalId: existingReversal.id,
        originalJournalId: command.originalJournalId,
        reversalDocumentIds: existingDocsRes.rows.map((d) => d.id),
        totalAmount: total,
        currency: existingReversal.currency,
        isDuplicate: true,
      };
    }

    // 2. Fetch original journal
    const origJournalRes = await tx.query<{
      id: string;
      currency: string;
      source_kind: string;
      source_key: string;
      reverses_journal_id: string | null;
    }>(
      `SELECT id, currency, source_kind, source_key, reverses_journal_id
       FROM journal
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, command.originalJournalId],
    );

    if (origJournalRes.rows.length === 0) {
      throw new RangeError(`Original journal ${command.originalJournalId} not found`);
    }
    const origJournal = origJournalRes.rows[0]!;

    if (origJournal.reverses_journal_id) {
      throw new RangeError("Cannot reverse a journal that is already a reversal");
    }

    // Check if already reversed by another journal
    const alreadyReversedRes = await tx.query<{ id: string }>(
      "SELECT id FROM journal WHERE tenant_id = $1 AND reverses_journal_id = $2",
      [tenantId, origJournal.id],
    );
    if (alreadyReversedRes.rows.length > 0) {
      throw new RangeError(`Journal ${origJournal.id} has already been reversed by ${alreadyReversedRes.rows[0]!.id}`);
    }

    // 3. Fetch original lines
    const origLinesRes = await tx.query<{
      line_number: number;
      ledger_account_id: string;
      debtor_account_id: string | null;
      debit: string;
      credit: string;
    }>(
      `SELECT line_number, ledger_account_id, debtor_account_id, debit, credit
       FROM journal_line
       WHERE tenant_id = $1 AND journal_id = $2
       ORDER BY line_number`,
      [tenantId, origJournal.id],
    );

    if (origLinesRes.rows.length < 2) {
      throw new RangeError("Corrupt original journal has fewer than 2 lines");
    }

    // 4. Fetch original documents
    const origDocsRes = await tx.query<{
      id: string;
      debtor_account_id: string;
      document_number: string;
      kind: DocumentInput["kind"];
      direction: "debit" | "credit";
      amount: string;
      currency: string;
      issued_on: string;
      shopify_order_gid: string | null;
      source_event_key: string;
    }>(
      `SELECT id, debtor_account_id, document_number, kind, direction, amount, currency, issued_on, shopify_order_gid, source_event_key
       FROM document
       WHERE tenant_id = $1 AND journal_id = $2`,
      [tenantId, origJournal.id],
    );

    // 5. Lock debtor accounts
    const debtorAccountIds = [
      ...new Set([
        ...origLinesRes.rows.map((l) => l.debtor_account_id).filter((id): id is string => Boolean(id)),
        ...origDocsRes.rows.map((d) => d.debtor_account_id),
      ]),
    ].sort();

    if (debtorAccountIds.length > 0) {
      await tx.query(
        `SELECT id FROM debtor_account 
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) 
         ORDER BY id 
         FOR UPDATE`,
        [tenantId, debtorAccountIds],
      );
    }

    // 6. Insert Reversal Journal linking reverses_journal_id
    const reversalJournalRes = await tx.query<{ id: string }>(
      `INSERT INTO journal (
        tenant_id, currency, effective_date, posted_at, actor_id, source_kind, source_key,
        idempotency_key, reverses_journal_id, memo
      ) VALUES (
        $1, $2, $3, now(), $4, 'reversal', $5,
        $6, $7, $8
      ) RETURNING id`,
      [
        tenantId,
        origJournal.currency,
        command.effectiveDate,
        command.actorId,
        `rev:${origJournal.id}`,
        command.idempotencyKey,
        origJournal.id,
        command.memo ?? `Reversal of journal ${origJournal.id}`,
      ],
    );
    const reversalJournalId = reversalJournalRes.rows[0]!.id;

    // 7. Insert inverted journal lines
    let totalDebit = 0n;
    for (let i = 0; i < origLinesRes.rows.length; i++) {
      const line = origLinesRes.rows[i]!;
      // Invert debit and credit
      const revDebit = line.credit;
      const revCredit = line.debit;
      totalDebit += parseMoney(revDebit);

      await tx.query(
        `INSERT INTO journal_line (
          tenant_id, journal_id, line_number, ledger_account_id, debtor_account_id, debit, credit
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )`,
        [
          tenantId,
          reversalJournalId,
          i + 1,
          line.ledger_account_id,
          line.debtor_account_id ?? null,
          revDebit,
          revCredit,
        ],
      );
    }

    // 8. Insert reversal document(s)
    const reversalDocumentIds: string[] = [];
    for (const doc of origDocsRes.rows) {
      const invertedDocDir = doc.direction === "debit" ? "credit" : "debit";
      const revDocRes = await tx.query<{ id: string }>(
        `INSERT INTO document (
          tenant_id, debtor_account_id, journal_id, document_number, kind, direction,
          amount, currency, issued_on, due_on, shopify_order_gid, source_event_key, original_document_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, null, $10, $11, $12
        ) RETURNING id`,
        [
          tenantId,
          doc.debtor_account_id,
          reversalJournalId,
          `REV-${doc.document_number}`,
          doc.kind,
          invertedDocDir,
          doc.amount,
          doc.currency,
          command.effectiveDate,
          doc.shopify_order_gid ?? null,
          `reversal:${doc.source_event_key}`,
          doc.id,
        ],
      );
      reversalDocumentIds.push(revDocRes.rows[0]!.id);
    }

    // 9. Increment debtor accounts' ledger_version
    if (debtorAccountIds.length > 0) {
      await tx.query(
        `UPDATE debtor_account 
         SET ledger_version = ledger_version + 1 
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, debtorAccountIds],
      );
    }

    // 10. Outbox & Audit
    await tx.query(
      `INSERT INTO outbox (tenant_id, kind, aggregate_id, idempotency_key, payload)
       VALUES ($1, 'ledger/journal_reversed', $2, $3, $4)`,
      [
        tenantId,
        reversalJournalId,
        `outbox:journal_reversal:${reversalJournalId}`,
        JSON.stringify({
          originalJournalId: origJournal.id,
          reversalJournalId,
          reversalDocumentIds,
        }),
      ],
    );

    await tx.query(
      `INSERT INTO audit_event (
        tenant_id, actor_id, action, entity_type, entity_id, correlation_id, details
      ) VALUES (
        $1, $2, 'reverse', 'journal', $3, gen_random_uuid(), $4
      )`,
      [
        tenantId,
        command.actorId,
        reversalJournalId,
        JSON.stringify({ originalJournalId: origJournal.id }),
      ],
    );

    return {
      reversalJournalId,
      originalJournalId: origJournal.id,
      reversalDocumentIds,
      totalAmount: formatMoney(totalDebit),
      currency: origJournal.currency,
      isDuplicate: false,
    };
  });
}
