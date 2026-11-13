import Link from "next/link";
import { getDb } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isIsoDate, round2, today } from "@/lib/format";
import { valuationAt } from "@/lib/manufacturing";
import type { StockClass } from "@/db/schema";
import { PageHead } from "@/components/ui";
import { InventoryTabs } from "../InventoryTabs";

export const metadata = { title: "Inventory valuation" };

const CLASSES: StockClass[] = ["raw", "finished", "goods"];

/** What is in stock on a date, at weighted average cost: raw materials, work in progress, finished goods and goods for resale. */
export default async function ValuationPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("inventory");
  const { t, money } = await getI18n();
  const q = await sp(searchParams);
  const date = isIsoDate(q("date")) ? q("date") : today();
  const db = await getDb();
  const { rows, wip } = await valuationAt(db, ctx.company.id, date);
  const wipTotal = round2(wip.reduce((s, o) => s + o.materialsCost, 0));
  const byClass = CLASSES.map((c) => ({ c, list: rows.filter((r) => r.stockClass === c && (r.qty || r.value)) }));
  const total = round2(rows.reduce((s, r) => s + r.value, 0) + wipTotal);
  const sum = (list: typeof rows) => round2(list.reduce((s, r) => s + r.value, 0));
  return (
    <div className="stack">
      <PageHead title={t("val_title")} />
      <InventoryTabs t={t} current="valuation" />
      <form className="row" style={{ gap: 10, alignItems: "flex-end" }}>
        <label className="f" style={{ maxWidth: 200 }}>{t("val_as_of")}<input id="val-date" name="date" type="date" defaultValue={date} /></label>
        <button type="submit" className="btn">{t("show")}</button>
      </form>
      <div className="kpis">
        {byClass.map(({ c, list }) => <div key={c} className="panel kpi"><div className="label">{t(`sc_${c}`)}</div><div className="v">{money(sum(list))}</div></div>)}
        <div className="panel kpi"><div className="label">{t("mo_wip")}</div><div className="v">{money(wipTotal)}</div></div>
      </div>
      <div className="panel tbl-wrap">
        <table>
          <thead><tr><th>{t("sku")}</th><th>{t("name")}</th><th>{t("inv_account")}</th><th className="num">{t("on_hand")}</th><th className="num">{t("avg_cost")}</th><th className="num">{t("stock_value")}</th></tr></thead>
          <tbody>
            {byClass.filter(({ list }) => list.length).map(({ c, list }) => [
              <tr key={c} className="sub"><td colSpan={5}>{t(`sc_${c}`)}</td><td className="num">{money(sum(list))}</td></tr>,
              ...list.map((r) => (
                <tr key={r.id}>
                  <td><code className="k">{r.sku}</code></td>
                  <td><Link className="rowlink" href={`/inventory/${r.id}`}>{r.name}</Link></td>
                  <td className="small">{r.account}</td>
                  <td className="num">{r.qty} {r.unit}</td>
                  <td className="num">{money(r.cost, 2)}</td>
                  <td className="num">{money(r.value)}</td>
                </tr>
              )),
            ])}
            {wip.length ? [
              <tr key="wip" className="sub"><td colSpan={5}>{t("mo_wip")}</td><td className="num">{money(wipTotal)}</td></tr>,
              ...wip.map((o) => (
                <tr key={o.id}><td><Link href={`/inventory/production/${o.id}`}><code className="k">{o.number}</code></Link></td><td colSpan={4} className="small muted">{t("mo_started")} {o.startDate}</td><td className="num">{money(o.materialsCost)}</td></tr>
              )),
            ] : null}
            <tr className="total"><td colSpan={5}>{t("total")}</td><td className="num">{money(total)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="small muted">{t("val_help")}</div>
    </div>
  );
}
