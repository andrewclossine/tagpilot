import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { DeadlineInput } from "@/components/datetime";
import { saveTender } from "./actions";

type Tender = typeof schema.tenders.$inferSelect;

/** The request for quotation or tender document. A quotation is usually judged on price, so it starts at 0% technical. */
export async function TenderForm({ ctx, kind, tender }: { ctx: Ctx; kind: "rfq" | "tender"; tender?: Tender }) {
  const { t } = await getI18n();
  const db = await getDb();
  const projects = await db.select().from(schema.projects).where(eq(schema.projects.companyId, ctx.company.id)).orderBy(schema.projects.code);
  return (
    <form action={saveTender} className="panel stack">
      {tender ? <input type="hidden" name="id" value={tender.id} /> : null}
      <input type="hidden" name="kind" value={kind} />
      <label className="f">{t("tn_subject")}<input id="t-title" name="title" required defaultValue={tender?.title} /></label>
      <label className="f">{t("tn_description")}<textarea id="t-description" name="description" rows={4} defaultValue={tender?.description} /></label>
      <label className="f">{t("tn_requirements")}<textarea id="t-requirements" name="requirements" rows={6} defaultValue={tender?.requirements} /></label>
      <div className="fields">
        <label className="f">{t("tn_deadline")}<DeadlineInput id="t-deadline" name="deadline" defaultValue={tender?.deadline?.toISOString()} /></label>
        {ctx.has("projects") ? (
          <label className="f">{t("project")}
            <select id="t-project" name="projectId" defaultValue={tender?.projectId ?? ""}>
              <option value="">{t("none")}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select></label>
        ) : null}
        <label className="f">{t("tn_estimate")} ({ctx.company.currency})<input id="t-estimate" name="estimate" className="num" inputMode="decimal" defaultValue={tender?.estimate || ""} /></label>
        <label className="f">{t("tn_technical_weight")}<input id="t-weight" name="technicalWeight" className="num" type="number" min={0} max={100} defaultValue={tender?.technicalWeight ?? (kind === "rfq" ? 0 : 70)} /></label>
        <label className="f">{t("tn_standstill")}<input id="t-standstill" name="standstillDays" className="num" type="number" min={0} max={60} defaultValue={tender?.standstillDays ?? 7} /></label>
      </div>
      <label className="row small" style={{ gap: 8 }}><input id="t-open" name="openToAll" type="checkbox" style={{ width: "auto" }} defaultChecked={tender?.openToAll ?? kind === "tender"} /> {t("tn_open_to_all")}</label>
      <label className="f">{t("tn_document_file")}<input id="t-file" name="file" type="file" accept="image/*,application/pdf" /></label>
      <div className="row">
        <button type="submit" className="btn primary">{t("save")}</button>
        <Link className="btn ghost" href={tender ? `/procurement/${tender.id}` : "/procurement"}>{t("cancel")}</Link>
      </div>
    </form>
  );
}
