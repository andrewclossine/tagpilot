import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import { isSealed } from "@/lib/procurement";
import { committeeOpen, committeeTechnical, criteriaOf, evaluationRole, membersOf } from "@/lib/committee";
import { itemsOf, pricesOf } from "@/lib/boq";
import { ConfirmButton } from "@/components/editors";
import { LocalTime } from "@/components/datetime";
import { PriceComparison } from "@/components/PriceComparison";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { addCriterionAction, declareAction, decideAwardAction, removeCriterionAction, saveCommitteeAction, saveScoresAction } from "./actions";

export const metadata = { title: "Evaluation" };

/** The evaluation committee's page: who sits on it, the criteria, each member's scores, and the award approval. */
export default async function EvaluationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await getCtx();
  const { t, err, money } = await getI18n();
  const { id } = await params;
  if (!isUuid(id) || ctx.role === "supplier") notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const [tender] = await db.select().from(schema.tenders).where(and(eq(schema.tenders.id, id), eq(schema.tenders.companyId, ctx.company.id)));
  if (!tender) notFound();
  const role = await evaluationRole(db, ctx, tender);
  if (!role.team && !role.member && !role.approver) notFound();
  const manage = ctx.can("procurement", "write") && committeeOpen(tender);
  const sealed = isSealed(tender);

  const [members, criteria, people, items] = await Promise.all([
    membersOf(db, id), criteriaOf(db, id),
    manage ? db.select({ id: schema.users.id, name: schema.users.name, role: schema.memberships.role }).from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.companyId, ctx.company.id), ne(schema.memberships.role, "supplier"))).orderBy(schema.users.name) : Promise.resolve([]),
    itemsOf(db, id),
  ]);
  const bids = sealed ? [] : await db.select({ b: schema.bids, partner: schema.partners.name }).from(schema.bids)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.bids.partnerId)).where(eq(schema.bids.tenderId, id));
  const seeResults = role.team || role.approver;
  const [technical, prices, myScores] = await Promise.all([
    committeeTechnical(db, id),
    seeResults && !sealed ? pricesOf(db, bids.map((b) => b.b.id)) : Promise.resolve(new Map<string, number>()),
    role.member ? db.select().from(schema.committeeScores).where(and(eq(schema.committeeScores.tenderId, id), eq(schema.committeeScores.userId, ctx.user.id))) : Promise.resolve([]),
  ]);
  const approverName = tender.awardApproverId ? (await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, tender.awardApproverId)))[0]?.name : null;
  const pointsTotal = criteria.reduce((s, c) => s + c.maxPoints, 0);
  const scoreOf = (bidId: string, cId: string) => myScores.find((s) => s.bidId === bidId && s.criterionId === cId)?.points;
  const commentOf = (bidId: string) => myScores.find((s) => s.bidId === bidId)?.comment ?? "";
  const canScore = role.member && role.member.declaredAt && !role.member.submittedAt && tender.status === "opened";
  const ranked = [...bids].sort((a, b) => (a.b.rank ?? 999) - (b.b.rank ?? 999));
  const [evaluation] = await db.select().from(schema.tenderStages).where(and(eq(schema.tenderStages.tenderId, id), eq(schema.tenderStages.stage, "evaluation")));

  return (
    <div className="stack">
      <PageHead title={`${t("cm_title")}: ${tender.number} · ${tender.title}`}>
        <Link className="btn" href={role.team ? `/procurement/${id}` : "/procurement/requisitions"}>{t("back")}</Link>
        <Pill kind={tender.status}>{t(`ts_${tender.status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}

      {role.member && !role.member.declaredAt ? (
        <form action={declareAction} className="panel stack">
          <h2>{t("cm_declaration")}</h2>
          <input type="hidden" name="id" value={id} />
          <div className="small">{t("cm_declaration_text").replace("{number}", tender.number)}</div>
          <label className="row small" style={{ gap: 8 }}><input type="radio" name="declaration" value="none" defaultChecked style={{ width: "auto" }} /> {t("cm_no_conflict")}</label>
          <label className="row small" style={{ gap: 8 }}><input type="radio" name="declaration" value="conflict" style={{ width: "auto" }} /> {t("cm_conflict")}</label>
          <div><button type="submit" className="btn primary">{t("cm_declare")}</button></div>
        </form>
      ) : null}

      <div className="grid2">
        <div className="panel stack">
          <h2>{t("cm_committee")}</h2>
          {members.length ? (
            <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }}>
              {members.map(({ m, name }) => (
                <li key={m.userId} className="small">
                  <b>{name}</b>{m.isChair ? ` · ${t("cm_chair")}` : ""}
                  {" · "}{m.submittedAt ? <span style={{ color: "var(--ok)" }}>{t("cm_scores_sent")}</span> : m.declaredAt ? t("cm_declared") : <span className="muted">{t("cm_not_declared")}</span>}
                </li>
              ))}
            </ul>
          ) : <div className="small muted">{t("cm_none")}</div>}
          <div className="small"><span className="muted">{t("cm_award_approver")}:</span> {approverName ?? t("none")}</div>
          {manage ? (
            <form action={saveCommitteeAction} className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <input type="hidden" name="id" value={id} />
              <div className="small muted">{t("cm_setup_help")}</div>
              <div className="tbl-wrap"><table>
                <thead><tr><th>{t("name")}</th><th>{t("cm_member")}</th><th>{t("cm_chair")}</th></tr></thead>
                <tbody>{people.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name} <span className="small muted">· {t(`role_${p.role}`)}</span></td>
                    <td><input type="checkbox" name="member" value={p.id} id={`cm-${p.id}`} style={{ width: "auto" }} defaultChecked={members.some((m) => m.m.userId === p.id)} aria-label={t("cm_member")} /></td>
                    <td><input type="radio" name="chairId" value={p.id} style={{ width: "auto" }} defaultChecked={members.some((m) => m.m.userId === p.id && m.m.isChair)} aria-label={t("cm_chair")} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
              <label className="f">{t("cm_award_approver")}
                <select id="cm-approver" name="approverId" defaultValue={tender.awardApproverId ?? ""}>
                  <option value="">{t("none")}</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
              <div className="small muted">{t("cm_approver_help")}</div>
              <div><button type="submit" className="btn primary">{t("cm_save")}</button></div>
            </form>
          ) : null}
        </div>

        <div className="panel stack" id="criteria">
          <h2>{t("cm_criteria")}</h2>
          {criteria.length ? (
            <div className="tbl-wrap"><table>
              <thead><tr><th>{t("cm_criterion")}</th><th className="num">{t("cm_points")}</th>{manage ? <th /> : null}</tr></thead>
              <tbody>{criteria.map((c) => (
                <tr key={c.id}><td>{c.name}</td><td className="num">{c.maxPoints}</td>
                  {manage ? <td><form action={removeCriterionAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="criterionId" value={c.id} /><ConfirmButton className="btn sm ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form></td> : null}</tr>
              ))}</tbody>
              <tfoot><tr><td className="num"><b>{t("total")}</b></td><td className="num"><b>{pointsTotal}</b></td>{manage ? <td /> : null}</tr></tfoot>
            </table></div>
          ) : <div className="small muted">{t("cm_no_criteria")}</div>}
          {pointsTotal && pointsTotal !== 100 ? <div className="note warn small">{t("cm_points_not_100").replace("{n}", String(pointsTotal))}</div> : null}
          {manage ? (
            <form action={addCriterionAction} className="fields" style={{ alignItems: "end" }}>
              <input type="hidden" name="id" value={id} />
              <label className="f">{t("cm_criterion")}<input id="c-name" name="name" required placeholder={t("cm_criterion_example")} /></label>
              <label className="f">{t("cm_points")}<input id="c-points" name="maxPoints" className="num" inputMode="numeric" required /></label>
              <div><button type="submit" className="btn">{t("cm_add_criterion")}</button></div>
            </form>
          ) : null}
        </div>
      </div>

      {sealed ? <div className="note info small">{t("cm_sealed")}</div> : null}

      {canScore ? (
        <form action={saveScoresAction} className="panel stack" id="scores">
          <h2>{t("cm_my_scores")}</h2>
          <input type="hidden" name="id" value={id} />
          <div className="small muted">{t("cm_scores_help")}</div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("supplier")}</th>{criteria.map((c) => <th key={c.id} className="num">{c.name} <span className="muted">/ {c.maxPoints}</span></th>)}<th>{t("cm_comment")}</th></tr></thead>
            <tbody>{bids.map(({ b, partner }) => (
              <tr key={b.id}>
                <td><b>{partner}</b>{b.attachmentId ? <div className="small"><a href={`/api/files/${b.attachmentId}`} target="_blank" rel="noreferrer">{t("tn_bid_file")}</a></div> : null}{b.note ? <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>{b.note}</div> : null}</td>
                {criteria.map((c) => <td key={c.id}><input name={`pts_${b.id}_${c.id}`} className="num" style={{ width: 80 }} inputMode="decimal" defaultValue={scoreOf(b.id, c.id) ?? ""} aria-label={`${partner} ${c.name}`} /></td>)}
                <td><input name={`cmt_${b.id}`} defaultValue={commentOf(b.id)} aria-label={t("cm_comment")} /></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="row">
            <button type="submit" name="intent" value="save" className="btn">{t("cm_save_scores")}</button>
            <ConfirmButton className="btn primary" confirmLabel={t("cm_submit_confirm")} name="intent" value="submit">{t("cm_submit_scores")}</ConfirmButton>
          </div>
        </form>
      ) : role.member?.submittedAt ? <div className="note ok small">{t("cm_you_sent")} <LocalTime value={role.member.submittedAt.toISOString()} /></div> : null}

      {seeResults && !sealed && members.length ? (
        <div className="panel stack">
          <h2>{t("cm_results")}</h2>
          <div className="small muted">{t("cm_results_help").replace("{sent}", String(technical.sent)).replace("{members}", String(technical.members))}</div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("supplier")}</th><th className="num">{t("cm_avg_technical")}</th></tr></thead>
            <tbody>{bids.map(({ b, partner }) => <tr key={b.id}><td>{partner}</td><td className="num">{technical.out.has(b.id) ? technical.out.get(b.id) : "-"}</td></tr>)}</tbody>
          </table></div>
        </div>
      ) : null}

      {seeResults && !sealed ? (
        <PriceComparison items={items} currency={ctx.company.currency} prices={prices} bids={bids.map(({ b, partner }) => ({ id: b.id, partner, amount: b.amount }))} />
      ) : null}

      {tender.awardApproverId && (tender.status === "evaluated" || tender.awardApprovedAt || tender.awardNote) ? (
        <div className="panel stack">
          <h2>{t("cm_award_approval")}</h2>
          {tender.awardApprovedAt ? <div className="note ok small">{t("cm_award_approved")} <LocalTime value={tender.awardApprovedAt.toISOString()} />{tender.awardNote ? ` · ${tender.awardNote}` : ""}</div>
            : tender.awardNote && tender.status !== "evaluated" ? <div className="note warn small">{t("cm_award_returned")}: {tender.awardNote}</div> : null}
          {tender.status === "evaluated" && !tender.awardApprovedAt ? <>
            <div className="tbl-wrap"><table>
              <thead><tr><th>{t("tn_rank")}</th><th>{t("supplier")}</th><th className="num">{t("amount")}</th><th className="num">{t("tn_tech")}</th><th className="num">{t("tn_fin")}</th><th className="num">{t("total")}</th></tr></thead>
              <tbody>{ranked.map(({ b, partner }) => (
                <tr key={b.id} style={b.isWinner ? { background: "var(--ok-soft)" } : undefined}>
                  <td>{b.rank ?? "-"}</td><td><b>{partner}</b>{b.isWinner ? ` · ${t("tn_winner")}` : ""}</td><td className="num">{money(b.amount, 2)}</td>
                  <td className="num">{b.technicalScore ?? ""}</td><td className="num">{b.financialScore ?? ""}</td><td className="num">{b.totalScore ?? ""}</td>
                </tr>
              ))}</tbody>
            </table></div>
            {evaluation?.body ? <div><div className="label">{t("tn_eval_report")}</div><div style={{ whiteSpace: "pre-wrap" }}>{evaluation.body}</div></div> : null}
            {role.approver ? (
              <form action={decideAwardAction} className="stack">
                <input type="hidden" name="id" value={id} />
                <label className="f">{t("notes")}<textarea id="a-note" name="note" rows={2} placeholder={t("rq_note_help")} /></label>
                <div className="row">
                  <button type="submit" name="decision" value="approve" className="btn primary">{t("cm_approve_award")}</button>
                  <button type="submit" name="decision" value="return" className="btn danger">{t("cm_return_award")}</button>
                </div>
              </form>
            ) : <div className="small muted">{t("cm_waiting_approver").replace("{name}", approverName ?? "")}</div>}
          </> : null}
        </div>
      ) : null}
    </div>
  );
}
