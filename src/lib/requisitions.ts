import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { getDb, schema } from "@/db";
import type { Ctx } from "./auth";
import { round2 } from "./format";
import { UserError } from "./ledger";
import { nextNumber } from "./numbering";
import { audit } from "./audit";
import { sendMail } from "./mail";
import { logframe } from "./programs";

export type Requisition = typeof schema.requisitions.$inferSelect;
export type RequisitionInput = {
  title: string; justification: string; department: string; projectId: string | null; budgetItemId: string | null; neededBy: string | null;
  lines: { description: string; unit: string; quantity: number; unitCost: number }[];
};

/** Who may see a request: whoever raised it, its approvers, and the procurement team. */
export async function canSeeRequisition(db: Db | Tx, ctx: Ctx, r: Requisition) {
  if (r.companyId !== ctx.company.id) return false;
  if (r.requestedBy === ctx.user.id || ctx.can("procurement") || ctx.isAdmin) return true;
  const [step] = await db.select({ id: schema.requisitionSteps.id }).from(schema.requisitionSteps)
    .where(and(eq(schema.requisitionSteps.requisitionId, r.id), eq(schema.requisitionSteps.approverId, ctx.user.id)));
  return !!step;
}

async function lock(tx: Tx, companyId: string, id: string) {
  const [r] = await tx.select().from(schema.requisitions).where(and(eq(schema.requisitions.id, id), eq(schema.requisitions.companyId, companyId))).for("update");
  if (!r) throw new UserError("err_not_found");
  return r;
}

/** What is left on a budget line: its budget less what fund requests and earlier spending have taken. */
export async function budgetLeft(db: Db | Tx, companyId: string, projectId: string, budgetItemId: string) {
  const line = (await logframe(db, companyId, projectId)).find((r) => r.id === budgetItemId && r.isLine);
  if (!line) return null;
  return { line, left: round2(line.totalBudget - line.executed) };
}

/** Saves a draft, or a returned request, with its lines. Only the person who raised it may change it. */
export async function saveRequisition(tx: Tx, ctx: Ctx, id: string | null, input: RequisitionInput): Promise<string> {
  if (!input.title) throw new UserError("err_required");
  const lines = input.lines.filter((l) => l.description && l.quantity > 0);
  if (!lines.length) throw new UserError("err_requisition_lines");
  if (input.projectId) {
    const [p] = await tx.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.companyId, ctx.company.id)));
    if (!p) throw new UserError("err_not_found");
    if (input.budgetItemId && !(await budgetLeft(tx, ctx.company.id, input.projectId, input.budgetItemId))) throw new UserError("err_not_budget_line");
  } else input.budgetItemId = null;
  const total = round2(lines.reduce((s, l) => s + round2(l.quantity * l.unitCost), 0));
  const head = {
    title: input.title, justification: input.justification, department: input.department, projectId: input.projectId,
    budgetItemId: input.budgetItemId, neededBy: input.neededBy, total,
  };
  let rid = id;
  if (id) {
    const r = await lock(tx, ctx.company.id, id);
    if (r.requestedBy !== ctx.user.id) throw new UserError("err_not_yours");
    if (r.status !== "draft" && r.status !== "rejected") throw new UserError("err_requisition_state");
    await tx.update(schema.requisitions).set({ ...head, status: "draft" }).where(eq(schema.requisitions.id, id));
    await tx.delete(schema.requisitionLines).where(eq(schema.requisitionLines.requisitionId, id));
  } else {
    const number = await nextNumber(tx, schema.requisitions, { number: schema.requisitions.number, companyId: schema.requisitions.companyId }, ctx.company.id, "PR");
    const [row] = await tx.insert(schema.requisitions).values({ ...head, companyId: ctx.company.id, number, requestedBy: ctx.user.id }).returning({ id: schema.requisitions.id });
    rid = row.id;
    await audit(tx, ctx.company.id, ctx.user.id, "create", "requisition", number, { total });
  }
  await tx.insert(schema.requisitionLines).values(lines.map((l, i) => ({
    requisitionId: rid!, sortOrder: i + 1, description: l.description.slice(0, 500), unit: l.unit.slice(0, 40), quantity: l.quantity, unitCost: l.unitCost, amount: round2(l.quantity * l.unitCost),
  })));
  return rid!;
}

