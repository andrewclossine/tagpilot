import Link from "next/link";
import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { balances, listAccounts } from "@/lib/ledger";
import { daysBetween, today } from "@/lib/format";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const ctx = await getCtx();
  const { t, money } = await getI18n();
  const db = await getDb();
  const cid = ctx.company.id, s = ctx.company.settings;
  const yearStart = `${today().slice(0, 4)}-01-01`;
  const [accounts, all, ytd, [drafts], recent, overdue] = await Promise.all([
    listAccounts(db, cid),
    balances(db, cid),
    balances(db, cid, { from: yearStart }),
    db.select({ n: count() }).from(schema.journalEntries).where(and(eq(schema.journalEntries.companyId, cid), eq(schema.journalEntries.status, "draft"))),
    db.select().from(schema.journalEntries).where(eq(schema.journalEntries.companyId, cid)).orderBy(desc(schema.journalEntries.createdAt)).limit(8),
    db.select({ inv: schema.invoices, customer: schema.partners.name }).from(schema.invoices)
      .innerJoin(schema.partners, eq(schema.partners.id, schema.invoices.partnerId))
      .where(and(eq(schema.invoices.companyId, cid), inArray(schema.invoices.status, ["open", "partial"]), lt(schema.invoices.dueDate, today())))
      .orderBy(schema.invoices.dueDate).limit(8),
  ]);
  const net = (m: typeof all, code: string) => { const a = accounts.find((x) => x.code === code); return a ? m.get(a.id)?.net ?? 0 : 0; };
  const cash = accounts.filter((a) => a.subtype === "bank" || a.subtype === "cash" || a.subtype === "momo").reduce((sum, a) => sum + (all.get(a.id)?.net ?? 0), 0);
  let result = 0;
  for (const a of accounts) if (a.type === "income" || a.type === "expense") result -= ytd.get(a.id)?.net ?? 0;
  const vat = -net(ytd, s.vatOut) - net(ytd, s.vatIn);

  const kpi = (label: string, value: string, href?: string) => (
    <div className="panel kpi"><div className="label">{label}</div><div className="v">{href ? <Link href={href} className="rowlink">{value}</Link> : value}</div></div>
  );
  return (
    <div className="stack">
      <PageHead title={`${t("dash_title")} · ${ctx.company.name}`} />
      <div className="kpis">
        {kpi(t("kpi_cash"), money(cash), "/banking")}
        {kpi(t("kpi_ar"), money(net(all, s.arAccount)), "/reports/ar")}
        {kpi(t("kpi_ap"), money(-net(all, s.apAccount)), "/reports/ap")}
        {kpi(t("kpi_result"), money(result), "/reports/pl")}
        {kpi(t("kpi_vat"), money(vat), "/reports/vat")}
        {kpi(t("kpi_drafts"), String(drafts.n), "/journal?status=draft")}
      </div>
      {ctx.canWrite ? (
        <div className="panel stack">
          <h2>{t("quick_actions")}</h2>
          <div className="row">
            <Link className="btn primary" href="/scan">{t("qa_scan")}</Link>
            <Link className="btn" href="/sales/invoices/new">{t("qa_invoice")}</Link>
            <Link className="btn" href="/purchases/bills/new">{t("qa_bill")}</Link>
            <Link className="btn" href="/journal/new">{t("qa_entry")}</Link>
          </div>
          {recent.length === 0 ? <div className="note info small">{t("welcome_steps")}</div> : null}
        </div>
      ) : null}
      <div className="grid2">
        <div className="panel stack">
          <h2>{t("recent_entries")}</h2>
          {recent.length ? (
            <table><tbody>
              {recent.map((e) => (
                <tr key={e.id}><td className="num" style={{ textAlign: "left" }}>{e.date}</td>
                  <td><Link className="rowlink" href={`/journal/${e.id}`}>{e.memo || "—"}</Link></td>
                  <td><Pill kind={e.status}>{t(e.status === "posted" ? "st_posted" : "st_draft")}</Pill></td></tr>
              ))}
            </tbody></table>
          ) : <Empty>{t("nothing_yet")}</Empty>}
        </div>
        <div className="panel stack">
          <h2>{t("overdue_invoices")}</h2>
          {overdue.length ? (
            <table><tbody>
              {overdue.map(({ inv, customer }) => (
                <tr key={inv.id}><td><Link className="rowlink" href={`/sales/invoices/${inv.id}`}>{inv.number}</Link><div className="small muted">{customer}</div></td>
                  <td className="small"><Pill kind="overdue">{daysBetween(inv.dueDate, today())} {t("days_overdue")}</Pill></td>
                  <td className="num">{money(inv.total - inv.amountPaid)}</td></tr>
              ))}
            </tbody></table>
          ) : <Empty>{t("nothing_yet")}</Empty>}
        </div>
      </div>
    </div>
  );
}
