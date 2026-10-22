import Link from "next/link";
import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { balances, listAccounts } from "@/lib/ledger";
import { daysBetween, round2, today } from "@/lib/format";
import { Empty, PageHead, Pill } from "@/components/ui";
import { ColumnChart, LineChart } from "@/components/charts";

export const metadata = { title: "Dashboard" };

/** The last twelve months as YYYY-MM, oldest first. */
function lastMonths(n: number) {
  const d = new Date(), out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
}

export default async function Dashboard() {
  const ctx = await requireView("dashboard");
  const { t, lang, money } = await getI18n();
  const db = await getDb();
  const cid = ctx.company.id, s = ctx.company.settings;
  const months = lastMonths(12);
  const [accounts, all, ytd, [drafts], recent, overdue, monthly] = await Promise.all([
    listAccounts(db, cid),
    balances(db, cid),
    balances(db, cid, { from: `${today().slice(0, 4)}-01-01` }),
    db.select({ n: count() }).from(schema.journalEntries).where(and(eq(schema.journalEntries.companyId, cid), eq(schema.journalEntries.status, "draft"))),
    db.select().from(schema.journalEntries).where(eq(schema.journalEntries.companyId, cid)).orderBy(desc(schema.journalEntries.createdAt)).limit(6),
    db.select({ inv: schema.invoices, customer: schema.partners.name }).from(schema.invoices)
      .innerJoin(schema.partners, eq(schema.partners.id, schema.invoices.partnerId))
      .where(and(eq(schema.invoices.companyId, cid), inArray(schema.invoices.status, ["open", "partial"]), lt(schema.invoices.dueDate, today())))
      .orderBy(schema.invoices.dueDate).limit(6),
    // Movement per account and month over the last year, posted entries only.
    db.select({
      month: sql<string>`to_char(${schema.journalEntries.date}::date, 'YYYY-MM')`, accountId: schema.journalLines.accountId,
      net: sql<string>`sum(${schema.journalLines.debit} - ${schema.journalLines.credit})`,
    }).from(schema.journalLines).innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
      .where(and(eq(schema.journalLines.companyId, cid), eq(schema.journalEntries.status, "posted"), gte(schema.journalEntries.date, `${months[0]}-01`)))
      .groupBy(sql`1`, schema.journalLines.accountId),
  ]);
  const type = new Map(accounts.map((a) => [a.id, a]));
  const isMoney = (id: string) => ["bank", "cash", "momo"].includes(type.get(id)?.subtype ?? "");
  const byMonth = (pick: (accountId: string) => boolean, sign: number) =>
    months.map((m) => round2(monthly.filter((r) => r.month === m && pick(r.accountId)).reduce((sum, r) => sum + Number(r.net) * sign, 0)));
  const sales = byMonth((id) => type.get(id)?.type === "income", -1);
  const expenses = byMonth((id) => type.get(id)?.type === "expense", 1);
  // Cash at each month end: today's balance, rolled back through each later month's movement.
  const cashNow = accounts.filter((a) => isMoney(a.id)).reduce((sum, a) => sum + (all.get(a.id)?.net ?? 0), 0);
  const cashMove = byMonth(isMoney, 1);
  const cash = months.map((_, i) => round2(cashNow - cashMove.slice(i + 1).reduce((a, b) => a + b, 0)));

  const net = (code: string) => { const a = accounts.find((x) => x.code === code); return a ? all.get(a.id)?.net ?? 0 : 0; };
  let result = 0;
  for (const a of accounts) if (a.type === "income" || a.type === "expense") result -= ytd.get(a.id)?.net ?? 0;
  const thisM = sales[11], lastM = sales[10];
  const growth = lastM ? Math.round(((thisM - lastM) / Math.abs(lastM)) * 100) : null;
  const ytdSales = sales.reduce((a, b) => a + b, 0);

  // Biggest expense accounts this year.
  const topExp = accounts.filter((a) => a.type === "expense").map((a) => ({ a, v: ytd.get(a.id)?.net ?? 0 })).filter((x) => x.v > 0).sort((x, y) => y.v - x.v).slice(0, 5);
  const topMax = topExp[0]?.v ?? 1;

  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString(lang === "fr" ? "fr-FR" : "en-US", { month: "short", timeZone: "UTC" });
  const labels = months.map(monthLabel);
  const kpi = (label: string, value: string, href: string) => (
    <Link href={href} className="panel kpi" style={{ textDecoration: "none", color: "inherit" }}><div className="label">{label}</div><div className="v">{value}</div></Link>
  );
  const cur = ctx.company.currency;
  return (
    <div className="stack">
      <PageHead title={ctx.company.name}>
        {ctx.can("journal", "write") ? <Link className="btn primary" href="/scan">{t("qa_scan")}</Link> : null}
        {ctx.can("sales", "write") ? <Link className="btn" href="/sales/invoices/new">{t("qa_invoice")}</Link> : null}
        {ctx.can("purchases", "write") ? <Link className="btn" href="/purchases/bills/new">{t("qa_bill")}</Link> : null}
      </PageHead>

      <div className="grid2">
        <div className="panel stack" style={{ gap: 6 }}>
          <div className="label">{t("sales_this_month")} · {cur}</div>
          <div className="row" style={{ gap: 10 }}>
            <span className="hero-num">{money(thisM)}</span>
            {growth !== null ? <span className={`delta ${growth >= 0 ? "up" : "down"}`}>{growth >= 0 ? "▲" : "▼"} {Math.abs(growth)}% {t("vs_last_month")}</span> : null}
          </div>
          <div className="small muted">{t("last_12_months")}: {money(ytdSales)} · {t("kpi_result")}: {money(result)}</div>
        </div>
        <div className="kpis">
          {kpi(t("kpi_cash"), money(cashNow), "/banking")}
          {kpi(t("kpi_ar"), money(net(s.arAccount)), "/reports/ar")}
          {kpi(t("kpi_ap"), money(-net(s.apAccount)), "/reports/ap")}
          {kpi(t("kpi_drafts"), String(drafts.n), "/journal?status=draft")}
        </div>
      </div>

      <div className="grid2">
        <div className="panel stack">
          <h2>{t("chart_sales_expenses")}</h2>
          <ColumnChart title={t("chart_sales_expenses")} labels={labels} series={[
            { name: t("income"), color: "var(--chart-1)", values: sales },
            { name: t("expenses"), color: "var(--chart-2)", values: expenses },
          ]} />
        </div>
        <div className="panel stack">
          <h2>{t("chart_cash")}</h2>
          <LineChart labels={labels} values={cash} name={t("kpi_cash")} color="var(--chart-1)" />
        </div>
      </div>

      <div className="grid2">
        <div className="panel stack">
          <h2>{t("top_expenses")}</h2>
          {topExp.length ? (
            <div className="hbar">
              {topExp.map(({ a, v }) => [
                <span key={`${a.id}-n`}>{a.code} · {lang === "fr" && a.nameFr ? a.nameFr : a.nameEn}</span>,
                <b key={`${a.id}-v`} className="num">{money(v)}</b>,
                <div key={`${a.id}-b`} style={{ background: "var(--surface-2)", borderRadius: 4, gridColumn: "1 / -1" }}><div className="bar" style={{ width: `${Math.max(2, (v / topMax) * 100)}%` }} /></div>,
              ])}
            </div>
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
          <h2 style={{ marginTop: 8 }}>{t("recent_entries")}</h2>
          {recent.length ? (
            <table><tbody>
              {recent.map((e) => (
                <tr key={e.id}><td className="num" style={{ textAlign: "left" }}>{e.date}</td>
                  <td><Link className="rowlink" href={`/journal/${e.id}`}>{e.memo || "—"}</Link></td>
                  <td><Pill kind={e.status}>{t(e.status === "posted" ? "st_posted" : "st_draft")}</Pill></td></tr>
              ))}
            </tbody></table>
          ) : <div className="note info small">{t("welcome_steps")}</div>}
        </div>
      </div>
    </div>
  );
}
