import { getI18n } from "@/lib/i18n";
import { nextAfter } from "@/lib/recurring";
import { createRecurring } from "@/app/(app)/recurring/actions";

/** "Make recurring": puts this invoice, bill or journal entry on a schedule, starting the next period. */
export async function MakeRecurring({ kind, sourceId, date }: { kind: "invoice" | "bill" | "journal"; sourceId: string; date: string }) {
  const { t } = await getI18n();
  return (
    <details>
      <summary className="btn sm" style={{ display: "inline-block" }}>{t("rec_make")}</summary>
      <form action={createRecurring} className="stack" style={{ marginTop: 10 }}>
        <input type="hidden" name="kind" value={kind} /><input type="hidden" name="sourceId" value={sourceId} />
        <div className="small muted">{t("rec_make_help")}</div>
        <div className="fields">
          <label className="f">{t("rec_every")}
            <select name="every" defaultValue="month">{(["week", "month", "quarter", "year"] as const).map((e) => <option key={e} value={e}>{t(`rec_every_${e}`)}</option>)}</select></label>
          <label className="f">{t("rec_first")}<input type="date" name="nextDate" required defaultValue={nextAfter(date, "month")} /></label>
          <label className="f">{t("rec_end")}<input type="date" name="endDate" /></label>
          <label className="f">{t("rec_name")}<input name="name" /></label>
        </div>
        <label className="row small" style={{ gap: 8 }}><input type="checkbox" name="autoPost" defaultChecked style={{ width: "auto" }} /> {t(kind === "journal" ? "rec_autopost_journal" : kind === "invoice" ? "rec_autopost_invoice" : "rec_autopost_bill")}</label>
        <div><button type="submit" className="btn primary">{t("rec_save")}</button></div>
      </form>
    </details>
  );
}
