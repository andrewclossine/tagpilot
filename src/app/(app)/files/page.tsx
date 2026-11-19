import Link from "next/link";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { folderFiles, myFolders } from "@/lib/myfiles";
import { PageHead } from "@/components/ui";
import { FolderIcon } from "./FolderIcon";

export const metadata = { title: "My Files" };

/** The folders of My Files, with how many files each holds this year. */
export default async function FilesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getCtx();
  const { t } = await getI18n();
  const q = await sp(searchParams);
  const thisYear = new Date().getFullYear();
  const year = /^\d{4}$/.test(q("year")) ? Number(q("year")) : thisYear;
  const folders = myFolders(ctx);
  const counts = await Promise.all(folders.map(async (f) => (await folderFiles(ctx, f.key, `${year}-01`, `${year}-12`)).length));
  return (
    <div className="stack">
      <PageHead title={t("mf_title")}>
        <div className="row" style={{ gap: 6 }}>
          <Link className="btn sm ghost" href={`/files?year=${year - 1}`} aria-label={t("mf_prev_year")}>←</Link>
          <b>{year}</b>
          {year < thisYear ? <Link className="btn sm ghost" href={`/files?year=${year + 1}`} aria-label={t("mf_next_year")}>→</Link> : null}
        </div>
      </PageHead>
      <div className="small muted">{t("mf_help")}</div>
      {folders.length ? (
        <div className="mf-grid">
          {folders.map((f, i) => (
            <Link key={f.key} href={`/files/${f.key}?year=${year}`} className="mf-folder">
              <FolderIcon />
              <b>{t(`mf_f_${f.key}` as never)}</b>
              <span className="small muted">{t("mf_count").replace("{n}", String(counts[i]))}</span>
            </Link>
          ))}
        </div>
      ) : <div className="note warn">{t("err_no_access")}</div>}
    </div>
  );
}
