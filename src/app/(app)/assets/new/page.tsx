import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ensureAssetCategories } from "@/lib/setup";
import { today } from "@/lib/format";
import { ErrorNote, PageHead } from "@/components/ui";
import { createAsset } from "../actions";

export const metadata = { title: "New fixed asset" };

export default async function NewAssetPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("assets");
  const { t, err, accName } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  await ensureAssetCategories(db, ctx.company.id);
  const [cats, projects, accounts] = await Promise.all([
    db.select().from(schema.assetCategories).where(eq(schema.assetCategories.companyId, ctx.company.id)).orderBy(schema.assetCategories.name),
    db.select().from(schema.projects).where(eq(schema.projects.companyId, ctx.company.id)).orderBy(schema.projects.code),
    db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id)).orderBy(schema.accounts.code),
  ]);
  const credit = accounts.filter((a) => a.type === "liability" || a.type === "equity" || ["bank", "cash", "momo"].includes(a.subtype ?? ""));
  return (
    <div className="stack">
      <PageHead title={t("asset_new")}><Link className="btn ghost" href="/assets">{t("back")}</Link></PageHead>
      <ErrorNote message={err(q("error"))} />
      <form action={createAsset} className="panel stack">
        <div className="fields">
          <label className="f">{t("name")}<input id="name" name="name" required /></label>
          <label className="f">{t("code")}<input id="code" name="code" placeholder="FA-0001" /></label>
          <label className="f">{t("asset_category")}
            <select id="categoryId" name="categoryId" required>{cats.map((c) => <option key={c.id} value={c.id}>{c.name} · {Math.round(c.usefulLifeMonths / 12 * 10) / 10} {t("years")}</option>)}</select></label>
          <label className="f">{t("project")}
            <select id="projectId" name="projectId" defaultValue=""><option value="">{t("none")}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
          <label className="f">{t("asset_location")}<input id="location" name="location" /></label>
          <label className="f">{t("asset_serial")}<input id="serialNo" name="serialNo" /></label>
        </div>
        <div className="fields">
          <label className="f">{t("asset_acquired")}<input id="acquisitionDate" name="acquisitionDate" type="date" defaultValue={today()} required /></label>
          <label className="f">{t("asset_available")}<input id="availableDate" name="availableDate" type="date" /></label>
          <label className="f">{t("asset_cost")}<input id="cost" name="cost" className="num" inputMode="decimal" required /></label>
          <label className="f">{t("asset_paid_from")}
            <select id="creditAccountId" name="creditAccountId" required>{credit.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}</select></label>
        </div>
        <div className="fields">
          <label className="f">{t("asset_method")}
            <select id="method" name="method" defaultValue="straight_line"><option value="straight_line">{t("straight_line")}</option><option value="reducing_balance">{t("reducing_balance")}</option></select></label>
          <label className="f">{t("asset_life_months")}<input id="usefulLifeMonths" name="usefulLifeMonths" className="num" inputMode="numeric" placeholder={t("asset_life_default")} /></label>
          <label className="f">{t("asset_rate")}<input id="rate" name="rate" className="num" inputMode="decimal" /></label>
          <label className="f">{t("asset_residual")}<input id="residualValue" name="residualValue" className="num" inputMode="decimal" defaultValue="0" /></label>
        </div>
        <div className="small muted">{t("asset_new_help")}</div>
        <div><button type="submit" className="btn primary">{t("save")}</button></div>
      </form>
    </div>
  );
}
