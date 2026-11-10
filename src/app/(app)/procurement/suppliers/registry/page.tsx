import Link from "next/link";
import { getDb } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { registry } from "@/lib/suppliers";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead, Pill } from "@/components/ui";
import { addCategory, removeCategory, toggleRegistration } from "../actions";

export const metadata = { title: "Supplier register" };

/** Every supplier with its status, categories, documents and rating; the registration link; the categories. */
export default async function SupplierRegistryPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("procurement");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const { suppliers, categories } = await registry(db, ctx.company.id);
  const write = ctx.can("procurement", "write");
  const status = q("status"), category = q("category");
  const shown = suppliers.filter((s) => (!status || (s.p.supplierStatus ?? "approved") === status) && (!category || s.categories.some((c) => c.categoryId === category && c.status === "prequalified")));
  const base = process.env.APP_URL ?? "";
  const link = ctx.company.supplierRegCode ? `${base}/suppliers/register/${ctx.company.supplierRegCode}` : "";
  const waiting = suppliers.filter((s) => s.p.supplierStatus === "registered").length;
  return (
    <div className="stack">
      <PageHead title={t("reg_register_title")}>
        <Link className="btn" href="/procurement/suppliers">{t("nav_supplier_accounts")}</Link>
      </PageHead>
      <ErrorNote message={err(q("error"))} />

      <div className="grid2">
        <div className="panel stack">
          <h2>{t("reg_link_title")}</h2>
          <div className="small muted">{t("reg_link_help")}</div>
          {ctx.company.supplierRegOpen && link ? <div className="note ok small" style={{ wordBreak: "break-all" }}><b>{link}</b></div> : <div className="note info small">{t("reg_closed")}</div>}
          {write ? (
            <form action={toggleRegistration}>
              <input type="hidden" name="open" value={ctx.company.supplierRegOpen ? "0" : "1"} />
              <button type="submit" className={`btn ${ctx.company.supplierRegOpen ? "" : "primary"}`}>{t(ctx.company.supplierRegOpen ? "reg_close" : "reg_open")}</button>
            </form>
          ) : null}
        </div>
        <div className="panel stack" id="categories">
          <h2>{t("reg_categories_title")}</h2>
          {categories.length ? (
            <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }}>
              {categories.map((c) => (
                <li key={c.id} className="row small" style={{ gap: 8 }}>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  {write ? <form action={removeCategory}><input type="hidden" name="categoryId" value={c.id} /><ConfirmButton className="btn sm ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form> : null}
                </li>
              ))}
            </ul>
          ) : <div className="small muted">{t("reg_no_categories")}</div>}
          {write ? (
            <form action={addCategory} className="row" style={{ gap: 8 }}>
              <input name="name" required placeholder={t("reg_category_example")} aria-label={t("reg_category")} />
              <button type="submit" className="btn">{t("reg_add_category")}</button>
            </form>
          ) : null}
        </div>
      </div>

      {waiting ? <div className="note warn small">{t("reg_waiting").replace("{n}", String(waiting))} <Link href="?status=registered">{t("dash_open")} →</Link></div> : null}

      <form className="panel row" style={{ gap: 8 }}>
        <select name="status" defaultValue={status} aria-label={t("status")} style={{ width: "auto" }}>
          <option value="">{t("reg_all_statuses")}</option>
          {(["registered", "approved", "rejected", "suspended"] as const).map((s) => <option key={s} value={s}>{t(`sst_${s}`)}</option>)}
        </select>
        <select name="category" defaultValue={category} aria-label={t("reg_category")} style={{ width: "auto" }}>
          <option value="">{t("reg_all_categories")}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="submit" className="btn sm">{t("show")}</button>
      </form>

      <div className="panel">
        {shown.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("supplier")}</th><th>{t("tin")}</th><th>{t("status")}</th><th>{t("reg_categories_title")}</th><th>{t("reg_documents")}</th><th className="num">{t("reg_rating")}</th></tr></thead>
            <tbody>{shown.map(({ p, docFlag, rating, categories: cs }) => (
              <tr key={p.id}>
                <td><Link className="rowlink" href={`/procurement/suppliers/${p.id}`}><b>{p.name}</b></Link></td>
                <td>{p.tin}</td>
                <td><Pill kind={p.supplierStatus ?? "approved"}>{t(`sst_${p.supplierStatus ?? "approved"}`)}</Pill></td>
                <td className="small">{cs.map((c) => <span key={c.categoryId} style={{ marginRight: 8, color: c.status === "prequalified" ? "var(--ok)" : c.status === "rejected" ? "var(--bad)" : undefined }}>{c.name}{c.status === "pending" ? " (?)" : ""}</span>)}</td>
                <td className="small"><span style={{ color: docFlag === "valid" ? "var(--ok)" : docFlag === "expired" || docFlag === "rejected" ? "var(--bad)" : undefined }}>{t(`sdst_${docFlag}`)}</span></td>
                <td className="num">{rating ? `${rating.avg} ★ (${rating.count})` : "-"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