/**
 * Sends a request for approval. Every level its total reaches applies, in order; the person who raised it never
 * approves their own request. With no level that applies, an administrator approves; with nobody else, it is approved.
 */
export async function submitRequisition(tx: Tx, ctx: Ctx, id: string): Promise<{ notify: string | null }> {
  const r = await lock(tx, ctx.company.id, id);
  if (r.requestedBy !== ctx.user.id) throw new UserError("err_not_yours");
  if (r.status !== "draft" && r.status !== "rejected") throw new UserError("err_requisition_state");
  if (r.projectId && r.budgetItemId) {
    const b = await budgetLeft(tx, ctx.company.id, r.projectId, r.budgetItemId);
    if (b && r.total > b.left) throw new UserError("err_requisition_budget");
  }
  const levels = (await tx.select().from(schema.requisitionLevels).where(eq(schema.requisitionLevels.companyId, ctx.company.id)).orderBy(asc(schema.requisitionLevels.sortOrder), asc(schema.requisitionLevels.minAmount)))
    .filter((l) => r.total >= l.minAmount && l.approverId !== ctx.user.id);
  let steps = levels.map((l) => ({ name: l.name, approverId: l.approverId }));
  if (!steps.length) {
    const [admin] = await tx.select({ userId: schema.memberships.userId }).from(schema.memberships)
      .where(and(eq(schema.memberships.companyId, ctx.company.id), eq(schema.memberships.role, "admin"), ne(schema.memberships.userId, ctx.user.id))).limit(1);
    steps = admin ? [{ name: "Administrator", approverId: admin.userId }] : [];
  }
  await tx.delete(schema.requisitionSteps).where(eq(schema.requisitionSteps.requisitionId, id));
  const now = new Date();
  if (!steps.length) {
    await tx.update(schema.requisitions).set({ status: "approved", submittedAt: now }).where(eq(schema.requisitions.id, id));
    await audit(tx, ctx.company.id, ctx.user.id, "submit", "requisition", r.number, { approvedWithoutLevels: true });
    return { notify: null };
  }
  await tx.insert(schema.requisitionSteps).values(steps.map((s, i) => ({ requisitionId: id, sortOrder: i + 1, name: s.name, approverId: s.approverId, status: i === 0 ? "pending" as const : "waiting" as const })));
  await tx.update(schema.requisitions).set({ status: "submitted", submittedAt: now }).where(eq(schema.requisitions.id, id));
  await audit(tx, ctx.company.id, ctx.user.id, "submit", "requisition", r.number, { total: r.total, levels: steps.length });
  return { notify: steps[0].approverId };
}

/** The approver whose turn it is approves, passing it to the next level, or returns it to the requester with a reason. */
export async function decideRequisition(tx: Tx, ctx: Ctx, id: string, approve: boolean, note: string): Promise<{ notify: string | null; done: boolean }> {
  const r = await lock(tx, ctx.company.id, id);
  if (r.status !== "submitted") throw new UserError("err_requisition_state");
  const steps = await tx.select().from(schema.requisitionSteps).where(eq(schema.requisitionSteps.requisitionId, id)).orderBy(asc(schema.requisitionSteps.sortOrder));
  const current = steps.find((s) => s.status === "pending");
  if (!current || current.approverId !== ctx.user.id) throw new UserError("err_not_your_turn");
  if (!approve && !note) throw new UserError("err_reason_required");
  await tx.update(schema.requisitionSteps).set({ status: approve ? "approved" : "rejected", note, decidedAt: new Date() }).where(eq(schema.requisitionSteps.id, current.id));
  await audit(tx, ctx.company.id, ctx.user.id, approve ? "approve" : "reject", "requisition", r.number, { level: current.name, note });
  if (!approve) {
    await tx.update(schema.requisitions).set({ status: "rejected" }).where(eq(schema.requisitions.id, id));
    return { notify: r.requestedBy, done: true };
  }
  const next = steps.find((s) => s.sortOrder > current.sortOrder && s.status === "waiting");
  if (next) {
    await tx.update(schema.requisitionSteps).set({ status: "pending" }).where(eq(schema.requisitionSteps.id, next.id));
    return { notify: next.approverId, done: false };
  }
  await tx.update(schema.requisitions).set({ status: "approved" }).where(eq(schema.requisitions.id, id));
  return { notify: r.requestedBy, done: true };
}

