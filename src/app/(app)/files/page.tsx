import Link from "next/link";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { folderFiles, myFolders } from "@/lib/myfiles";
import { PageHead } from "@/components/ui";
import { getDb } from "@/db";
import { storageLimit, storageUsed } from "@/lib/storage";
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
  // Storage used against the My Files package.
  const db = await getDb();
  const [used, limit] = await Promise.all([storageUsed(db, ctx.company.id), storageLimit(db, ctx.company.id)]);
  const size = (b: number) => (b >= 1024 ** 4 ? `${(b / 1024 ** 4).toFixed(2)} TB` : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`);
  const share = limit ? Math.min(1, used / limit) : 1;
  return (
    <div className="stack">
      <PageHead title={t("mf_title")}>
        <div className="row" style={{ gap: 6 }}>
          <Link className="btn sm ghost" href={`/files?year=${year - 1}`} aria-label={t("mf_prev_year")}>←</Link>
          <b>{year}</b>
          {year < thisYear ? <Link className="btn sm ghost" href={`/files?year=${year + 1}`} aria-label={t("mf_next_year")}>→</Link> : null}
        </div>
      </PageHead>
      <div className="panel stack" style={{ gap: 6 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span className="small">{t("mf_storage_used").replace("{used}", size(used)).replace("{limit}", size(limit))}</span>
          {ctx.isAdmin ? <Link className="small" href="/billing">{t("mf_storage_more")}</Link> : null}
        </div>
        <div className="mf-storage"><i style={{ width: `${Math.round(share * 100)}%`, background: share > 0.9 ? "var(--bad)" : "var(--app-files)" }} /></div>
      </div>
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
