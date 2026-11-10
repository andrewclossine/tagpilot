import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import { budgetLeft, canSeeRequisition } from "@/lib/requisitions";
import { ConfirmButton } from "@/components/editors";
import { LocalTime } from "@/components/datetime";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { cancelRequisitionAction, convertRequisitionAction, decideRequisitionAction, submitRequisitionAction } from "../actions";
import { RequisitionForm } from "../RequisitionForm";

export const metadata = { title: "Purchase requisition" };

export default async function RequisitionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("requisitions");
  const { t, err, money } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const [r] = await db.select().from(schema.requisitions).where(and(eq(schema.requisitions.id, id), eq(schema.requisitions.companyId, ctx.company.id)));
  if (!r || !(await canSeeRequisition(db, ctx, r))) notFound();
  const mine = r.requestedBy === ctx.user.id;
  const editable = mine && (r.status === "draft" || r.status === "rejected") && ctx.can("requisitions", "write");
  if (q("edit") && editable) {
    return (
      <div className="stack">
        <PageHead title={`${t("edit")}: ${r.number}`} />
        <ErrorNote message={err(q("error"))} />
        <RequisitionForm ctx={ctx} req={r} />
      </div>
    );
  }

  const [lines, steps, [requester], project, tender] = await Promise.all([
    db.select().from(schema.requisitionLines).where(eq(schema.requisitionLines.requisitionId, id)).orderBy(asc(schema.requisitionLines.sortOrder)),
    db.select({ s: schema.requisitionSteps, name: schema.users.name }).from(schema.requisitionSteps)
      .innerJoin(schema.users, eq(schema.users.id, schema.requisitionSteps.approverId)).where(eq(schema.requisitionSteps.requisitionId, id)).orderBy(asc(schema.requisitionSteps.sortOrder)),
    db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, r.requestedBy)),
    r.projectId ? db.select().from(schema.projects).where(eq(schema.projects.id, r.projectId)).then((x) => x[0]) : Promise.resolve(undefined),
    r.tenderId ? db.select().from(schema.tenders).where(eq(schema.tenders.id, r.tenderId)).then((x) => x[0]) : Promise.resolve(undefined),
  ]);
  const budget = r.projectId && r.budgetItemId ? await budgetLeft(db, ctx.company.id, r.projectId, r.budgetItemId) : null;
  const current = steps.find((s) => s.s.status === "pending");
  const myTurn = r.status === "submitted" && current?.s.approverId === ctx.user.id && ctx.can("requisitions", "write");
  const procure = ctx.can("procurement", "write");

  return (
    <div className="stack">
      <PageHead title={`${r.number} · ${r.title}`}>
        <Link className="btn" href="/procurement/requisitions">{t("back")}</Link>
        <Pill kind={r.status}>{t(`rqs_${r.status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />

      <div className="grid2">
        <div className="panel stack">
          <div className="fields">
            <div><div className="label">{t("rq_number")}</div><b>{r.number}</b></div>
            <div><div className="label">{t("rq_requested_by")}</div>{requester?.name}{r.department ? <div className="small muted">{r.department}</div> : null}</div>
            <div><div className="label">{t("rq_submitted")}</div>{r.submittedAt ? <LocalTime value={r.submittedAt.toISOString()} /> : <span className="muted">-</span>}</div>
            <div><div className="label">{t("rq_needed_by")}</div>{r.neededBy ?? "-"}</div>
            <div><div className="label">{t("rq_total")}</div><b>{money(r.total, 2)} {ctx.company.currency}</b></div>
            {project ? <div><div className="label">{t("project")}</div>{project.code} · {project.name}</div> : null}
          </div>
          {r.justification ? <div><div className="label">{t("rq_justification")}</div><div style={{ whiteSpace: "pre-wrap" }}>{r.justification}</div></div> : null}
          {budget ? (
            <div className={`note small ${r.total > budget.left ? "bad" : "info"}`}>
              {t("pv_budget_line")}: <b>{budget.line.code} {budget.line.title}</b> · {t("balance_left")}: <b>{money(budget.left, 2)}</b>
              {r.total > budget.left ? <div>{t("err_requisition_budget")}</div> : null}
            </div>
          ) : null}
          {tender ? <div className="note ok small">{t("rq_converted_to")} <Link href={`/procurement/${tender.id}`}><b>{tender.number}</b> · {tender.title}</Link></div> : null}
        </div>

        <div className="panel stack">
          <h2>{t("rq_approvals")}</h2>
          {steps.length ? (
            <ol className="approvals">
              {steps.map(({ s, name }) => (
                <li key={s.id} className={s.status}>
                  <div className="row" style={{ gap: 8 }}>
                    <b style={{ flex: 1 }}>{s.name}</b>
                    <Pill kind={s.status === "pending" ? "submitted" : s.status}>{t(`rqstep_${s.status}`)}</Pill>
                  </div>
                  <div className="small">{name}{s.decidedAt ? <> · <LocalTime value={s.decidedAt.toISOString()} /></> : null}</div>
                  {s.note ? <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>{s.note}</div> : null}
                </li>
              ))}
            </ol>
          ) : <div className="small muted">{r.status === "draft" ? t("rq_levels_on_submit") : t("rq_no_levels_used")}</div>}

          {myTurn ? (
            <form action={decideRequisitionAction} className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <input type="hidden" name="id" value={r.id} />
              <label className="f">{t("notes")}<textarea id="d-note" name="note" rows={2} placeholder={t("rq_note_help")} /></label>
              <div className="row">
                <button type="submit" name="decision" value="approve" className="btn primary">{t("rq_approve")}</button>
                <button type="submit" name="decision" value="reject" className="btn danger">{t("rq_reject")}</button>
              </div>
            </form>
          ) : null}
        </div>
      </div>

      <div className="panel stack">
        <h2>{t("rq_items")}</h2>
        <div className="tbl-wrap"><table>
          <thead><tr><th>#</th><th>{t("description")}</th><th>{t("rq_unit")}</th><th className="num">{t("rq_quantity")}</th><th className="num">{t("rq_unit_cost")}</th><th className="num">{t("amount")}</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td className="muted">{l.sortOrder}</td><td>{l.description}</td><td>{l.unit}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitCost, 2)}</td><td className="num">{money(l.amount, 2)}</td></tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={5} className="num"><b>{t("total")}</b></td><td className="num"><b>{money(r.total, 2)}</b></td></tr></tfoot>
        </table></div>
      </div>

      <div className="row">
        {editable ? <>
          <Link className="btn" href={`/procurement/requisitions/${r.id}?edit=1`}>{t("edit")}</Link>
          <form action={submitRequisitionAction}><input type="hidden" name="id" value={r.id} /><button type="submit" className="btn primary">{t("rq_submit")}</button></form>
        </> : null}
        {r.status === "approved" && procure ? <>
          <form action={convertRequisitionAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="kind" value="rfq" /><button type="submit" className="btn primary">{t("rq_make_rfq")}</button></form>
          <form action={convertRequisitionAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="kind" value="tender" /><button type="submit" className="btn">{t("rq_make_tender")}</button></form>
        </> : null}
        {(mine || procure) && r.status !== "converted" && r.status !== "cancelled" ? (
          <form action={cancelRequisitionAction}><input type="hidden" name="id" value={r.id} /><ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("rq_cancel")}</ConfirmButton></form>
        ) : null}
      </div>
    </div>
  );
}