export async function cancelRequisition(tx: Tx, ctx: Ctx, id: string) {
  const r = await lock(tx, ctx.company.id, id);
  if (r.requestedBy !== ctx.user.id && !ctx.can("procurement", "write")) throw new UserError("err_not_yours");
  if (r.status === "converted" || r.status === "cancelled") throw new UserError("err_requisition_state");
  await tx.update(schema.requisitions).set({ status: "cancelled" }).where(eq(schema.requisitions.id, id));
  await audit(tx, ctx.company.id, ctx.user.id, "cancel", "requisition", r.number);
}

/** Turns an approved request into a draft request for quotation or tender, its lines becoming the bill of quantities. */
export async function convertRequisition(tx: Tx, ctx: Ctx, id: string, kind: "rfq" | "tender"): Promise<string> {
  const r = await lock(tx, ctx.company.id, id);
  if (r.status !== "approved") throw new UserError("err_requisition_state");
  const lines = await tx.select().from(schema.requisitionLines).where(eq(schema.requisitionLines.requisitionId, id)).orderBy(asc(schema.requisitionLines.sortOrder));
  const number = await nextNumber(tx, schema.tenders, { number: schema.tenders.number, companyId: schema.tenders.companyId }, ctx.company.id, kind === "rfq" ? "RFQ" : "TND");
  const [tender] = await tx.insert(schema.tenders).values({
    companyId: ctx.company.id, number, kind, title: r.title, description: r.justification, projectId: r.projectId, budgetItemId: r.budgetItemId,
    estimate: r.total, technicalWeight: kind === "rfq" ? 0 : 70, openToAll: kind === "tender", createdBy: ctx.user.id,
  }).returning({ id: schema.tenders.id });
  if (lines.length) await tx.insert(schema.tenderItems).values(lines.map((l) => ({ companyId: ctx.company.id, tenderId: tender.id, sortOrder: l.sortOrder, description: l.description, unit: l.unit, quantity: l.quantity })));
  await tx.update(schema.requisitions).set({ status: "converted", tenderId: tender.id }).where(eq(schema.requisitions.id, id));
  await audit(tx, ctx.company.id, ctx.user.id, "convert", "requisition", r.number, { tender: number });
  return tender.id;
}

/** Tells one person by email, when they have an address. The app always shows it too, so a failed email stops nothing. */
export async function notifyUser(userId: string | null, subject: string, text: string) {
  if (!userId) return;
  const db = await getDb();
  const [u] = await db.select({ email: schema.users.email, name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId));
  if (!u?.email) return;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)).replace(/\n/g, "<br>");
  try { await sendMail(u.email, subject, `${u.name},\n\n${text}`, `<p>${esc(u.name)},</p><p>${esc(text)}</p>`); }
  catch (e) { console.error("Email failed", e); }
}

/** Requests waiting for this person's approval. */
export async function awaitingMe(db: Db, ctx: Ctx) {
  return db.select({ r: schema.requisitions, step: schema.requisitionSteps.name }).from(schema.requisitionSteps)
    .innerJoin(schema.requisitions, eq(schema.requisitions.id, schema.requisitionSteps.requisitionId))
    .where(and(eq(schema.requisitionSteps.approverId, ctx.user.id), eq(schema.requisitionSteps.status, "pending"), eq(schema.requisitions.companyId, ctx.company.id), inArray(schema.requisitions.status, ["submitted"])));
}
