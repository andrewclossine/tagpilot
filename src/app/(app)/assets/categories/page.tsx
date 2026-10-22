import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ensureAssetCategories } from "@/lib/setup";
import { ErrorNote, PageHead } from "@/components/ui";
import { saveCategory } from "../actions";

export const metadata = { title: "Asset classes" };

export default async function CategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("assets");
  const { t, err, accName } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  await ensureAssetCategories(db, ctx.company.id);
  const [cats, accounts] = await Promise.all([
    db.select().from(schema.assetCategories).where(eq(schema.assetCategories.companyId, ctx.company.id)).orderBy(schema.assetCategories.name),
    db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id)).orderBy(schema.accounts.code),
  ]);
  const editing = cats.find((c) => c.id === q("edit"));
  const sel = (name: string, value: string | undefined, types: string[]) => (
    <select id={`c-${name}`} name={name} defaultValue={value ?? ""} required>
      <option value="">—</option>
      {accounts.filter((a) => types.includes(a.type)).map((a) => <option key={a.id} value={a.code}>{a.code} · {accName(a)}</option>)}
    </select>
  );
  return (
    <div className="stack">
      <PageHead title={t("asset_categories")}><Link className="btn ghost" href="/assets">{t("back")}</Link></PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      <div className="panel tbl-wrap"><table>
        <thead><tr><th>{t("name")}</th><th>{t("asset_method")}</th><th className="num">{t("asset_life_months")}</th><th>{t("account")}</th><th>{t("asset_accum")}</th><th>{t("depreciation")}</th><th /></tr></thead>
        <tbody>
          {cats.map((c) => (
            <tr key={c.id}><td><b>{c.name}</b></td><td>{t(c.method)}{c.method === "reducing_balance" ? ` · ${c.rate}%` : ""}</td><td className="num">{c.usefulLifeMonths}</td>
              <td><code className="k">{c.assetAccount}</code></td><td><code className="k">{c.accumDepAccount}</code></td><td><code className="k">{c.depExpenseAccount}</code></td>
              <td>{ctx.can("assets", "write") ? <a className="btn ghost sm" href={`/assets/categories?edit=${c.id}#cat`}>{t("edit")}</a> : null}</td></tr>
          ))}
        </tbody>
      </table></div>
      {ctx.can("assets", "write") ? (
        <form action={saveCategory} className="panel stack" id="cat" key={editing?.id ?? "new"}>
          <h2>{editing ? `${t("edit")}: ${editing.name}` : t("add")}</h2>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <div className="fields">
            <label className="f">{t("name")}<input id="c-name" name="name" defaultValue={editing?.name} required /></label>
            <label className="f">{t("asset_method")}<select id="c-method" name="method" defaultValue={editing?.method ?? "straight_line"}>
              <option value="straight_line">{t("straight_line")}</option><option value="reducing_balance">{t("reducing_balance")}</option></select></label>
            <label className="f">{t("asset_life_months")}<input id="c-life" name="usefulLifeMonths" className="num" defaultValue={editing?.usefulLifeMonths ?? 60} required /></label>
            <label className="f">{t("asset_rate")}<input id="c-rate" name="rate" className="num" defaultValue={editing?.rate ?? 0} /></label>
            <label className="f">{t("account")}{sel("assetAccount", editing?.assetAccount, ["asset"])}</label>
            <label className="f">{t("asset_accum")}{sel("accumDepAccount", editing?.accumDepAccount, ["asset"])}</label>
            <label className="f">{t("depreciation")}{sel("depExpenseAccount", editing?.depExpenseAccount, ["expense"])}</label>
          </div>
          <div className="row"><button type="submit" className="btn primary">{t("save")}</button>{editing ? <a className="btn ghost" href="/assets/categories">{t("cancel")}</a> : null}</div>
        </form>
      ) : null}
    </div>
  );
}
