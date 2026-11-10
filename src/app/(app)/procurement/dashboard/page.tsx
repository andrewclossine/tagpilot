import Link from "next/link";
import { getDb } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { procurementDashboard } from "@/lib/procurement-dashboard";
import { ColumnChart } from "@/components/charts";
import { Empty, PageHead } from "@/components/ui";

export const metadata = { title: "Procurement dashboard" };

/** One look at procurement: what waits, what is open, what was spent, and how long things take. */
export default async function ProcurementDashboard({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("procurement");
  const { t, money } = await getI18n();
  const q = await sp(searchParams);
  const thisYear = new Date().getFullYear();
  const year = Number(q("year")) >= 2000 && Number(q("year")) <= thisYear + 1 ? Number(q("year")) : thisYear;
  const db = await getDb();
  const d = await procurementDashboard(db, ctx, year);
  const cur = ctx.company.currency;
  const breakdown = (title: string, map: Map<string, number>, label: (k: string) => string, href: string) => {
    const total = [...map.values()].reduce((s, n) => s + n, 0);
    return (
      <div className="panel stack">
        <div className="row"><h2 style={{ flex: 1 }}>{title}</h2><Link className="small" href={href}>{t("dash_open")} →</Link></div>
        {total ? [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
          <div key={k} className="stack" style={{ gap: 2 }}>
            <div className="row small"><span style={{ flex: 1 }}>{label(k)}</span><b>{n}</b></div>
            <div className="meter" style={{ width: "100%" }}><i style={{ width: `${Math.round((n / total) * 100)}%` }} /></div>
          </div>
        )) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    );
  };
  const months = Array.from({ length: 12 }, (_, i) => new Date(year, i, 1).toLocaleString(undefined, { month: "short" }));
  return (
    <div className="stack">
      <PageHead title={t("dash_proc_title")}>
        <form className="row" style={{ gap: 6 }}>
          <select name="year" defaultValue={String(year)} aria-label={t("year")} style={{ width: "auto" }}>
            {Array.from({ length: 5 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type="submit" className="btn sm">{t("show")}</button>
        </form>
      </PageHead>
      <div className="kpis">
        <Link className="panel kpi" href="/procurement/requisitions" style={{ textDecoration: "none", color: "inherit" }}><div className="label">{t("dash_for_me")}</div><div className="v">{d.kpi.forMe}</div></Link>
        <div className="panel kpi"><div className="label">{t("dash_waiting_approval")}</div><div className="v">{d.kpi.waitingApproval}</div></div>
        <div className="panel kpi"><div className="label">{t("dash_active_requests")}</div><div className="v">{d.kpi.activeRequests}</div></div>
        <div className="panel kpi"><div className="label">{t("dash_open_orders")}</div><div className="v">{d.kpi.openOrders}</div></div>
        <div className="panel kpi"><div className="label">{t("dash_spend")} {year}</div><div className="v">{money(d.kpi.spend)}</div><div className="small muted">{cur}</div></div>
        <div className="panel kpi"><div className="label">{t("dash_committed")}</div><div className="v">{money(d.kpi.committed)}</div><div className="small muted">{t("dash_committed_help")}</div></div>
      </div>

      <div className="panel">
        <ColumnChart title={`${t("dash_spend_by_month")} (${cur})`} labels={months} series={[{ name: t("dash_spend"), color: "#2563eb", values: d.byMonth }]} />
      </div>

      <div className="grid3">
        {breakdown(t("rq_title"), d.requisitions, (k) => t(`rqs_${k as "draft"}`), "/procurement/requisitions")}
        {breakdown(t("nav_tenders"), d.tenders, (k) => t(`ts_${k as "draft"}`), "/procurement")}
        {breakdown(t("nav_purchase_orders"), d.orders, (k) => t(`po_st_${k as "draft"}`), "/procurement/orders")}
      </div>

      <div className="grid2">
        <div className="panel stack">
          <h2>{t("dash_top_suppliers")} {year}</h2>
          {d.topSuppliers.length ? (
            <div className="tbl-wrap"><table>
              <tbody>{d.topSuppliers.map((s) => <tr key={s.name}><td>{s.name}</td><td className="num">{money(s.amount, 2)}</td></tr>)}</tbody>
            </table></div>
          ) : <Empty>{t("nothing_yet")}</Empty>}
        </div>
        <div className="panel stack">
          <h2>{t("dash_cycle")}</h2>
          <div className="fields">
            <div><div className="label">{t("dash_approval_days")}</div><div className="v">{d.approvalDays ?? "-"}</div></div>
            <div><div className="label">{t("dash_award_days")}</div><div className="v">{d.awardDays ?? "-"}</div></div>
          </div>
          <h3>{t("dash_overdue")}</h3>
          {d.overdue.length ? (
            <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }}>
              {d.overdue.map((o) => <li key={o.id} className="small"><Link href={`/procurement/orders/${o.id}`}><b>{o.number}</b></Link> · {o.vendor} · {t("po_expected")} {o.expected} · {money(o.total, 2)}</li>)}
            </ul>
          ) : <div className="small muted">{t("dash_none_overdue")}</div>}
        </div>
      </div>
    </div>
  );
}
