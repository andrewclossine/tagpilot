import "server-only";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { getDb, schema } from "@/db";
import type { Ctx } from "./auth";
import { daysBetween, money as fmtMoney, round2, today } from "./format";
import { dict, type Key } from "./i18n-dict";
import { UserError } from "./ledger";
import { mailConfigured, sendMail } from "./mail";
import { buildInvoicePdf } from "./pdf-data";
import { audit } from "./audit";
import { runRecurring } from "./recurring";

/** Unpaid invoices past their due date, with the customer's email and how often they were reminded. */
export async function overdueInvoices(db: Db, companyId: string, on = today()) {
  const rows = await db.select({ d: schema.invoices, customer: schema.partners }).from(schema.invoices)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.invoices.partnerId))
    .where(and(eq(schema.invoices.companyId, companyId), inArray(schema.invoices.status, ["open", "partial"]), lt(schema.invoices.dueDate, on)))
    .orderBy(asc(schema.invoices.dueDate));
  return rows.map(({ d, customer }) => ({ d, customer, balance: round2(d.total - d.amountPaid), late: daysBetween(d.dueDate, on) }));
}

const html = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)).replace(/\n/g, "<br>");

/** Emails one overdue invoice to its customer as a reminder, with the invoice attached, in the organisation's language. */
export async function sendReminder(company: Ctx["company"], userId: string | null, invoiceId: string, lang: "en" | "fr" = "en") {
  if (!mailConfigured()) {
    if (process.env.NODE_ENV === "production") throw new UserError("err_mail_off");
  }
  const db = await getDb();
  const [row] = (await overdueInvoices(db, company.id)).filter((r) => r.d.id === invoiceId);
  if (!row) throw new UserError("err_not_found");
  if (!row.customer.email) throw new UserError("err_rem_no_email");
  const t = (k: Key) => dict[lang][k] ?? dict.en[k];
  const amount = `${fmtMoney(row.balance, lang, 2)} ${company.currency}`;
  const text = t("rem_mail_body").replace("{number}", row.d.number).replace("{amount}", amount).replace("{due}", row.d.dueDate).replace("{days}", String(row.late));
  const { pdf, filename } = await buildInvoicePdf({ company } as Ctx, invoiceId);
  await sendMail(row.customer.email, `${t("rem_mail_subject")} ${row.d.number} - ${company.name}`,
    `${t("reset_mail_hello")} ${row.customer.name},\n\n${text}\n\n${company.name}`,
    `<p>${t("reset_mail_hello")} ${html(row.customer.name)},</p><p>${html(text)}</p><p>${html(company.name)}</p>`,
    [{ filename, content: pdf, contentType: "application/pdf" }]);
  await db.update(schema.invoices).set({ remindedAt: new Date(), reminders: row.d.reminders + 1 }).where(eq(schema.invoices.id, invoiceId));
  await audit(db, company.id, userId, "remind", "invoice", row.d.number, { to: row.customer.email, balance: row.balance });
  return row.customer.email;
}

/**
 * The daily accounting run: recurring documents for every organisation, and automatic reminders where the
 * organisation asked for them (each overdue invoice at most once every so many days).
 */
export async function runDailyAccounting(db: Db) {
  const companies = (await db.select().from(schema.companies)).filter((c) => !c.suspendedAt && c.modules.includes("accounting"));
  let made = 0, failed = 0, reminded = 0;
  for (const c of companies) {
    const r = await runRecurring(db, c, null);
    made += r.made; failed += r.failed;
    const every = c.settings.reminderDays ?? 0;
    if (!every || !mailConfigured()) continue;
    for (const o of await overdueInvoices(db, c.id)) {
      if (!o.customer.email) continue;
      if (o.d.remindedAt && Date.now() - o.d.remindedAt.getTime() < every * 86400000 - 3600000) continue;
      try { await sendReminder(c, null, o.d.id); reminded++; } catch (e) { console.error("Reminder failed", o.d.number, e); }
    }
  }
  return { made, failed, reminded };
}
