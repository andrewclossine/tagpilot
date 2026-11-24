import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ensureAssetCategories } from "@/lib/setup";
import { assetPurchases } from "@/lib/assets";
import { today } from "@/lib/format";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { createAsset } from "../actions";
import { AccountField } from "@/components/AccountField";

export const metadata = { title: "New fixed asset" };

/**
 * Adding an asset starts with its class. The purchases already booked to that class's cost account (bills, bills
 * from tender orders, cheques) are listed with their date and cost without VAT; choosing one registers it from that
 * purchase, booking nothing new. An asset not bought that way is registered by hand and its cost booked.
 */
export default async function NewAssetPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("assets");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  await ensureAssetCategories(db, ctx.company.id);
  const [cats, projects, accounts] = await Promise.all([
    db.select().from(schema.assetCategories).where(eq(schema.assetCategories.companyId, ctx.company.id)).orderBy(schema.assetCategories.name),
    db.select().from(schema.projects).where(eq(schema.projects.companyId, ctx.company.id)).orderBy(schema.projects.code),
    db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id)).orderBy(schema.accounts.code),
  ]);
  const cat = cats.find((c) => c.id === q("class"));
  const purchases = cat ? await assetPurchases(db, ctx.company.id, cat) : [];
  const chosen = purchases.find((p) => p.lineId === q("line"));
  const manual = q("manual") === "1";
  const credit = accounts.filter((a) => a.type === "liability" || a.type === "equity" || ["bank", "cash", "momo"].includes(a.subtype ?? ""));
  const accountName = cat ? accounts.find((a) => a.code === cat.assetAccount) : undefined;
  const base = cat ? `/assets/new?class=${cat.id}` : "/assets/new";

  return (
    <div className="stack">
      <PageHead title={t("asset_new")}><Link className="btn ghost" href="/assets">{t("back")}</Link></PageHead>
      <ErrorNote message={err(q("error"))} />

      <form method="get" className="panel row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <label className="f" style={{ minWidth: 260 }}>{t("asset_category")}
          <select id="class" name="class" defaultValue={cat?.id ?? ""} required>
            <option value="" disabled>{t("choose")}</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.assetAccount} · {Math.round(c.usefulLifeMonths / 12 * 10) / 10} {t("years")}</option>)}
          </select></label>
        <button type="submit" className="btn primary">{t("asset_show_purchases")}</button>
        <span className="small muted" style={{ flexBasis: "100%" }}>{t("asset_class_help")}</span>
      </form>

      {cat && !chosen && !manual ? (
        <div className="panel stack">
          <h2>{t("asset_purchases_title")} · {cat.name} <span className="small muted">({cat.assetAccount}{accountName ? ` ${accountName.nameEn}` : ""})</span></h2>
          {purchases.length ? (
            <div className="tbl-wrap"><table>
              <thead><tr><th>{t("asset_purchase_date")}</th><th>{t("asset_document")}</th><th>{t("supplier")}</th><th>{t("description")}</th><th className="num">{t("asset_cost_ex_vat")}</th><th className="num">{t("asset_registered")}</th><th className="num">{t("asset_left")}</th><th /></tr></thead>
              <tbody>{purchases.map((p) => (
                <tr key={p.lineId}>
                  <td>{p.date}</td>
                  <td><Link className="rowlink" href={p.href}>{p.reference || t(`src_${p.source}` as never)}</Link><div className="small muted">{t(`src_${p.source}` as never)}</div></td>
                  <td>{p.supplier}</td><td>{p.description}</td>
                  <td className="num">{money(p.amount, 2)}</td><td className="num">{p.registered ? money(p.registered, 2) : ""}</td><td className="num"><b>{money(p.left, 2)}</b></td>
                  <td>{ctx.can("assets", "write") ? <Link className="btn sm primary" href={`${base}&line=${p.lineId}`}>{t("asset_register_this")}</Link> : null}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty>{t("asset_no_purchases")}</Empty>}
          {ctx.can("assets", "write") ? <div><Link className="btn" href={`${base}&manual=1`}>{t("asset_register_manual")}</Link> <span className="small muted">{t("asset_register_manual_help")}</span></div> : null}
        </div>
      ) : null}

      {cat && (chosen || manual) && ctx.can("assets", "write") ? (
        <form action={createAsset} className="panel stack">
          <input type="hidden" name="categoryId" value={cat.id} />
          {chosen ? <input type="hidden" name="sourceLineId" value={chosen.lineId} /> : null}
          {chosen ? (
            <div className="note info small">
              {t("asset_from_purchase")} <Link href={chosen.href}><b>{chosen.reference}</b></Link> · {chosen.date} · {chosen.supplier} · {money(chosen.left, 2)}. {t("asset_from_purchase_help")}
            </div>
          ) : null}
          <div className="fields">
            <label className="f">{t("name")}<input id="name" name="name" required defaultValue={chosen?.description ?? ""} /></label>
            <label className="f">{t("code")}<input id="code" name="code" placeholder="FA-0001" /></label>
            <label className="f">{t("asset_category")}<input value={cat.name} readOnly disabled /></label>
            <label className="f">{t("project")}
              <select id="projectId" name="projectId" defaultValue=""><option value="">{t("none")}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
            <label className="f">{t("asset_location")}<input id="location" name="location" /></label>
            <label className="f">{t("asset_serial")}<input id="serialNo" name="serialNo" /></label>
          </div>
          <div className="fields">
            <label className="f">{t("asset_acquired")}<input id="acquisitionDate" name="acquisitionDate" type="date" defaultValue={chosen?.date ?? today()} required /></label>
            <label className="f">{t("asset_available")}<input id="availableDate" name="availableDate" type="date" /></label>
            <label className="f">{chosen ? t("asset_cost_ex_vat") : t("asset_cost")}<input id="cost" name="cost" className="num" inputMode="decimal" required defaultValue={chosen ? String(chosen.left) : ""} />
              {chosen ? <span className="small muted">{t("asset_split_help")}</span> : null}</label>
            {chosen ? null : (
              <label className="f">{t("asset_paid_from")}
                <AccountField id="creditAccountId" name="creditAccountId" required accounts={credit} defaultValue={credit[0]?.id} /></label>
            )}
          </div>
          <div className="fields">
            <label className="f">{t("asset_method")}
              <select id="method" name="method" defaultValue={cat.method}><option value="straight_line">{t("straight_line")}</option><option value="reducing_balance">{t("reducing_balance")}</option></select></label>
            <label className="f">{t("asset_life_months")}<input id="usefulLifeMonths" name="usefulLifeMonths" className="num" inputMode="numeric" placeholder={String(cat.usefulLifeMonths)} /></label>
            <label className="f">{t("asset_rate")}<input id="rate" name="rate" className="num" inputMode="decimal" /></label>
            <label className="f">{t("asset_residual")}<input id="residualValue" name="residualValue" className="num" inputMode="decimal" defaultValue="0" /></label>
          </div>
          {chosen ? null : <div className="small muted">{t("asset_new_help")}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="btn primary">{t("save")}</button>
            <Link className="btn ghost" href={base}>{t("back")}</Link>
          </div>
        </form>
      ) : null}
    </div>
  );
}
