"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail, withParam } from "@/lib/actions";
import { str } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { UserError } from "@/lib/ledger";
import { sendMail } from "@/lib/mail";
import { buildInvoicePdf, buildPayslipPdf } from "@/lib/pdf-data";
import { audit } from "@/lib/audit";

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const html = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)).replace(/\n/g, "<br>");

/** Emails the invoice PDF to the customer (or another address) with a short message. */
export async function sendInvoiceEmail(fd: FormData) {
  const ctx = await requireWrite("sales");
  const id = str(fd, "id"), back = `/sales/invoices/${id}`;
  const to = str(fd, "to").toLowerCase();
  const { t, money } = await getI18n();
  try {
    if (!isEmail(to)) throw new UserError("err_email_invalid");
    const { pdf, invoice, customer, filename } = await buildInvoicePdf(ctx, id);
    const balance = invoice.total - invoice.amountPaid;
    const message = str(fd, "message") || (balance > 0
      ? `${t("mail_invoice_body")} ${invoice.number} (${money(balance, 2)} ${ctx.company.currency}, ${t("due_date").toLowerCase()} ${invoice.dueDate}).`
      : `${t("mail_invoice_body")} ${invoice.number} (${money(invoice.total, 2)} ${ctx.company.currency}, ${t("st_paid").toLowerCase()}).`);
    await sendMail(to, `${t("inv_invoice")} ${invoice.number} - ${ctx.company.name}`,
      `${t("reset_mail_hello")} ${customer.name},\n\n${message}\n\n${ctx.company.name}`,
      `<p>${t("reset_mail_hello")} ${html(customer.name)},</p><p>${html(message)}</p><p>${html(ctx.company.name)}</p>`,
      [{ filename, content: pdf, contentType: "application/pdf" }]);
    const db = await getDb();
    await db.update(schema.invoices).set({ sentAt: new Date(), sentTo: to }).where(eq(schema.invoices.id, id));
    if (!customer.email) await db.update(schema.partners).set({ email: to }).where(eq(schema.partners.id, customer.id));
    await audit(db, ctx.company.id, ctx.user.id, "email", "invoice", invoice.number, { to });
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(withParam(back, "sent", to));
}

/** Emails each person in a payroll run their own payslip; people without an address are skipped and counted. */
export async function sendPayslipsEmail(fd: FormData) {
  const ctx = await requireWrite("payroll");
  const runId = str(fd, "runId");
  const only = fd.get("row") !== null ? Number(fd.get("row")) : null;
  const { t } = await getI18n();
  const db = await getDb();
  const [run] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, runId));
  const back = `/payroll?month=${run?.month ?? ""}`;
  let sent = 0, skipped = 0, failed = 0;
  try {
    if (!run || run.companyId !== ctx.company.id) throw new UserError("err_not_found");
    const indexes = only !== null ? [only] : run.rows.map((_, i) => i);
    for (const i of indexes) {
      const { pdf, row, filename } = await buildPayslipPdf(ctx, runId, i);
      if (!row.email || !isEmail(row.email)) { skipped++; continue; }
      try {
        await sendMail(row.email, `${t("payslip")} ${run.month} - ${ctx.company.name}`,
          `${t("reset_mail_hello")} ${row.name},\n\n${t("mail_payslip_body")} ${run.month}.\n\n${ctx.company.name}`,
          `<p>${t("reset_mail_hello")} ${html(row.name)},</p><p>${t("mail_payslip_body")} ${run.month}.</p><p>${html(ctx.company.name)}</p>`,
          [{ filename, content: pdf, contentType: "application/pdf" }]);
        sent++;
      } catch (e) { console.error("Payslip email failed", e); failed++; }
    }
    await audit(db, ctx.company.id, ctx.user.id, "email", "payslips", run.month, { sent, skipped, failed });
  } catch (e) { fail(e, back); }
  redirect(withParam(back, "mailed", `${sent}/${skipped}/${failed}`));
}
