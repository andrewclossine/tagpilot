import "server-only";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import type { Ctx } from "./auth";
import { round2 } from "./format";
import { UserError } from "./ledger";
import { audit } from "./audit";
import { isSealed, type Tender } from "./procurement";

/** Committee and criteria can change until the evaluation is recorded; scoring happens once the bids are opened. */
export const committeeOpen = (t: Pick<Tender, "status">) => ["draft", "published", "opened"].includes(t.status);

export async function membersOf(db: Db | Tx, tenderId: string) {
  return db.select({ m: schema.tenderCommittee, name: schema.users.name }).from(schema.tenderCommittee)
    .innerJoin(schema.users, eq(schema.users.id, schema.tenderCommittee.userId))
    .where(eq(schema.tenderCommittee.tenderId, tenderId)).orderBy(asc(schema.users.name));
}

export const criteriaOf = (db: Db | Tx, tenderId: string) =>
  db.select().from(schema.tenderCriteria).where(eq(schema.tenderCriteria.tenderId, tenderId)).orderBy(asc(schema.tenderCriteria.sortOrder));

/** Who may open the evaluation page: the procurement team, committee members and the award approver. */
export async function evaluationRole(db: Db, ctx: Ctx, tender: Tender) {
  const [member] = await db.select().from(schema.tenderCommittee).where(and(eq(schema.tenderCommittee.tenderId, tender.id), eq(schema.tenderCommittee.userId, ctx.user.id)));
  return { member: member ?? null, approver: tender.awardApproverId === ctx.user.id, team: ctx.can("procurement") };
}

/** Sets the members, the chair and who approves the award. Members who already sent their scores stay. */
export async function setCommittee(tx: Tx, ctx: Ctx, tender: Tender, input: { members: string[]; chairId: string; approverId: string | null }) {
  if (!committeeOpen(tender)) throw new UserError("err_tender_state");
  const people = await tx.select({ userId: schema.memberships.userId, role: schema.memberships.role }).from(schema.memberships).where(eq(schema.memberships.companyId, ctx.company.id));
  const ok = (id: string) => people.some((p) => p.userId === id && p.role !== "supplier");
  const members = [...new Set(input.members.filter(ok))];
  if (input.approverId && !ok(input.approverId)) throw new UserError("err_not_found");
  if (input.approverId && members.includes(input.approverId)) throw new UserError("err_approver_in_committee");
  const old = await tx.select().from(schema.tenderCommittee).where(eq(schema.tenderCommittee.tenderId, tender.id));
  const keep = old.filter((o) => o.submittedAt).map((o) => o.userId);
  const all = [...new Set([...members, ...keep])];
  await tx.delete(schema.tenderCommittee).where(and(eq(schema.tenderCommittee.tenderId, tender.id), isNull(schema.tenderCommittee.submittedAt)));
  const fresh = all.filter((u) => !keep.includes(u));
  if (fresh.length) {
    await tx.insert(schema.tenderCommittee).values(fresh.map((userId) => {
      const was = old.find((o) => o.userId === userId);
      return { tenderId: tender.id, userId, declaredAt: was?.declaredAt ?? null, isChair: false };
    }));
  }
  await tx.update(schema.tenderCommittee).set({ isChair: false }).where(eq(schema.tenderCommittee.tenderId, tender.id));
  if (all.includes(input.chairId)) await tx.update(schema.tenderCommittee).set({ isChair: true }).where(and(eq(schema.tenderCommittee.tenderId, tender.id), eq(schema.tenderCommittee.userId, input.chairId)));
  await tx.update(schema.tenders).set({ awardApproverId: input.approverId }).where(eq(schema.tenders.id, tender.id));
  // With a committee there must be something to score: one criterion worth all 100 points until the team sets others.
  if (all.length && !(await criteriaOf(tx, tender.id)).length) {
    await tx.insert(schema.tenderCriteria).values({ companyId: ctx.company.id, tenderId: tender.id, sortOrder: 1, name: "Technical compliance", maxPoints: 100 });
  }
  await audit(tx, ctx.company.id, ctx.user.id, "committee", "tender", tender.number, { members: all.length, approver: !!input.approverId });
}

