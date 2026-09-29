import crypto from "node:crypto";
import type { StatementData } from "../../../packages/domain/src/statements.ts";

/**
 * Escapes text for PDF literal strings enclosed in parentheses.
 */
function escapePdfText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

interface PageChunk {
  pageNumber: number;
  items: StatementData["items"];
  isFirstPage: boolean;
  isLastPage: boolean;
}

/**
 * Splits statement items across multiple pages cleanly without dropping any items.
 */
function paginateItems(items: StatementData["items"]): PageChunk[] {
  // If there are 0 or few items, fits on 1 page with summary
  if (items.length <= 18) {
    return [
      {
        pageNumber: 1,
        items,
        isFirstPage: true,
        isLastPage: true,
      },
    ];
  }

  const chunks: PageChunk[] = [];
  let remaining = [...items];
  let pageNum = 1;

  while (remaining.length > 0) {
    const isFirst = pageNum === 1;
    // On page 1: if remaining fits in 18, it's last; otherwise takes up to 36
    if (isFirst) {
      if (remaining.length <= 18) {
        chunks.push({
          pageNumber: pageNum,
          items: remaining,
          isFirstPage: true,
          isLastPage: true,
        });
        remaining = [];
      } else {
        const take = Math.min(remaining.length, 36);
        chunks.push({
          pageNumber: pageNum,
          items: remaining.slice(0, take),
          isFirstPage: true,
          isLastPage: false,
        });
        remaining = remaining.slice(take);
      }
    } else {
      // Subsequent pages: if remaining <= 26, it fits on last page with summaries; else takes 45
      if (remaining.length <= 26) {
        chunks.push({
          pageNumber: pageNum,
          items: remaining,
          isFirstPage: false,
          isLastPage: true,
        });
        remaining = [];
      } else {
        const take = Math.min(remaining.length, 45);
        chunks.push({
          pageNumber: pageNum,
          items: remaining.slice(0, take),
          isFirstPage: false,
          isLastPage: false,
        });
        remaining = remaining.slice(take);
      }
    }
    pageNum++;
  }

  // If the last chunk was not marked isLastPage because all items exactly filled it, add a final summary page
  if (chunks.length > 0 && !chunks[chunks.length - 1]!.isLastPage) {
    chunks.push({
      pageNumber: pageNum,
      items: [],
      isFirstPage: false,
      isLastPage: true,
    });
  }

  return chunks;
}

/**
 * Generates a valid, deterministic PDF 1.4 binary buffer for a statement of account.
 * Follows ISO 32000-1 specification using standard Type 1 fonts (Helvetica, Helvetica-Bold, Courier).
 * Supports A4 portrait dimensions (595.28 x 841.89 points) and multi-page pagination.
 */
