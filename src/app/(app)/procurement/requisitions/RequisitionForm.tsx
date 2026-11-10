import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { budgetLines } from "@/lib/programs";
import type { Requisition } from "@/lib/requisitions";
import { ItemLines } from "@/components/ItemLines";
import { saveRequisitionAction } from "./actions";

/** The request to buy: what, why, for which budget line, and the lines with their estimated cost. */
export async function RequisitionForm({ ctx, req }: { ctx: Ctx; req?: Requisition }) {
  const { t, money } = await getI18n();
  const db = await getDb();
  const [groups, lines] = await Promise.all([
    ctx.has("projects") ? budgetLines(db, ctx.company.id) : Promise.resolve([]),
    req ? db.select().from(schema.requisitionLines).where(eq(schema.requisitionLines.requisitionId, req.id)).orderBy(asc(schema.requisitionLines.sortOrder)) : Promise.resolve([]),
  ]);
  return (
    <form action={saveRequisitionAction} className="panel stack">
      {req ? <input type="hidden" name="id" value={req.id} /> : null}
      <label className="f">{t("rq_title_field")}<input id="r-title" name="title" required defaultValue={req?.title} placeholder={t("rq_title_example")} /></label>
      <label className="f">{t("rq_justification")}<textarea id="r-justification" name="justification" rows={3} defaultValue={req?.justification} /></label>
      <div className="fields">
        <label className="f">{t("rq_department")}<input id="r-department" name="department" defaultValue={req?.department} /></label>
        <label className="f">{t("rq_needed_by")}<input id="r-needed" name="neededBy" type="date" defaultValue={req?.neededBy ?? ""} /></label>
        {groups.length ? (
          <label className="f">{t("pv_budget_line")}
            <select id="r-line" name="budgetItemId" defaultValue={req?.budgetItemId ?? ""}>
              <option value="">{t("none")}</option>
              {groups.map((g) => (
                <optgroup key={g.project.id} label={`${g.project.code} · ${g.project.name}`}>
                  {g.lines.map((l) => <option key={l.id} value={l.id}>{l.code} {l.title.slice(0, 60)} ({t("balance_left")}: {money(l.totalBudget - l.executed)})</option>)}
                </optgroup>
              ))}
            </select></label>
        ) : null}
      </div>
      <h3>{t("rq_items")}</h3>
      <ItemLines withCost currency={ctx.company.currency}
        initial={lines.map((l) => ({ description: l.description, unit: l.unit, quantity: l.quantity, unitCost: l.unitCost || "" }))}
        labels={{ description: t("description"), unit: t("rq_unit"), quantity: t("rq_quantity"), unitCost: t("rq_unit_cost"), amount: t("amount"), total: t("total"), add: t("rq_add_line"), remove: t("delete") }} />
      <div className="small muted">{t("rq_estimate_help")}</div>
      <div className="row">
        <button type="submit" name="intent" value="submit" className="btn primary">{t("rq_submit")}</button>
        <button type="submit" name="intent" value="save" className="btn">{t("rq_save_draft")}</button>
        <Link className="btn ghost" href={req ? `/procurement/requisitions/${req.id}` : "/procurement/requisitions"}>{t("cancel")}</Link>
      </div>
    </form>
  );
}
