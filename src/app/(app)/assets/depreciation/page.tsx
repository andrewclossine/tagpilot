import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { assetBalances, depreciationPlan } from "@/lib/assets";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { Empty, PageHead } from "@/components/ui";

export const metadata = { title: "Asset depreciation schedule" };

/** What each asset has lost so far and what is still to come, by year, with the IAS 16 method chosen for it. */
export default async function DepreciationSchedulePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("assets");
  const { t, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [assets, balances] = await Promise.all([
    db.select({ a: schema.fixedAssets, category: schema.assetCategories.name }).from(schema.fixedAssets)
      .innerJoin(schema.assetCategories, eq(schema.assetCategories.id, schema.fixedAssets.categoryId))
      .where(and(eq(schema.fixedAssets.companyId, ctx.company.id), eq(schema.fixedAssets.status, "active"))).orderBy(schema.fixedAssets.code),
    assetBalances(db, ctx.company.id),
  ]);
  const rows = assets.map(({ a, category }) => {
    const b = balances.get(a.id) ?? { cost: 0, accum: 0, carrying: 0 };
    const plan = depreciationPlan(a, b.carrying);
    return { a, category, b, plan };
  });
  const selected = rows.find((r) => r.a.id === q("asset")) ?? rows[0];
  const sum = (pick: (r: typeof rows[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  // Every asset's plan, added up by year: the charge the books should expect.
  const years = [...new Set(rows.flatMap((r) => r.plan.map((p) => p.year)))].sort((x, y) => x - y);
  return (
    <div className="stack">
      <PageHead title={t("dep_title")}>
        <Link className="btn ghost" href="/assets">{t("nav_asset_register")}</Link>
      </PageHead>
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("dep_help")}</p>
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("code")}</th><th>{t("name")}</th><th>{t("dep_method")}</th><th className="num">{t("dep_life")}</th><th className="num">{t("dep_cost")}</th><th className="num">{t("dep_accum")}</th><th className="num">{t("dep_carrying")}</th><th>{t("dep_booked_to")}</th><th>{t("dep_ends")}</th></tr></thead>
            <tbody>
              {rows.map(({ a, category, b, plan }) => (
                <tr key={a.id} style={a.id === selected?.a.id ? { background: "var(--accent-soft)" } : undefined}>
                  <td><Link className="rowlink" href={`/assets/depreciation?asset=${a.id}`}><code className="k">{a.code}</code></Link></td>
                  <td><Link className="rowlink" href={`/assets/depreciation?asset=${a.id}`}>{a.name}</Link><div className="small muted">{category}</div></td>
                  <td>{t(a.method === "reducing_balance" ? "dep_reducing" : "dep_straight")}{a.method === "reducing_balance" ? ` ${a.rate}%` : ""}</td>
                  <td className="num">{a.usefulLifeMonths}</td>
                  <td className="num">{money(b.cost, 2)}</td><td className="num">{money(b.accum, 2)}</td><td className="num">{money(b.carrying, 2)}</td>
                  <td>{a.depreciatedTo ?? ""}</td>
                  <td>{plan.at(-1)?.year ?? ""}</td>
                </tr>
              ))}
              <tr className="total"><td colSpan={4}>{t("total")}</td><td className="num">{money(sum((r) => r.b.cost), 2)}</td><td className="num">{money(sum((r) => r.b.accum), 2)}</td><td className="num">{money(sum((r) => r.b.carrying), 2)}</td><td colSpan={2} /></tr>
            </tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
      {selected ? (
        <div className="grid2">
          <div className="panel stack">
            <h2>{selected.a.code} · {selected.a.name}</h2>
            {selected.plan.length ? (
              <div className="tbl-wrap"><table>
                <thead><tr><th>{t("year")}</th><th className="num">{t("dep_opening")}</th><th className="num">{t("dep_charge")}</th><th className="num">{t("dep_closing")}</th></tr></thead>
                <tbody>{selected.plan.map((p) => <tr key={p.year}><td>{p.year}</td><td className="num">{money(p.opening, 2)}</td><td className="num">{money(p.charge, 2)}</td><td className="num">{money(p.closing, 2)}</td></tr>)}</tbody>
              </table></div>
            ) : <Empty>{t("dep_finished")}</Empty>}
            <div className="small muted">{t("dep_residual")}: {money(selected.a.residualValue, 2)}</div>
          </div>
          <div className="panel stack">
            <h2>{t("dep_all_assets")}</h2>
            {years.length ? (
              <div className="tbl-wrap"><table>
                <thead><tr><th>{t("year")}</th><th className="num">{t("dep_charge")}</th></tr></thead>
                <tbody>{years.map((y) => <tr key={y}><td>{y}</td><td className="num">{money(rows.reduce((s, r) => s + (r.plan.find((p) => p.year === y)?.charge ?? 0), 0), 2)}</td></tr>)}</tbody>
              </table></div>
            ) : <Empty>{t("dep_finished")}</Empty>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
