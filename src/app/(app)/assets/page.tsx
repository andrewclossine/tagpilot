import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { assetBalances } from "@/lib/assets";
import { ensureAssetCategories } from "@/lib/setup";
import { today } from "@/lib/format";
import { Empty, ErrorNote, PageHead, Pill } from "@/components/ui";
import { depreciate } from "./actions";

export const metadata = { title: "Fixed assets" };

export default async function AssetsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("assets");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  await ensureAssetCategories(db, ctx.company.id);
  const [assets, cats, bal] = await Promise.all([
    db.select().from(schema.fixedAssets).where(eq(schema.fixedAssets.companyId, ctx.company.id)).orderBy(desc(schema.fixedAssets.acquisitionDate)),
    db.select().from(schema.assetCategories).where(eq(schema.assetCategories.companyId, ctx.company.id)),
    assetBalances(db, ctx.company.id),
  ]);
  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? "";
  const sum = (k: "cost" | "accum" | "carrying") => assets.reduce((s, a) => s + (bal.get(a.id)?.[k] ?? 0), 0);
  const canEdit = ctx.can("assets", "write");
  return (
    <div className="stack">
      <PageHead title={t("nav_assets")}>
        <Link className="btn" href="/assets/schedule">{t("asset_schedule")}</Link>
        <Link className="btn" href="/assets/categories">{t("asset_categories")}</Link>
        {canEdit ? <Link className="btn primary" href="/assets/new">{t("asset_new")}</Link> : null}
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("dep") ? <div className="note ok small">{t("depreciation_done")} {q("dep")}</div> : null}
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("asset_cost")}</div><div className="v">{money(sum("cost"))}</div></div>
        <div className="panel kpi"><div className="label">{t("asset_accum")}</div><div className="v">{money(sum("accum"))}</div></div>
        <div className="panel kpi"><div className="label">{t("asset_nbv")}</div><div className="v">{money(sum("carrying"))}</div></div>
      </div>
      {canEdit ? (
        <form action={depreciate} className="panel row">
          <div style={{ flex: 1, minWidth: 220 }}><h3>{t("run_depreciation")}</h3><div className="small muted">{t("run_depreciation_help")}</div></div>
          <input type="month" id="dep-month" name="month" defaultValue={today().slice(0, 7)} style={{ width: "auto" }} aria-label={t("month")} />
          <button type="submit" className="btn primary">{t("run_depreciation")}</button>
        </form>
      ) : null}
      <div className="panel">
        {assets.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("code")}</th><th>{t("name")}</th><th>{t("asset_category")}</th><th>{t("asset_acquired")}</th>
              <th className="num">{t("asset_cost")}</th><th className="num">{t("asset_accum")}</th><th className="num">{t("asset_nbv")}</th><th>{t("asset_dep_to")}</th><th>{t("status")}</th></tr></thead>
            <tbody>
              {assets.map((a) => {
                const b = bal.get(a.id) ?? { cost: 0, accum: 0, carrying: 0 };
                return (
                  <tr key={a.id} className="click">
                    <td><code className="k">{a.code}</code></td>
                    <td><Link className="rowlink" href={`/assets/${a.id}`}>{a.name}</Link>{a.location ? <div className="small muted">{a.location}</div> : null}</td>
                    <td>{catName(a.categoryId)}</td><td className="num" style={{ textAlign: "left" }}>{a.acquisitionDate}</td>
                    <td className="num">{money(b.cost)}</td><td className="num">{money(b.accum)}</td><td className="num"><b>{money(b.carrying)}</b></td>
                    <td className="small muted">{a.depreciatedTo ?? "—"}</td>
                    <td><Pill kind={a.status === "active" ? "posted" : "void"}>{t(a.status === "active" ? "active" : "asset_disposed")}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
