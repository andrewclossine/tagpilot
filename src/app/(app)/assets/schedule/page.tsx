import Link from "next/link";
import { and, eq, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isIsoDate, lastDayOfMonth, round2, today } from "@/lib/format";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Asset movement schedule" };

type Line = { key: Key; values: number[]; strong?: boolean };

/**
 * The property, plant and equipment note required by IAS 16.73(e): a reconciliation of gross carrying amount and
 * accumulated depreciation from the start to the end of the period, one column per asset class.
 */
export default async function SchedulePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("assets");
  const { t, money } = await getI18n();
  const q = await sp(searchParams);
  const from = isIsoDate(q("from")) ? q("from") : `${today().slice(0, 4)}-01-01`;
  // Depreciation is dated at month end, so the default period runs to the end of the current month.
  const to = isIsoDate(q("to")) ? q("to") : lastDayOfMonth(today().slice(0, 7));
  const db = await getDb();
  const [cats, moves] = await Promise.all([
    db.select().from(schema.assetCategories).where(eq(schema.assetCategories.companyId, ctx.company.id)).orderBy(schema.assetCategories.name),
    db.select({ m: schema.assetMovements, categoryId: schema.fixedAssets.categoryId }).from(schema.assetMovements)
      .innerJoin(schema.fixedAssets, eq(schema.fixedAssets.id, schema.assetMovements.assetId))
      .where(and(eq(schema.assetMovements.companyId, ctx.company.id), lte(schema.assetMovements.date, to))),
  ]);
  const used = cats.filter((c) => moves.some((x) => x.categoryId === c.id));
  const cols = used.map((c) => c.id);
  const calc = (pick: (m: typeof moves[number]["m"]) => number, when: "before" | "in", types?: string[]) =>
    cols.map((cid) => round2(moves.filter((x) => x.categoryId === cid && (when === "before" ? x.m.date < from : x.m.date >= from)
      && (!types || types.includes(x.m.type))).reduce((s, x) => s + pick(x.m), 0)));
  const cost = (m: { cost: number }) => m.cost, dep = (m: { depreciation: number }) => m.depreciation;
  const add = (a: number[], ...rest: number[][]) => a.map((v, i) => round2(rest.reduce((s, r) => s + r[i], v)));

  const costOpen = calc(cost, "before"), costAdd = calc(cost, "in", ["acquisition", "addition"]), costReval = calc(cost, "in", ["revaluation"]), costDisp = calc(cost, "in", ["disposal"]);
  const costClose = add(costOpen, costAdd, costReval, costDisp);
  const depOpen = calc(dep, "before"), depCharge = calc(dep, "in", ["depreciation"]), depImp = calc(dep, "in", ["impairment"]);
  const depReval = calc(dep, "in", ["revaluation"]), depDisp = calc(dep, "in", ["disposal"]);
  const depClose = add(depOpen, depCharge, depImp, depReval, depDisp);
  const nbvOpen = costOpen.map((v, i) => round2(v - depOpen[i])), nbvClose = costClose.map((v, i) => round2(v - depClose[i]));

  const section = (title: Key, lines: Line[]) => (
    <>
      <tr className="sub"><td colSpan={cols.length + 2}>{t(title)}</td></tr>
      {lines.map((l) => (
        <tr key={l.key} className={l.strong ? "total" : undefined}>
          <td>{t(l.key)}</td>
          {l.values.map((v, i) => <td key={i} className="num">{v ? money(v) : "–"}</td>)}
          <td className="num"><b>{money(l.values.reduce((s, v) => s + v, 0))}</b></td>
        </tr>
      ))}
    </>
  );
  return (
    <div className="stack">
      <PageHead title={t("asset_schedule")}><Link className="btn ghost" href="/assets">{t("back")}</Link></PageHead>
      <form className="row noprint" method="get">
        <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{t("from")}<input type="date" id="from" name="from" defaultValue={from} style={{ width: "auto" }} /></label>
        <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{t("to")}<input type="date" id="to" name="to" defaultValue={to} style={{ width: "auto" }} /></label>
        <button type="submit" className="btn sm">{t("show")}</button>
      </form>
      <div className="panel stack">
        <h2>{t("asset_schedule")} <span className="small muted">· {ctx.company.name} · {from} → {to} · {ctx.company.currency} · IAS 16</span></h2>
        <div className="tbl-wrap"><table>
          <thead><tr><th /> {used.map((c) => <th key={c.id} className="num">{c.name}</th>)}<th className="num">{t("total")}</th></tr></thead>
          <tbody>
            {section("sch_cost", [
              { key: "sch_opening", values: costOpen }, { key: "sch_additions", values: costAdd }, { key: "sch_revaluation", values: costReval },
              { key: "sch_disposals", values: costDisp }, { key: "sch_closing", values: costClose, strong: true },
            ])}
            {section("sch_accum", [
              { key: "sch_opening", values: depOpen }, { key: "sch_charge", values: depCharge }, { key: "sch_impairment", values: depImp },
              { key: "sch_reval_elim", values: depReval }, { key: "sch_disposals", values: depDisp }, { key: "sch_closing", values: depClose, strong: true },
            ])}
            {section("sch_carrying", [{ key: "sch_opening", values: nbvOpen }, { key: "sch_closing", values: nbvClose, strong: true }])}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
