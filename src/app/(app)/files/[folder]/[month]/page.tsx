import Link from "next/link";
import { notFound } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { folderArea, folderFiles, isFolder } from "@/lib/myfiles";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { UploadForm } from "../../UploadForm";
import { deleteUpload } from "../../actions";

export const metadata = { title: "My Files" };

/** One month of a folder: every file in it, to open or download one by one or all together, and to add to. */
export default async function MonthPage({ params, searchParams }: { params: Promise<{ folder: string; month: string }>; searchParams: SearchParams }) {
  const { folder, month } = await params;
  if (!isFolder(folder) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) notFound();
  const ctx = await getCtx();
  if (!ctx.can(folderArea(folder))) notFound();
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const files = await folderFiles(ctx, folder, month, month);
  const canWrite = ctx.can(folderArea(folder), "write");
  const year = Number(month.slice(0, 4));
  const title = `${t(`mf_f_${folder}` as never)} · ${t(`mf_m_${month.slice(5)}` as never)} ${year}`;
  return (
    <div className="stack">
      <PageHead title={title}>
        {files.length ? <a className="btn" href={`/api/files/zip?folder=${folder}&from=${month}&to=${month}`} download>{t("mf_download_month")}</a> : null}
        <Link className="btn ghost" href={`/files/${folder}?year=${year}`}>{t("back")}</Link>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      <div className="panel">
        {files.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("mf_name")}</th><th>{t("type")}</th><th>{t("date")}</th><th /></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td><a href={f.href} target="_blank" rel="noopener">{f.name}</a>{f.kind === "generated" ? <span className="small muted"> · PDF</span> : null}</td>
                  <td className="small">{t(f.label as never)}</td>
                  <td className="small">{f.date}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <a className="btn sm" href={f.href} download>{t("mf_download")}</a>
                    {f.recordHref ? <Link className="btn sm ghost" href={f.recordHref}>{t("open")}</Link> : null}
                    {f.uploadId && canWrite ? (
                      <form action={deleteUpload} style={{ display: "inline" }}><input type="hidden" name="id" value={f.uploadId} />
                        <ConfirmButton className="btn sm ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <Empty>{t("mf_empty")}</Empty>}
      </div>
      {canWrite ? <UploadForm t={t} folder={folder} year={year} month={month} /> : null}
    </div>
  );
}