/** Criteria add up to 100 points at most; they can change only while nobody has sent scores. */
export async function addCriterion(tx: Tx, ctx: Ctx, tender: Tender, name: string, maxPoints: number) {
  if (!committeeOpen(tender)) throw new UserError("err_tender_state");
  if (!name || !(maxPoints > 0)) throw new UserError("err_required");
  const sent = await tx.select().from(schema.tenderCommittee).where(eq(schema.tenderCommittee.tenderId, tender.id));
  if (sent.some((m) => m.submittedAt)) throw new UserError("err_scores_sent");
  const list = await criteriaOf(tx, tender.id);
  if (list.reduce((s, c) => s + c.maxPoints, 0) + maxPoints > 100) throw new UserError("err_criteria_over_100");
  await tx.insert(schema.tenderCriteria).values({ companyId: ctx.company.id, tenderId: tender.id, sortOrder: list.length + 1, name: name.slice(0, 200), maxPoints: Math.round(maxPoints) });
}

export async function removeCriterion(tx: Tx, tender: Tender, criterionId: string) {
  if (!committeeOpen(tender)) throw new UserError("err_tender_state");
  const sent = await tx.select().from(schema.tenderCommittee).where(eq(schema.tenderCommittee.tenderId, tender.id));
  if (sent.some((m) => m.submittedAt)) throw new UserError("err_scores_sent");
  await tx.delete(schema.tenderCriteria).where(and(eq(schema.tenderCriteria.id, criterionId), eq(schema.tenderCriteria.tenderId, tender.id)));
}

/** A member states having no conflict of interest, or withdraws from the committee because they have one. */
export async function declare(tx: Tx, ctx: Ctx, tender: Tender, noConflict: boolean) {
  const [m] = await tx.select().from(schema.tenderCommittee).where(and(eq(schema.tenderCommittee.tenderId, tender.id), eq(schema.tenderCommittee.userId, ctx.user.id)));
  if (!m || m.submittedAt) throw new UserError("err_not_found");
  if (noConflict) await tx.update(schema.tenderCommittee).set({ declaredAt: new Date() }).where(and(eq(schema.tenderCommittee.tenderId, tender.id), eq(schema.tenderCommittee.userId, ctx.user.id)));
  else await tx.delete(schema.tenderCommittee).where(and(eq(schema.tenderCommittee.tenderId, tender.id), eq(schema.tenderCommittee.userId, ctx.user.id)));
  await audit(tx, ctx.company.id, ctx.user.id, noConflict ? "declare_no_conflict" : "declare_conflict", "tender", tender.number);
}

/** A member's points, saved as they go; "submit" makes them final. Only after opening, and only for declared members. */
export async function saveScores(tx: Tx, ctx: Ctx, tender: Tender, fd: FormData, submit: boolean) {
  if (tender.status !== "opened") throw new UserError("err_tender_state");
  const [m] = await tx.select().from(schema.tenderCommittee).where(and(eq(schema.tenderCommittee.tenderId, tender.id), eq(schema.tenderCommittee.userId, ctx.user.id)));
  if (!m) throw new UserError("err_not_found");
  if (!m.declaredAt) throw new UserError("err_declare_first");
  if (m.submittedAt) throw new UserError("err_scores_sent");
  const [criteria, bids] = await Promise.all([criteriaOf(tx, tender.id), tx.select().from(schema.bids).where(eq(schema.bids.tenderId, tender.id))]);
  const rows: (typeof schema.committeeScores.$inferInsert)[] = [];
  for (const b of bids) for (const c of criteria) {
    const raw = String(fd.get(`pts_${b.id}_${c.id}`) ?? "").trim();
    if (!raw) { if (submit) throw new UserError("err_scores_missing"); continue; }
    const points = Number(raw.replace(",", "."));
    if (!Number.isFinite(points) || points < 0 || points > c.maxPoints) throw new UserError("err_points_range");
    rows.push({ tenderId: tender.id, bidId: b.id, userId: ctx.user.id, criterionId: c.id, points: round2(points), comment: String(fd.get(`cmt_${b.id}`) ?? "").slice(0, 1000) });
  }
  await tx.delete(schema.committeeScores).where(and(eq(schema.committeeScores.tenderId, tender.id), eq(schema.committeeScores.userId, ctx.user.id)));
  if (rows.length) await tx.insert(schema.committeeScores).values(rows);
  if (submit) {
    await tx.update(schema.tenderCommittee).set({ submittedAt: new Date() }).where(and(eq(schema.tenderCommittee.tenderId, tender.id), eq(schema.tenderCommittee.userId, ctx.user.id)));
    await audit(tx, ctx.company.id, ctx.user.id, "submit_scores", "tender", tender.number);
  }
}

