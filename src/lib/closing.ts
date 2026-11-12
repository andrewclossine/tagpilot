import "server-only";
import { and, count, eq, gte, lte } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import { round2 } from "./format";
import { balances, listAccounts, UserError } from "./ledger";
import { audit } from "./audit";

/** The date the books are closed through: nothing dated on or before it can be posted. */
export async function closedThrough(db: Db | Tx, companyId: string): Promise<string | null> {
  const [c] = await db.select({ settings: schema.companies.settings }).from(schema.companies).where(eq(schema.companies.id, companyId));
  return c?.settings.closedThrough ?? null;
}

/** Refuses to post anything into a closed period. */
export async function assertOpen(db: Db | Tx, companyId: string, date: string) {
  const closed = await closedThrough(db, companyId);
  if (closed && date <= closed) throw new UserError("err_period_closed");
}

/**
 * Sets or clears the closing date. Only an administrator does it; moving it back (reopening a closed period) needs a
 * reason, and both are kept in the audit trail.
 */
export async function setClosingDate(tx: Tx, company: typeof schema.companies.$inferSelect, userId: string, date: string | null, reason: string) {
  const old = company.settings.closedThrough ?? null;
  if (old && (!date || date < old) && !reason) throw new UserError("err_close_reason");
  await tx.update(schema.companies).set({ settings: { ...company.settings, closedThrough: date ?? undefined } }).where(eq(schema.companies.id, company.id));
  await audit(tx, company.id, userId, date && (!old || date > old) ? "close_books" : "reopen_books", "company", company.name, { from: old, to: date, reason });
}

/** What to look at before closing a year: anything still in draft, unexplained bank lines, and the year's figures. */
export async function yearChecklist(db: Db, companyId: string, year: number) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [[drafts], [invoices], [bills], [bank], m, accounts] = await Promise.all([
    db.select({ n: count() }).from(schema.journalEntries).where(and(eq(schema.journalEntries.companyId, companyId), eq(schema.journalEntries.status, "draft"), gte(schema.journalEntries.date, from), lte(schema.journalEntries.date, to))),
    db.select({ n: count() }).from(schema.invoices).where(and(eq(schema.invoices.companyId, companyId), eq(schema.invoices.status, "draft"), gte(schema.invoices.date, from), lte(schema.invoices.date, to))),
    db.select({ n: count() }).from(schema.bills).where(and(eq(schema.bills.companyId, companyId), eq(schema.bills.status, "draft"), gte(schema.bills.date, from), lte(schema.bills.date, to))),
    db.select({ n: count() }).from(schema.bankLines).where(and(eq(schema.bankLines.companyId, companyId), eq(schema.bankLines.status, "open"), gte(schema.bankLines.date, from), lte(schema.bankLines.date, to))),
    balances(db, companyId, { from, to }),
    listAccounts(db, companyId),
  ]);
  const of = (type: string) => round2(accounts.filter((a) => a.type === type).reduce((s, a) => s + (m.get(a.id)?.net ?? 0), 0));
  const income = round2(-of("income")), expenses = of("expense");
  const debits = round2([...m.values()].reduce((s, v) => s + v.debit, 0)), credits = round2([...m.values()].reduce((s, v) => s + v.credit, 0));
  return {
    from, to, drafts: drafts.n, draftInvoices: invoices.n, draftBills: bills.n, openBankLines: bank.n,
    income, expenses, result: round2(income - expenses), balanced: Math.abs(debits - credits) < 0.01,
  };
}
