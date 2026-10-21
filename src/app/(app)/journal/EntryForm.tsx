import type { Ctx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { bookOptions, journalLabels } from "@/lib/data";
import { today } from "@/lib/format";
import { ConfirmButton, JournalLinesEditor, type JLine } from "@/components/editors";
import { deleteJournal, saveJournal } from "./actions";

type Entry = { id: string; date: string; reference: string; memo: string; partnerId: string | null; projectId: string | null };

/** The editable journal entry: header fields, the lines editor, and save / post / delete buttons. */
export async function EntryForm({ ctx, entry, lines }: { ctx: Ctx; entry?: Entry; lines?: JLine[] }) {
  const { t, accName } = await getI18n();
  const o = await bookOptions(ctx.company.id, accName);
  return (
    <form action={saveJournal} className="panel stack">
      {entry ? <input type="hidden" name="id" value={entry.id} /> : null}
      <div className="fields">
        <label className="f">{t("date")}<input id="date" type="date" name="date" defaultValue={entry?.date ?? today()} required /></label>
        <label className="f">{t("reference")}<input id="reference" name="reference" defaultValue={entry?.reference} /></label>
        <label className="f">{t("partner")}
          <select id="partnerId" name="partnerId" defaultValue={entry?.partnerId ?? ""}>
            <option value="">{t("none")}</option>
            {o.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="f">{t("project")}
          <select id="projectId" name="projectId" defaultValue={entry?.projectId ?? ""}>
            <option value="">{t("none")}</option>
            {o.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
        </label>
      </div>
      <label className="f">{t("memo")}<input id="memo" name="memo" defaultValue={entry?.memo} /></label>
      <JournalLinesEditor accounts={o.accountOpts} projects={o.projectOpts} initial={lines ?? []} labels={journalLabels(t)} />
      <div className="row">
        <button type="submit" name="intent" value="post" className="btn primary">{t("post")}</button>
        <button type="submit" name="intent" value="draft" className="btn">{t("save_draft")}</button>
        <span className="spacer" />
        {entry ? <ConfirmButton className="btn danger" formAction={deleteJournal} confirmLabel={t("confirm")}>{t("delete_draft")}</ConfirmButton> : null}
      </div>
    </form>
  );
}