/** The committee's technical score of each bid: each member's points added up, averaged over the members who sent theirs. */
export async function committeeTechnical(db: Db | Tx, tenderId: string) {
  const members = await db.select().from(schema.tenderCommittee).where(eq(schema.tenderCommittee.tenderId, tenderId));
  const sent = members.filter((m) => m.submittedAt).map((m) => m.userId);
  const out = new Map<string, number>();
  if (!sent.length) return { out, members: members.length, sent: 0 };
  const scores = await db.select().from(schema.committeeScores).where(and(eq(schema.committeeScores.tenderId, tenderId), inArray(schema.committeeScores.userId, sent)));
  const byBid = new Map<string, Map<string, number>>();
  for (const s of scores) {
    const m = byBid.get(s.bidId) ?? new Map<string, number>();
    m.set(s.userId, (m.get(s.userId) ?? 0) + s.points);
    byBid.set(s.bidId, m);
  }
  for (const [bidId, perMember] of byBid) out.set(bidId, round2([...perMember.values()].reduce((a, b) => a + b, 0) / sent.length));
  return { out, members: members.length, sent: sent.length };
}

/** The award approver accepts the recommended award, or sends the evaluation back with a reason. */
export async function decideAward(tx: Tx, ctx: Ctx, tender: Tender, approve: boolean, note: string) {
  if (tender.awardApproverId !== ctx.user.id) throw new UserError("err_not_your_turn");
  if (tender.status !== "evaluated" || tender.awardApprovedAt) throw new UserError("err_tender_state");
  if (!approve && !note) throw new UserError("err_reason_required");
  await tx.update(schema.tenders).set(approve ? { awardApprovedAt: new Date(), awardNote: note } : { status: "opened", awardNote: note }).where(eq(schema.tenders.id, tender.id));
  // Sent back: the committee may score again.
  if (!approve) await tx.update(schema.tenderCommittee).set({ submittedAt: null }).where(eq(schema.tenderCommittee.tenderId, tender.id));
  await audit(tx, ctx.company.id, ctx.user.id, approve ? "approve_award" : "return_award", "tender", tender.number, { note });
}

/** What waits for this person on the evaluation side: declaring, scoring, approving an award. */
export async function evaluationTasks(db: Db, ctx: Ctx) {
  const mine = await db.select({ t: schema.tenders, m: schema.tenderCommittee }).from(schema.tenderCommittee)
    .innerJoin(schema.tenders, eq(schema.tenders.id, schema.tenderCommittee.tenderId))
    .where(and(eq(schema.tenderCommittee.userId, ctx.user.id), eq(schema.tenders.companyId, ctx.company.id), isNull(schema.tenderCommittee.submittedAt),
      or(eq(schema.tenders.status, "opened"), eq(schema.tenders.status, "published"))));
  const approvals = await db.select().from(schema.tenders)
    .where(and(eq(schema.tenders.companyId, ctx.company.id), eq(schema.tenders.awardApproverId, ctx.user.id), eq(schema.tenders.status, "evaluated"), isNull(schema.tenders.awardApprovedAt)));
  type Task = { kind: "declare" | "score" | "award"; tender: Tender };
  const tasks: Task[] = [];
  for (const { t, m } of mine) {
    if (!m.declaredAt) tasks.push({ kind: "declare", tender: t });
    else if (t.status === "opened") tasks.push({ kind: "score", tender: t });
  }
  for (const t of approvals) tasks.push({ kind: "award", tender: t });
  return tasks;
}

export { isSealed };