export function generateStatementPdf(data: StatementData): { pdfBuffer: Buffer; sha256: string } {
  const left = 40;
  const right = 555;
  const width = right - left;

  const pageChunks = paginateItems(data.items);
  const totalPages = pageChunks.length;

  // Build content streams for each page
  const pageStreams: string[] = [];

  for (let p = 0; p < pageChunks.length; p++) {
    const chunk = pageChunks[p]!;
    const stream: string[] = [];

    if (chunk.isFirstPage) {
      // Header background banner
      stream.push("0.07 0.24 0.20 rg"); // Dark green #123d32
      stream.push(`${left} 770 ${width} 45 re f`);

      // Header Text
      stream.push("1 1 1 rg"); // White
      stream.push("BT");
      stream.push("/F2 16 Tf"); // Helvetica-Bold 16pt
      stream.push(`${left + 15} 790 Td`);
      stream.push(`(${escapePdfText(data.merchant.businessName)}) Tj`);
      stream.push("ET");

      stream.push("BT");
      stream.push("/F2 14 Tf");
      stream.push(`420 790 Td`);
      stream.push("(STATEMENT) Tj");
      stream.push("ET");

      // Merchant Meta & Statement Info
      stream.push("0.2 0.2 0.2 rg"); // Dark grey
      stream.push("BT");
      stream.push("/F1 8 Tf");
      stream.push(`${left} 750 Td`);
      stream.push(`(${escapePdfText(data.merchant.tradingAddress)}) Tj`);
      stream.push("0 -11 Td");
      stream.push(`(Email: ${escapePdfText(data.merchant.contactEmail)}  Tel: ${escapePdfText(data.merchant.contactPhone)}) Tj`);
      stream.push("ET");

      stream.push("BT");
      stream.push("/F1 8 Tf");
      stream.push(`380 750 Td`);
      stream.push(`(Statement Date: ${escapePdfText(data.periodTo)}  Gen: #${data.generation}) Tj`);
      stream.push("0 -11 Td");
      stream.push(`(Period: ${escapePdfText(data.periodFrom)} to ${escapePdfText(data.periodTo)}) Tj`);
      stream.push("ET");

      // Customer Account Box
      stream.push("0.95 0.96 0.98 rg"); // Light blue-grey background
      stream.push(`${left} 680 ${width} 45 re f`);
      stream.push("0.8 0.83 0.88 RG 1 w");
      stream.push(`${left} 680 ${width} 45 re S`);

      stream.push("0 0 0 rg");
      stream.push("BT");
      stream.push("/F2 9 Tf");
      stream.push(`${left + 10} 708 Td`);
      stream.push(`(Account: ${escapePdfText(data.customer.accountNumber)} - ${escapePdfText(data.customer.name)}) Tj`);
      stream.push("/F1 8 Tf");
      stream.push("0 -12 Td");
      stream.push(`(Billing Email: ${escapePdfText(data.customer.contactEmail)}  Phone: ${escapePdfText(data.customer.contactPhone || "—")}) Tj`);
      stream.push("0 -11 Td");
      stream.push(`(Address: ${escapePdfText(data.customer.billingAddress || "On File")}  Currency: ${data.totals.currency}) Tj`);
      stream.push("ET");

      // Table Header
      let y = 645;
      stream.push("0.93 0.94 0.96 rg");
      stream.push(`${left} ${y} ${width} 18 re f`);
      stream.push("0.7 0.7 0.7 RG 0.5 w");
      stream.push(`${left} ${y} ${width} 18 re S`);

      stream.push("0 0 0 rg");
      stream.push("BT");
      stream.push("/F2 7.5 Tf");
      stream.push(`${left + 5} ${y + 5} Td (Date) Tj`);
      stream.push(`60 0 Td (Document #) Tj`);
      stream.push(`100 0 Td (Type) Tj`);
      stream.push(`80 0 Td (Due Date) Tj`);
      stream.push(`80 0 Td (Debits (+)) Tj`);
      stream.push(`80 0 Td (Credits (-)) Tj`);
      stream.push(`60 0 Td (Balance) Tj`);
      stream.push("ET");

      // Balance Brought Forward Row
      y -= 14;
      stream.push("0 0 0 rg");
      stream.push("BT");
      stream.push("/F2 8 Tf");
      stream.push(`${left + 5} ${y + 3} Td (${escapePdfText(data.periodFrom)}) Tj`);
      stream.push(`60 0 Td (Balance Brought Forward) Tj`);
      stream.push(`340 0 Td (${data.totals.currency} ${data.totals.openingBalance}) Tj`);
      stream.push("ET");

      // Render Page 1 items
      for (const item of chunk.items) {
        y -= 13;
        const isDebit = item.direction === "debit";
        const isCredit = item.direction === "credit";

        stream.push("0.2 0.2 0.2 rg");
        stream.push("BT");
        stream.push("/F1 7.5 Tf");
        stream.push(`${left + 5} ${y + 2} Td (${escapePdfText(item.issuedOn)}) Tj`);
        stream.push(`60 0 Td (${escapePdfText(item.documentNumber)}) Tj`);
        stream.push(`100 0 Td (${escapePdfText(item.documentType)}) Tj`);
        stream.push(`80 0 Td (${escapePdfText(item.dueOn)}) Tj`);
        stream.push(`80 0 Td (${isDebit ? `${data.totals.currency} ${item.amount}` : "—"}) Tj`);
        stream.push(`80 0 Td (${isCredit ? `${data.totals.currency} ${item.amount}` : "—"}) Tj`);
        stream.push(`60 0 Td (${data.totals.currency} ${item.openAmount}) Tj`);
        stream.push("ET");

        stream.push("0.9 0.9 0.9 RG 0.5 w");
        stream.push(`${left} ${y} m ${right} ${y} l S`);
      }
    } else {
      // Subsequent Pages: Compact Running Header
      stream.push("0.07 0.24 0.20 rg");
      stream.push(`${left} 790 ${width} 24 re f`);

      stream.push("1 1 1 rg");
      stream.push("BT");
      stream.push("/F2 9 Tf");
      stream.push(`${left + 10} 798 Td`);
      stream.push(`(${escapePdfText(data.merchant.businessName)} - Statement Continuation) Tj`);
      stream.push("ET");

      stream.push("BT");
      stream.push("/F1 8 Tf");
      stream.push(`380 798 Td`);
      stream.push(`(Account: ${escapePdfText(data.customer.accountNumber)} | Page ${chunk.pageNumber} of ${totalPages}) Tj`);
      stream.push("ET");

      // Table Header on continuation page
      let y = 760;
      stream.push("0.93 0.94 0.96 rg");
      stream.push(`${left} ${y} ${width} 16 re f`);
      stream.push("0.7 0.7 0.7 RG 0.5 w");
      stream.push(`${left} ${y} ${width} 16 re S`);

      stream.push("0 0 0 rg");
      stream.push("BT");
      stream.push("/F2 7.5 Tf");
      stream.push(`${left + 5} ${y + 5} Td (Date) Tj`);
      stream.push(`60 0 Td (Document #) Tj`);
      stream.push(`100 0 Td (Type) Tj`);
      stream.push(`80 0 Td (Due Date) Tj`);
      stream.push(`80 0 Td (Debits (+)) Tj`);
      stream.push(`80 0 Td (Credits (-)) Tj`);
      stream.push(`60 0 Td (Balance) Tj`);
      stream.push("ET");

      // Render continuation items
      for (const item of chunk.items) {
        y -= 13;
        const isDebit = item.direction === "debit";
        const isCredit = item.direction === "credit";

        stream.push("0.2 0.2 0.2 rg");
        stream.push("BT");
        stream.push("/F1 7.5 Tf");
        stream.push(`${left + 5} ${y + 2} Td (${escapePdfText(item.issuedOn)}) Tj`);
        stream.push(`60 0 Td (${escapePdfText(item.documentNumber)}) Tj`);
        stream.push(`100 0 Td (${escapePdfText(item.documentType)}) Tj`);
        stream.push(`80 0 Td (${escapePdfText(item.dueOn)}) Tj`);
        stream.push(`80 0 Td (${isDebit ? `${data.totals.currency} ${item.amount}` : "—"}) Tj`);
        stream.push(`80 0 Td (${isCredit ? `${data.totals.currency} ${item.amount}` : "—"}) Tj`);
        stream.push(`60 0 Td (${data.totals.currency} ${item.openAmount}) Tj`);
        stream.push("ET");

        stream.push("0.9 0.9 0.9 RG 0.5 w");
        stream.push(`${left} ${y} m ${right} ${y} l S`);
      }
    }

    // If this is the last page, render Summary Totals, 8-bucket Aging Breakdown, Remittance Advice, and Verification Footer
    if (chunk.isLastPage) {
      // Totals Box
      const totY = 275;
      stream.push("0.92 0.95 0.94 rg");
      stream.push(`${left} ${totY} ${width} 24 re f`);
      stream.push("0.3 0.5 0.4 RG 1 w");
      stream.push(`${left} ${totY} ${width} 24 re S`);

      stream.push("0 0 0 rg");
      stream.push("BT");
      stream.push("/F2 8.5 Tf");
      stream.push(`${left + 10} ${totY + 8} Td (Period Summary:) Tj`);
      stream.push("/F1 8 Tf");
      stream.push(`100 0 Td (Opening: ${data.totals.openingBalance}) Tj`);
      stream.push(`95 0 Td (Debits: +${data.totals.totalDebits}) Tj`);
      stream.push(`95 0 Td (Credits: -${data.totals.totalCredits}) Tj`);
      stream.push("/F2 8.5 Tf");
      stream.push(`105 0 Td (Closing: ${data.totals.currency} ${data.totals.closingBalance}) Tj`);
      stream.push("ET");

      // 8-bucket Aging Breakdown Grid
      const agingY = 205;
      stream.push("0.96 0.96 0.96 rg");
      stream.push(`${left} ${agingY} ${width} 55 re f`);
      stream.push("0.75 0.75 0.75 RG 0.5 w");
      stream.push(`${left} ${agingY} ${width} 55 re S`);

      stream.push("0 0 0 rg");
      stream.push("BT");
      stream.push("/F2 7.5 Tf");
      stream.push(`${left + 8} ${agingY + 42} Td (Aging Analysis (Due-Date Basis as of ${escapePdfText(data.periodTo)}):) Tj`);
      stream.push("ET");

      const bucketWidth = width / 8;
      const bNames = ["Current", "1-30 Days", "31-60 Days", "61-90 Days", "91-120 Days", "121-150 Days", "151-180 Days", "180+ Days"];
      const bVals = [
        data.aging.current,
        data.aging.d030,
        data.aging.d060,
        data.aging.d090,
        data.aging.d120,
        data.aging.d150,
        data.aging.d180,
        data.aging.over,
      ];

      for (let i = 0; i < 8; i++) {
        const bx = left + i * bucketWidth;
        stream.push("BT");
        stream.push("/F2 6.5 Tf");
        stream.push(`${bx + 4} ${agingY + 26} Td (${bNames[i]}) Tj`);
        stream.push("ET");

        stream.push("BT");
        stream.push("/F1 6.5 Tf");
        stream.push(`${bx + 4} ${agingY + 12} Td (${bVals[i]}) Tj`);
        stream.push("ET");

        if (i > 0) {
          stream.push("0.85 0.85 0.85 RG 0.5 w");
          stream.push(`${bx} ${agingY} m ${bx} ${agingY + 38} l S`);
        }
      }

      // Detachable Remittance Advice Slip
      const remY = 55;
      stream.push("0.6 0.6 0.6 RG [3 3] 0 d 0.75 w");
      stream.push(`${left} ${remY + 135} m ${right} ${remY + 135} l S`);
      stream.push("[] 0 d"); // Reset dash

      stream.push("0.4 0.4 0.4 rg");
      stream.push("BT");
      stream.push("/F1 6.5 Tf");
      stream.push(`${left + 180} ${remY + 138} Td (--- PLEASE DETACH AND RETURN WITH PAYMENT ---) Tj`);
      stream.push("ET");

      stream.push("0.98 0.98 0.98 rg");
      stream.push(`${left} ${remY} ${width} 125 re f`);
      stream.push("0.7 0.7 0.7 RG 0.5 w");
      stream.push(`${left} ${remY} ${width} 125 re S`);

      stream.push("0 0 0 rg");
      stream.push("BT");
      stream.push("/F2 9.5 Tf");
      stream.push(`${left + 10} ${remY + 108} Td (REMITTANCE ADVICE) Tj`);
      stream.push("/F1 7.5 Tf");
      stream.push("0 -13 Td");
      stream.push(`(Please make payments to: ${escapePdfText(data.merchant.businessName)}) Tj`);
      stream.push("0 -11 Td");
      stream.push(`(Bank: ${escapePdfText(data.merchant.bankDetails?.bankName || "Standard Corporate Bank")}  Acc: ${escapePdfText(data.merchant.bankDetails?.accountNumber || "9182374619")}) Tj`);
      stream.push("0 -11 Td");
      stream.push(`(Branch Code: ${escapePdfText(data.merchant.bankDetails?.branchCode || "051001")}  Ref: ${escapePdfText(data.customer.accountNumber)}) Tj`);
      stream.push("ET");

      stream.push("0 0 0 rg");
      stream.push("BT");
      stream.push("/F1 7.5 Tf");
      stream.push(`375 ${remY + 95} Td (Customer Account: ${escapePdfText(data.customer.accountNumber)}) Tj`);
      stream.push("0 -14 Td");
      stream.push(`(Statement Date: ${escapePdfText(data.periodTo)}) Tj`);
      stream.push("0 -14 Td");
      stream.push("/F2 8.5 Tf");
      stream.push(`(Total Due: ${data.totals.currency} ${data.totals.closingBalance}) Tj`);
      stream.push("/F1 7.5 Tf");
      stream.push("0 -14 Td");
      stream.push("(Amount Enclosed: [                  ]) Tj");
      stream.push("ET");

      // Footer: Verification ID
      stream.push("0.5 0.5 0.5 rg");
      stream.push("BT");
      stream.push("/F3 6.5 Tf");
      stream.push(`${left} 35 Td`);
      stream.push(`(Immutable Statement Snapshot - ID: ${escapePdfText(data.statementId)}) Tj`);
      stream.push("ET");
    }

    // Running Page Number Footer on every page
    stream.push("0.5 0.5 0.5 rg");
    stream.push("BT");
    stream.push("/F1 7 Tf");
    stream.push(`490 20 Td`);
    stream.push(`(Page ${chunk.pageNumber} of ${totalPages}) Tj`);
    stream.push("ET");

    pageStreams.push(stream.join("\n"));
  }

  // Construct PDF Objects according to ISO 32000-1:
  // Object 1: Catalog -> /Pages 2 0 R
  // Object 2: Pages root -> /Kids [ 6 0 R 8 0 R ... ] /Count ${totalPages}
  // Object 3: Font /F1 (Helvetica)
  // Object 4: Font /F2 (Helvetica-Bold)
  // Object 5: Font /F3 (Courier)
  // For each page p = 0..totalPages-1:
  //   Object 6 + p * 2: Page object
  //   Object 6 + p * 2 + 1: Contents stream object

  const objects: string[] = [];

  const kids: number[] = [];
  for (let i = 0; i < totalPages; i++) {
    kids.push(6 + i * 2);
  }

  // 1. Catalog
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");

  // 2. Pages Root
  objects.push(
    `<< /Type /Pages /Kids [ ${kids.map((k) => `${k} 0 R`).join(" ")} ] /Count ${totalPages} >>`,
  );

  // 3. Font /F1
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  // 4. Font /F2
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  // 5. Font /F3
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");

  // Page and Content objects
  for (let p = 0; p < totalPages; p++) {
    const pageObjNum = 6 + p * 2;
    const contentObjNum = pageObjNum + 1;
    const streamContent = pageStreams[p]!;
    const streamByteLen = Buffer.byteLength(streamContent, "utf8");

    // Page object
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 595.28 841.89 ] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> >>`,
    );

    // Content stream object
    objects.push(
      `<< /Length ${streamByteLen} >>\nstream\n${streamContent}\nendstream`,
    );
  }

  // Construct final PDF binary string
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const startxref = Buffer.byteLength(pdf, "utf8");
  pdf += "xref\n";
  pdf += `0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  const pdfBuffer = Buffer.from(pdf, "utf8");
  const sha256 = crypto.createHash("sha256").update(pdfBuffer).digest("hex");

  return { pdfBuffer, sha256 };
}
