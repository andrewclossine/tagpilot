import Link from "next/link";
import { notFound } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { folderArea, folderFiles, isFolder } from "@/lib/myfiles";
import { ErrorNote, PageHead } from "@/components/ui";
import { FolderIcon } from "../FolderIcon";
import { UploadForm } from "../UploadForm";

export const metadata = { title: "My Files" };

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

/** One folder for a year: a folder per month, how many files each holds, and the whole year as a zip. */
export default async function FolderPage({ params, searchParams }: { params: Promise<{ folder: string }>; searchParams: SearchParams }) {
  const { folder } = await params;
  if (!isFolder(folder)) notFound();
  const ctx = await getCtx();
  if (!ctx.can(folderArea(folder))) notFound();
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const thisYear = new Date().getFullYear();
  const year = /^\d{4}$/.test(q("year")) ? Number(q("year")) : thisYear;
  const files = await folderFiles(ctx, folder, `${year}-01`, `${year}-12`);
  const count = (m: string) => files.filter((f) => f.month === `${year}-${m}`).length;
  const name = t(`mf_f_${folder}` as never);
  return (
    <div className="stack">
      <PageHead title={`${name} · ${year}`}>
        <div className="row" style={{ gap: 6 }}>
          <Link className="btn sm ghost" href={`/files/${folder}?year=${year - 1}`} aria-label={t("mf_prev_year")}>←</Link>
          {year < thisYear ? <Link className="btn sm ghost" href={`/files/${folder}?year=${year + 1}`} aria-label={t("mf_next_year")}>→</Link> : null}
          <a className="btn" href={`/api/files/zip?folder=${folder}&from=${year}-01&to=${year}-12`} download>{t("mf_download_year").replace("{year}", String(year))}</a>
          <Link className="btn ghost" href={`/files?year=${year}`}>{t("back")}</Link>
        </div>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      <div className="small muted">{t(`mf_about_${folder}` as never)}</div>
      <div className="mf-grid">
        {MONTHS.map((m) => (
          <Link key={m} href={`/files/${folder}/${year}-${m}`} className={`mf-folder${count(m) ? "" : " empty"}`}>
            <FolderIcon size={44} />
            <b>{t(`mf_m_${m}` as never)}</b>
            <span className="small muted">{t("mf_count").replace("{n}", String(count(m)))}</span>
          </Link>
        ))}
      </div>
      {ctx.can(folderArea(folder), "write") ? <UploadForm t={t} folder={folder} year={year} /> : null}
    </div>
  );
}
