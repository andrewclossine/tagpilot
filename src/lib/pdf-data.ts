import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "./auth";
import { getI18n } from "./i18n";
import { invoicePdf, payslipPdf } from "./pdf";
import { payrollConfig, readPayslip } from "./payroll";
import { UserError } from "./ledger";
import { isUuid } from "./format";
import { readAttachment } from "./storage";

/** The organisation as printed on documents, with its logo when it has one. */
export async function printedCompany(ctx: Pick<Ctx, "company">) {
  const db = await getDb();
  let logo: Buffer | null = null;
  if (ctx.company.logoAttachmentId) {
    const [a] = await db.select().from(schema.attachments).where(and(eq(schema.attachments.id, ctx.company.logoAttachmentId), eq(schema.attachments.companyId, ctx.company.id)));
    if (a) logo = await readAttachment(a.storagePath).catch(() => null);
  }
  return { ...ctx.company, logo };
}

/** A proforma as a PDF: laid out like an invoice, and clearly not one. */
export async function buildProformaPdf(ctx: Ctx, id: string) {
  if (!isUuid(id)) throw new UserError("err_not_found");
  const { t, lang } = await getI18n();
  const db = await getDb();
  const [p] = await db.select().from(schema.proformas).where(and(eq(schema.proformas.id, id), eq(schema.proformas.companyId, ctx.company.id)));
  if (!p) throw new UserError("err_not_found");
  const [customer] = await db.select().from(schema.partners).where(eq(schema.partners.id, p.partnerId));
  const lines = await db.select().from(schema.proformaLines).where(eq(schema.proformaLines.proformaId, id)).orderBy(schema.proformaLines.lineNo);
  const pdf = await invoicePdf({
    company: await printedCompany(ctx), lang, vatRate: ctx.company.vatRegistered ? ctx.company.vatRate : 0,
    labels: {
      title: t("pf_proforma"), number: t("number"), date: t("date"), due: t("pf_valid_until"), billTo: t("pdf_bill_to"), description: t("description"),
      qty: t("qty"), price: t("unit_price"), vat: t("vat"), amount: t("amount"), subtotal: t("subtotal"), total: t("total"),
      paid: t("amount_paid"), balance: t("balance_due"), notes: t("notes"), footer: t("pf_pdf_note"), tin: t("tin"),
    },
    invoice: { number: p.number, date: p.date, dueDate: p.validUntil, subtotal: p.subtotal, vat: p.vat, total: p.total, amountPaid: 0, notes: p.notes }, customer, lines,
  });
  return { pdf, filename: `${p.number}.pdf` };
}

/** The invoice as a PDF, with the data needed to email it. */
export async function buildInvoicePdf(ctx: Ctx, id: string) {
  if (!isUuid(id)) throw new UserError("err_not_found");
  const { t, lang } = await getI18n();
  const db = await getDb();
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.companyId, ctx.company.id)));
  if (!inv || inv.status === "draft" || inv.status === "void") throw new UserError("err_not_found");
  const [customer] = await db.select().from(schema.partners).where(eq(schema.partners.id, inv.partnerId));
  const lines = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id)).orderBy(schema.invoiceLines.lineNo);
  const pdf = await invoicePdf({
    company: await printedCompany(ctx), lang, vatRate: ctx.company.vatRegistered ? ctx.company.vatRate : 0,
    labels: {
      title: t(inv.docType === "receipt" ? "sr_receipt" : "inv_invoice"), number: t("number"), date: t("date"), due: t("due_date"), billTo: t("pdf_bill_to"), description: t("description"),
      qty: t("qty"), price: t("unit_price"), vat: t("vat"), amount: t("amount"), subtotal: t("subtotal"), total: t("total"),
      paid: t("amount_paid"), balance: t("balance_due"), notes: t("notes"), footer: t("pdf_footer"), tin: t("tin"),
    },
    invoice: inv, customer, lines,
  });
  return { pdf, invoice: inv, customer, filename: `${inv.number}.pdf` };
}

/** One person's payslip from a saved payroll run as a PDF. */
export async function buildPayslipPdf(ctx: Ctx, runId: string, index: number) {
  if (!isUuid(runId)) throw new UserError("err_not_found");
  const { t, lang } = await getI18n();
  const db = await getDb();
  const [run] = await db.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.id, runId), eq(schema.payrollRuns.companyId, ctx.company.id)));
  const raw = run?.rows[index];
  if (!run || !raw) throw new UserError("err_not_found");
  const row = readPayslip(raw);
  const pdf = await payslipPdf({
    company: await printedCompany(ctx), lang, month: run.month, row, components: payrollConfig(run.settings).components,
    labels: {
      title: t("payslip"), month: t("month"), employee: t("pdf_employee"), position: t("position"), gross: t("gross"),
      deductions: t("pdf_pay_lines"), other: t("deduction"), net: t("net"), employer: t("er_cost"), footer: t("pdf_footer"),
    },
  });
  const safe = row.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "payslip";
  return { pdf, row, month: run.month, filename: `payslip-${run.month}-${safe}.pdf` };
}
