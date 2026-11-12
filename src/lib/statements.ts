import "server-only";
import { and, asc, eq, inArray, lte, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "./auth";
import { daysBetween, isIsoDate, isUuid, money as fmtMoney, round2 } from "./format";
import { getI18n } from "./i18n";
import { UserError } from "./ledger";
import { letterPdf } from "./pdf";
import { printedCompany } from "./pdf-data";

export type StatementRow = { date: string; type: "invoice" | "receipt" | "payment" | "credit_note"; number: string; details: string; charge: number; credit: number; balance: number; invoiceId: string };

/**
 * A customer's statement for a period: what they owed at the start, every invoice, payment and credit note in the
 * period with a running balance, and what they owe at the end, aged by due date. Drafts and voided invoices are left out.
 */
export async function customerStatement(companyId: string, partnerId: string, from: string, to: string) {
  if (!isUuid(partnerId) || !isIsoDate(from) || !isIsoDate(to) || from > to) throw new UserError("err_required");
  const db = await getDb();
  const [customer] = await db.select().from(schema.partners).where(and(eq(schema.partners.id, partnerId), eq(schema.partners.companyId, companyId)));
  if (!customer) throw new UserError("err_not_found");
  const invoices = await db.select().from(schema.invoices)
    .where(and(eq(schema.invoices.companyId, companyId), eq(schema.invoices.partnerId, partnerId), ne(schema.invoices.status, "draft"), ne(schema.invoices.status, "void"), lte(schema.invoices.date, to)))
    .orderBy(asc(schema.invoices.date), asc(schema.invoices.number));
  const ids = invoices.map((i) => i.id);
  const [pays, notes] = ids.length ? await Promise.all([
    db.select().from(schema.payments).where(and(inArray(schema.payments.invoiceId, ids), lte(schema.payments.date, to))).orderBy(asc(schema.payments.date)),
    db.select().from(schema.creditNotes).where(and(inArray(schema.creditNotes.invoiceId, ids), eq(schema.creditNotes.status, "posted"), lte(schema.creditNotes.date, to))).orderBy(asc(schema.creditNotes.date)),
  ]) : [[], []];
  const byId = new Map(invoices.map((i) => [i.id, i]));
  type Move = Omit<StatementRow, "balance">;
  const moves: Move[] = [
    ...invoices.map((i): Move => ({ date: i.date, type: i.docType === "receipt" ? "receipt" : "invoice", number: i.number, details: i.notes, charge: i.total, credit: 0, invoiceId: i.id })),
    ...pays.map((p): Move => ({ date: p.date, type: "payment", number: byId.get(p.invoiceId!)?.number ?? "", details: p.reference, charge: 0, credit: p.amount, invoiceId: p.invoiceId! })),
    ...notes.map((n): Move => ({ date: n.date, type: "credit_note", number: n.number, details: `${byId.get(n.invoiceId!)?.number ?? ""} ${n.reason}`.trim(), charge: 0, credit: n.total, invoiceId: n.invoiceId! })),
  ];
  const order = { invoice: 0, receipt: 0, credit_note: 1, payment: 2 } as const;
  moves.sort((a, b) => a.date.localeCompare(b.date) || order[a.type] - order[b.type] || a.number.localeCompare(b.number));
  const opening = round2(moves.filter((m) => m.date < from).reduce((s, m) => s + m.charge - m.credit, 0));
  let run = opening;
  const rows: StatementRow[] = moves.filter((m) => m.date >= from).map((m) => { run = round2(run + m.charge - m.credit); return { ...m, balance: run }; });
  // What is still open at the end, by how late it is.
  const settled = new Map<string, number>();
  for (const m of moves) if (m.credit) settled.set(m.invoiceId, round2((settled.get(m.invoiceId) ?? 0) + m.credit));
  const aging = [0, 0, 0, 0, 0];
  const open = invoices.map((i) => ({ i, left: round2(i.total - (settled.get(i.id) ?? 0)) })).filter((x) => x.left > 0.004);
  for (const { i, left } of open) {
    const d = daysBetween(i.dueDate, to);
    aging[d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4] += left;
  }
  return {
    customer, from, to, opening, rows, closing: run, aging: aging.map(round2),
    charges: round2(rows.reduce((s, r) => s + r.charge, 0)), credits: round2(rows.reduce((s, r) => s + r.credit, 0)),
    open: open.map(({ i, left }) => ({ id: i.id, number: i.number, date: i.date, dueDate: i.dueDate, left })),
  };
}

/** The statement as a PDF, ready to download or email. */
export async function buildStatementPdf(ctx: Ctx, partnerId: string, from: string, to: string) {
  const { t, lang } = await getI18n();
  const s = await customerStatement(ctx.company.id, partnerId, from, to);
  const m = (n: number) => (n ? fmtMoney(n, lang, 2).replace(/[  ]/g, " ") : "");
  const type = { invoice: t("inv_invoice"), receipt: t("sr_receipt"), payment: t("r_payment"), credit_note: t("cn_note") };
  const cur = ctx.company.currency;
  const aging = (["aging_current", "aging_30", "aging_60", "aging_90", "aging_over"] as const).map((k, i) => `${t(k)}: ${m(s.aging[i]) || "0"}`).join("   ");
  const pdf = await letterPdf({
    company: await printedCompany(ctx), title: t("stm_title"), footer: t("stm_footer"),
    lines: [[t("stm_period"), `${from} - ${to}`], [`${t("stm_balance_due")} (${cur})`, m(s.closing) || "0.00"]],
    addressee: [s.customer.name, s.customer.address, s.customer.tin ? `${t("tin")} ${s.customer.tin}` : ""].filter(Boolean).join("\n"),
    subject: `${t("stm_title")}: ${s.customer.name}`,
    body: `${t("stm_opening")}: ${m(s.opening) || "0.00"} ${cur}\n${aging}`,
    columns: [
      { label: t("date"), width: 62 }, { label: t("r_txn_type"), width: 78 }, { label: t("number"), width: 70 }, { label: t("description"), width: 105 },
      { label: t("stm_charges"), width: 60, align: "right" }, { label: t("stm_credits"), width: 60, align: "right" }, { label: t("balance"), width: 60, align: "right" },
    ],
    rows: [
      ...s.rows.map((r) => [r.date, type[r.type], r.number, r.details.slice(0, 60), m(r.charge), m(r.credit), m(r.balance) || "0.00"]),
      ["", "", "", t("stm_closing"), m(s.charges), m(s.credits), m(s.closing) || "0.00"],
    ],
  });
  return { pdf, statement: s, filename: `statement-${s.customer.name.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}-${to}.pdf` };
}
