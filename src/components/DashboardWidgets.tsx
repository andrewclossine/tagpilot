import Link from "next/link";
import { and, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { addDays, round2, today } from "@/lib/format";
import { balances, moneyAccounts } from "@/lib/ledger";

/**
 * The top of the Accounting dashboard: what needs doing, where the invoices stand (overdue, not yet due, paid in the
 * last 30 days), and each money account's balance.
 */
export async function DashboardWidgets({ ctx }: { ctx: Ctx }) {
  const { t, money, accName } = await getI18n();
  const db = await getDb();
  const cid = ctx.company.id, now = today(), month = addDays(now, -30), week = addDays(now, 7);
  const [open, paid, [billsDue], [draftInv], [draftBills], [drafts], [bankLines], [recurring], banks, bal] = await Promise.all([
    ctx.can("sales") ? db.select({ total: schema.invoices.total, paid: schema.invoices.amountPaid, due: schema.invoices.dueDate }).from(schema.invoices)
      .where(and(eq(schema.invoices.companyId, cid), inArray(schema.invoices.status, ["open", "partial"]))) : Promise.resolve([]),
    ctx.can("sales") ? db.select({ n: sql<string>`coalesce(sum(${schema.payments.amount}), 0)` }).from(schema.payments)
      .where(and(eq(schema.payments.companyId, cid), eq(schema.payments.kind, "receipt"), gte(schema.payments.date, month))) : Promise.resolve([{ n: "0" }]),
    ctx.can("purchases") ? db.select({ n: count(), sum: sql<string>`coalesce(sum(${schema.bills.total} - ${schema.bills.amountPaid}), 0)` }).from(schema.bills)
      .where(and(eq(schema.bills.companyId, cid), inArray(schema.bills.status, ["open", "partial"]), lte(schema.bills.dueDate, week))) : Promise.resolve([{ n: 0, sum: "0" }]),
    db.select({ n: count() }).from(schema.invoices).where(and(eq(schema.invoices.companyId, cid), eq(schema.invoices.status, "draft"))),
    db.select({ n: count() }).from(schema.bills).where(and(eq(schema.bills.companyId, cid), eq(schema.bills.status, "draft"))),
    db.select({ n: count() }).from(schema.journalEntries).where(and(eq(schema.journalEntries.companyId, cid), eq(schema.journalEntries.status, "draft"))),
    ctx.can("banking") ? db.select({ n: count() }).from(schema.bankLines).where(and(eq(schema.bankLines.companyId, cid), eq(schema.bankLines.status, "open"))) : Promise.resolve([{ n: 0 }]),
    db.select({ n: count() }).from(schema.recurringTemplates).where(and(eq(schema.recurringTemplates.companyId, cid), eq(schema.recurringTemplates.status, "active"), lte(schema.recurringTemplates.nextDate, now))),
    ctx.can("banking") ? moneyAccounts(db, cid) : Promise.resolve([]),
    balances(db, cid),
  ]);
  const overdue = round2(open.filter((i) => i.due < now).reduce((s, i) => s + i.total - i.paid, 0));
  const notDue = round2(open.filter((i) => i.due >= now).reduce((s, i) => s + i.total - i.paid, 0));
  const paidAmt = Number(paid[0]?.n ?? 0);
  const overdueN = open.filter((i) => i.due < now).length;
  const bar = Math.max(overdue + notDue + paidAmt, 1);
  const todo = [
    overdueN ? { label: t("db_todo_overdue").replace("{n}", String(overdueN)), href: "/sales/reminders" } : null,
    billsDue.n ? { label: t("db_todo_bills").replace("{n}", String(billsDue.n)).replace("{amount}", money(Number(billsDue.sum))), href: "/purchases/pay" } : null,
    bankLines.n ? { label: t("db_todo_bank").replace("{n}", String(bankLines.n)), href: "/banking" } : null,
    draftInv.n ? { label: t("db_todo_draft_inv").replace("{n}", String(draftInv.n)), href: "/sales/invoices?status=draft" } : null,
    draftBills.n ? { label: t("db_todo_draft_bills").replace("{n}", String(draftBills.n)), href: "/purchases/bills?status=draft" } : null,
    drafts.n ? { label: t("db_todo_drafts").replace("{n}", String(drafts.n)), href: "/journal?status=draft" } : null,
    recurring.n ? { label: t("db_todo_recurring").replace("{n}", String(recurring.n)), href: "/recurring" } : null,
  ].filter((x): x is { label: string; href: string } => !!x);
  const cur = ctx.company.currency;
  return (
    <div className="dash-top">
      <div className="panel stack">
        <h2>{t("db_todo")}</h2>
        {todo.length ? (
          <ul className="todo-list">{todo.map((x) => <li key={x.href}><Link href={x.href}>{x.label}</Link></li>)}</ul>
        ) : <div className="small muted">{t("db_todo_none")}</div>}
      </div>
      {ctx.can("sales") ? (
        <div className="panel stack">
          <div className="row"><h2 style={{ flex: 1 }}>{t("inv_title")}</h2><Link className="small" href="/sales/invoices?status=unpaid">{t("dash_open")} →</Link></div>
          <div className="inv-bar" aria-hidden="true">
            <span style={{ width: `${(overdue / bar) * 100}%`, background: "var(--bad)" }} />
            <span style={{ width: `${(notDue / bar) * 100}%`, background: "var(--warn, #b45309)" }} />
            <span style={{ width: `${(paidAmt / bar) * 100}%`, background: "var(--ok)" }} />
          </div>
          <div className="inv-legend">
            <Link href="/sales/reminders"><i style={{ background: "var(--bad)" }} />{t("db_overdue")}<b>{money(overdue)}</b></Link>
            <Link href="/sales/invoices?status=unpaid"><i style={{ background: "var(--warn, #b45309)" }} />{t("db_not_due")}<b>{money(notDue)}</b></Link>
            <Link href="/sales/payments"><i style={{ background: "var(--ok)" }} />{t("db_paid_30")}<b>{money(paidAmt)}</b></Link>
          </div>
          <div className="small muted">{cur}</div>
        </div>
      ) : null}
      {banks.length ? (
        <div className="panel stack">
          <div className="row"><h2 style={{ flex: 1 }}>{t("db_bank_accounts")}</h2><Link className="small" href="/banking">{t("dash_open")} →</Link></div>
          <table><tbody>{banks.map((a) => (
            <tr key={a.id}><td><Link className="rowlink" href={`/banking/${a.id}`}>{accName(a)}</Link>{a.currency ? <span className="small muted"> · {a.currency}</span> : null}</td>
              <td className="num"><b>{money(bal.get(a.id)?.net ?? 0)}</b></td></tr>
          ))}</tbody></table>
        </div>
      ) : null}
    </div>
  );
}
