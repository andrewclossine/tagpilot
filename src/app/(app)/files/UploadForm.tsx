import type { T } from "@/lib/i18n";
import { uploadToFolder } from "./actions";

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

/** Puts files into a month of a folder. On a month's page the month is fixed; on a year's page it is chosen. */
export function UploadForm({ t, folder, year, month }: { t: T; folder: string; year: number; month?: string }) {
  const now = new Date();
  const thisMonth = String(now.getMonth() + 1).padStart(2, "0");
  return (
    <form action={uploadToFolder} className="panel stack">
      <h2>{t("mf_upload")}</h2>
      <input type="hidden" name="folder" value={folder} />
      <div className="fields">
        {month ? <input type="hidden" name="month" value={month} /> : (
          <label className="f">{t("month")}
            <select id="mf-month" name="month" defaultValue={`${year}-${year === now.getFullYear() ? thisMonth : "01"}`}>
              {MONTHS.map((m) => <option key={m} value={`${year}-${m}`}>{t(`mf_m_${m}` as never)} {year}</option>)}
            </select></label>
        )}
        <label className="f" style={{ gridColumn: "span 2" }}>{t("mf_files")}<input id="mf-files" name="files" type="file" multiple required
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.xlsx,.xls,.csv,.docx,.doc" /></label>
      </div>
      <div className="small muted">{t("mf_upload_help")}</div>
      <div><button type="submit" className="btn primary">{t("mf_upload_btn")}</button></div>
    </form>
  );
}
