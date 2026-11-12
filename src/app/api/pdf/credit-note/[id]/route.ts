import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { isUuid, money as fmtMoney } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { letterPdf } from "@/lib/pdf";
import { printedCompany } from "@/lib/pdf-data";

/** A credit note as a PDF: to a customer, or the record of one received from a supplier. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  const { id } = await params;
  const notFound = new Response("Not found", { status: 404 });
  if (!isUuid(id)) return notFound;
  const db = await getDb();
  const [n] = await db.select().from(schema.creditNotes).where(and(eq(schema.creditNotes.id, id), eq(schema.creditNotes.companyId, ctx.company.id)));
  if (!n || !ctx.can(n.kind === "invoice" ? "sales" : "purchases")) return notFound;
  const { t, lang } = await getI18n();
  const [[partner], lines, [doc]] = await Promise.all([
    db.select().from(schema.partners).where(eq(schema.partners.id, n.partnerId)),
    db.select().from(schema.creditNoteLines).where(eq(schema.creditNoteLines.creditNoteId, id)).orderBy(schema.creditNoteLines.lineNo),
    n.kind === "invoice" ? db.select({ number: schema.invoices.number }).from(schema.invoices).where(eq(schema.invoices.id, n.invoiceId!))
      : db.select({ number: schema.bills.number }).from(schema.bills).where(eq(schema.bills.id, n.billId!)),
  ]);
  const m = (x: number) => fmtMoney(x, lang, 2).replace(/[  ]/g, " ");
  const pdf = await letterPdf({
    company: await printedCompany(ctx), title: t(n.kind === "invoice" ? "cn_note" : "cn_supplier_note"), footer: t("pdf_footer"),
    lines: [[t("number"), n.number], [t("date"), n.date], [t(n.kind === "invoice" ? "inv_invoice" : "bill_bill"), doc?.number ?? ""], ...(n.supplierRef ? [[t("cn_supplier_ref"), n.supplierRef] as [string, string]] : [])],
    addressee: [partner?.name, partner?.address, partner?.tin ? `${t("tin")} ${partner.tin}` : ""].filter(Boolean).join("\n"),
    subject: `${t("cn_reason")}: ${n.reason}${n.status === "void" ? ` (${t("st_void")})` : ""}`, body: "",
    columns: [{ label: t("description"), width: 375 }, { label: `${t("amount")} (${ctx.company.currency})`, width: 120, align: "right" }],
    rows: [...lines.map((l) => [l.description, m(l.amount)]), [t("subtotal"), m(n.subtotal)], [t("vat"), m(n.vat)], [t("total"), m(n.total)]],
  });
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${n.number}.pdf"`, "Cache-Control": "private, no-store" } });
}
