import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "./auth";
import { getI18n } from "./i18n";
import { invoicePdf, payslipPdf } from "./pdf";
import { payrollConfig, readPayslip } from "./payroll";
import { UserError } from "./ledger";
import { isUuid } from "./format";

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
    company: ctx.company, lang, vatRate: ctx.company.vatRegistered ? ctx.company.vatRate : 0,
    labels: {
      title: t("inv_invoice"), number: t("number"), date: t("date"), due: t("due_date"), billTo: t("pdf_bill_to"), description: t("description"),
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
    company: ctx.company, lang, month: run.month, row, components: payrollConfig(run.settings).components,
    labels: {
      title: t("payslip"), month: t("month"), employee: t("pdf_employee"), position: t("position"), gross: t("gross"),
      deductions: t("pdf_pay_lines"), other: t("deduction"), net: t("net"), employer: t("er_cost"), footer: t("pdf_footer"),
    },
  });
  const safe = row.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "payslip";
  return { pdf, row, month: run.month, filename: `payslip-${run.month}-${safe}.pdf` };
}
