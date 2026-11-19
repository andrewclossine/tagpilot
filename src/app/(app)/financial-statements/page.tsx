import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { Empty, ErrorNote, PageHead, Pill } from "@/components/ui";
import { ConfirmButton } from "@/components/editors";
import { deleteFsDraft, generateFs } from "./actions";

export const metadata = { title: "Financial statements" };

/** Every set of financial statements drafted so far, and the form that drafts a new one from the trial balance. */
export default async function FsListPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("reports");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const drafts = await db.select().from(schema.fsDrafts).where(eq(schema.fsDrafts.companyId, ctx.company.id)).orderBy(desc(schema.fsDrafts.periodTo), desc(schema.fsDrafts.createdAt));
  const canEdit = ctx.can("journal", "write");
  // The last full calendar year is the usual one to report on.
  const year = new Date().getFullYear() - 1;
  return (
    <div className="stack">
      <PageHead title={t("fs_title")} />
      <div className="small muted">{t("fs_help")}</div>
      <ErrorNote message={err(q("error"))} />
      {canEdit ? (
        <form action={generateFs} className="panel stack">
          <h2>{t("fs_generate")}</h2>
          <div className="fields">
            <label className="f">{t("from")}<input id="fs-from" name="periodFrom" type="date" defaultValue={`${year}-01-01`} required /></label>
            <label className="f">{t("to")}<input id="fs-to" name="periodTo" type="date" defaultValue={`${year}-12-31`} required /></label>
            <label className="f">{t("fs_framework")}<select id="fs-fw" name="framework" defaultValue="ifrs_sme"><option value="ifrs_sme">{t("fs_fw_sme")}</option><option value="ifrs">{t("fs_fw_ifrs")}</option></select></label>
            <label className="f">{t("fs_doc_title")}<input id="fs-title" name="title" placeholder={`${t("fs_title")} ${year}`} /></label>
          </div>
          <label className="row small" style={{ gap: 8 }}><input id="fs-cmp" type="checkbox" name="comparative" value="1" defaultChecked style={{ width: "auto" }} /> {t("fs_comparative")}</label>
          <div className="small muted">{t("fs_generate_help")}</div>
          <div className="small muted">{t("fs_keep_ten")}</div>
          <div><button type="submit" className="btn primary">{t("fs_generate_btn")}</button></div>
        </form>
      ) : null}
      <div className="panel">
        {drafts.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("fs_doc_title")}</th><th>{t("from")}</th><th>{t("to")}</th><th>{t("fs_framework")}</th><th>{t("status")}</th><th>{t("fs_updated")}</th><th /></tr></thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id} className="click">
                  <td><Link className="rowlink" href={`/financial-statements/${d.id}`}>{d.title}</Link></td>
                  <td>{d.periodFrom}</td><td>{d.periodTo}</td>
                  <td className="small">{t(d.framework === "ifrs" ? "fs_fw_ifrs" : "fs_fw_sme")}</td>
                  <td><Pill kind={d.status === "final" ? "final" : "draft"}>{t(d.status === "final" ? "fs_final" : "fs_draft")}</Pill></td>
                  <td className="small">{d.updatedAt.toISOString().slice(0, 10)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <a className="btn sm" href={`/api/pdf/fs/${d.id}`} download>{t("pdf_download")}</a>
                    {canEdit ? (
                      <form action={deleteFsDraft} style={{ display: "inline", marginLeft: 6 }}>
                        <input type="hidden" name="id" value={d.id} />
                        <ConfirmButton className="btn sm ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <Empty>{t("fs_none")}</Empty>}
      </div>
    </div>
  );
}
