import "server-only";
import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import type { BudgetPlan, LogframeLevel, VoucherStatus, VoucherStep } from "@/db/schema";
import { round2 } from "./format";
import { saveEntry, UserError, type LineInput } from "./ledger";
import { audit } from "./audit";

export const LEVELS: LogframeLevel[] = ["goal", "outcome", "output", "activity", "sub_activity"];

/** The level a row must have under a parent of the given level; null means the top of the framework. */
export function childLevel(parent: LogframeLevel | null): LogframeLevel | null {
  if (!parent) return "goal";
  return LEVELS[LEVELS.indexOf(parent) + 1] ?? null;
}

/** Fund requests that use up budget: everything asked for and not cancelled. */
export const COMMITTED: VoucherStatus[] = ["submitted", "reviewed", "approved", "authorized", "paid"];

export type LogItem = typeof schema.logframeItems.$inferSelect;
export type LogRow = LogItem & {
  depth: number; hasChildren: boolean; isLine: boolean;
  totalBudget: number; executed: number; paid: number;
  achieved: number;        // quantity done, baseline included (budget lines only)
  activityExecution: number; // 0 to 1: quantity done over planned; above a line's plan it counts as done
  budgetExecution: number; // spent over budget; above 1 means overspent
  weight: number;          // this row's share of the whole budget
  performance: number;     // activity execution times weight
};

/** A row can carry budget only at activity or sub-activity level, and only when nothing sits under it. */
export const isBudgetLine = (level: LogframeLevel, hasChildren: boolean) => (level === "activity" || level === "sub_activity") && !hasChildren;

/**
 * The framework of a project in reading order. Budget, execution and achievement come from the budget lines and add
 * up the tree by weight: a parent's execution is the average of what is under it, weighted by budget.
 */
export async function logframe(db: Db | Tx, companyId: string, projectId: string, opts: { to?: string } = {}): Promise<LogRow[]> {
  const lineConds = [eq(schema.paymentVouchers.companyId, companyId), eq(schema.paymentVouchers.projectId, projectId), inArray(schema.paymentVouchers.status, COMMITTED)];
  if (opts.to) lineConds.push(lte(schema.paymentVouchers.date, opts.to));
  const doneConds = [eq(schema.achievements.companyId, companyId), eq(schema.achievements.projectId, projectId)];
  if (opts.to) doneConds.push(lte(schema.achievements.date, opts.to));
  const [items, spend, done] = await Promise.all([
    db.select().from(schema.logframeItems).where(and(eq(schema.logframeItems.companyId, companyId), eq(schema.logframeItems.projectId, projectId))),
    db.select({ id: schema.voucherLines.budgetItemId, status: schema.paymentVouchers.status, total: sql<string>`sum(${schema.voucherLines.amount})` })
      .from(schema.voucherLines).innerJoin(schema.paymentVouchers, eq(schema.paymentVouchers.id, schema.voucherLines.voucherId))
      .where(and(...lineConds)).groupBy(schema.voucherLines.budgetItemId, schema.paymentVouchers.status),
    db.select({ id: schema.achievements.budgetItemId, total: sql<string>`sum(${schema.achievements.quantity})` }).from(schema.achievements)
      .where(and(...doneConds)).groupBy(schema.achievements.budgetItemId),
  ]);
  const childrenOf = new Map<string | null, LogItem[]>();
  for (const i of items) childrenOf.set(i.parentId, [...(childrenOf.get(i.parentId) ?? []), i]);
  for (const list of childrenOf.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, undefined, { numeric: true }));
  const grand = items.filter((i) => isBudgetLine(i.level, !!childrenOf.get(i.id)?.length)).reduce((s, i) => s + i.budget, 0);
  const out: LogRow[] = [];
  type Sum = { budget: number; requested: number; paid: number; doneValue: number };
  const walk = (item: LogItem, depth: number): Sum => {
    const kids = childrenOf.get(item.id) ?? [];
    const row: LogRow = {
      ...item, depth, hasChildren: kids.length > 0, isLine: isBudgetLine(item.level, kids.length > 0),
      totalBudget: 0, executed: 0, paid: 0, achieved: 0, activityExecution: 0, budgetExecution: 0, weight: 0, performance: 0,
    };
    out.push(row);
    let sum: Sum = { budget: 0, requested: 0, paid: 0, doneValue: 0 };
    if (row.isLine) {
      const mine = spend.filter((s) => s.id === item.id);
      row.achieved = round2(item.baselineQty + Number(done.find((d) => d.id === item.id)?.total ?? 0));
      const share = item.quantity > 0 ? Math.min(1, row.achieved / item.quantity) : 0;
      sum = {
        budget: item.budget,
        requested: round2(item.baselineSpent + mine.reduce((s, r) => s + Number(r.total), 0)),
        paid: round2(item.baselineSpent + mine.filter((r) => r.status === "paid").reduce((s, r) => s + Number(r.total), 0)),
        doneValue: item.budget * share,
      };
    } else {
      for (const k of kids) {
        const c = walk(k, depth + 1);
        sum = { budget: sum.budget + c.budget, requested: sum.requested + c.requested, paid: sum.paid + c.paid, doneValue: sum.doneValue + c.doneValue };
      }
    }
    row.totalBudget = round2(sum.budget); row.executed = round2(sum.requested); row.paid = round2(sum.paid);
    row.activityExecution = sum.budget ? sum.doneValue / sum.budget : 0;
    row.budgetExecution = sum.budget ? sum.requested / sum.budget : 0;
    row.weight = grand ? sum.budget / grand : 0;
    row.performance = row.activityExecution * row.weight;
    return sum;
  };
  for (const top of childrenOf.get(null) ?? []) walk(top, 0);
  return out;
}

/** The whole project, added up from its top-level rows. */
export function projectTotals(rows: LogRow[]) {
  const lines = rows.filter((r) => r.isLine);
  const budget = round2(lines.reduce((s, r) => s + r.totalBudget, 0));
  const requested = round2(lines.reduce((s, r) => s + r.executed, 0));
  const paid = round2(lines.reduce((s, r) => s + r.paid, 0));
  const own = round2(lines.reduce((s, r) => s + r.ownContribution, 0));
  const activityExecution = budget ? lines.reduce((s, r) => s + r.activityExecution * r.totalBudget, 0) / budget : 0;
  return { budget, requested, paid, balance: round2(budget - requested), own, donor: round2(budget - own), activityExecution, budgetExecution: budget ? requested / budget : 0 };
}

/** Every budget line of the company with what is left on it, for the fund request form. */
export async function budgetLines(db: Db | Tx, companyId: string) {
  const projects = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, companyId), eq(schema.projects.isActive, true))).orderBy(schema.projects.code);
  const out: { project: typeof projects[number]; lines: LogRow[] }[] = [];
  for (const project of projects) {
    const lines = (await logframe(db, companyId, project.id)).filter((r) => r.isLine);
    if (lines.length) out.push({ project, lines });
  }
  return out;
}

/** Numbers a new row from its place in the framework: outcome 1, output 1.2, activity 1.2.3. */
async function nextCode(tx: Tx, companyId: string, projectId: string, parent: LogItem | null, level: LogframeLevel): Promise<string> {
  const siblings = await tx.select({ code: schema.logframeItems.code }).from(schema.logframeItems).where(and(
    eq(schema.logframeItems.companyId, companyId), eq(schema.logframeItems.projectId, projectId),
    parent ? eq(schema.logframeItems.parentId, parent.id) : sql`${schema.logframeItems.parentId} is null`,
  ));
  const last = Math.max(0, ...siblings.map((s) => Number(s.code.replace(/^[A-Z]+/, "").split(".").pop()) || 0));
  if (level === "goal") return `G${last + 1}`;
  return parent?.level === "goal" ? String(last + 1) : `${parent!.code}.${last + 1}`;
}

/** The code a budget line is requested and reported under, unique in its project: TSK + its place in the framework. */
export const taskCodeOf = (code: string) => `TSK${code.replace(/\./g, "")}`;

export type LogInput = {
  title: string; indicator: string; target: string; verification: string; assumptions: string; accountId: string | null;
  budget: number; category: string; unit: string; quantity: number; unitCost: number; ownContribution: number; plan: BudgetPlan;
  responsible: string; startDate: string | null; endDate: string | null; baselineQty: number; baselineSpent: number;
};

/** The budget of a line is its quantity times unit cost when both are given. */
const lineBudget = (i: LogInput) => (i.quantity > 0 && i.unitCost > 0 ? round2(i.quantity * i.unitCost) : i.budget);

export async function addLogItem(tx: Tx, companyId: string, userId: string, projectId: string, parentId: string | null, input: LogInput): Promise<string> {
  let parent: LogItem | null = null;
  if (parentId) {
    [parent] = await tx.select().from(schema.logframeItems).where(and(eq(schema.logframeItems.id, parentId), eq(schema.logframeItems.companyId, companyId), eq(schema.logframeItems.projectId, projectId))).for("update");
    if (!parent) throw new UserError("err_not_found");
  }
  const level = childLevel(parent?.level ?? null);
  if (!level) throw new UserError("err_logframe_depth");
  // A budget line that has been used cannot be split: its requests would no longer sit on a budget line.
  if (parent && parent.level === "activity") {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)` }).from(schema.voucherLines).where(eq(schema.voucherLines.budgetItemId, parent.id));
    const [{ m }] = await tx.select({ m: sql<number>`count(*)` }).from(schema.achievements).where(eq(schema.achievements.budgetItemId, parent.id));
    if (Number(n) || Number(m)) throw new UserError("err_line_has_vouchers");
    if (parent.budget) await tx.update(schema.logframeItems).set({ budget: 0, quantity: 0, unitCost: 0, ownContribution: 0, plan: {} }).where(eq(schema.logframeItems.id, parent.id));
  }
  const code = await nextCode(tx, companyId, projectId, parent, level);
  const canBudget = level === "activity" || level === "sub_activity";
  const [row] = await tx.insert(schema.logframeItems).values({
    companyId, projectId, parentId: parent?.id ?? null, level, code, ...input,
    taskCode: canBudget ? taskCodeOf(code) : "",
    budget: canBudget ? lineBudget(input) : 0, accountId: canBudget ? input.accountId : null,
  }).returning({ id: schema.logframeItems.id });
  await audit(tx, companyId, userId, "create", "logframe_item", row.id, { code, level, budget: canBudget ? lineBudget(input) : 0 });
  return row.id;
}

export async function updateLogItem(tx: Tx, companyId: string, userId: string, id: string, input: LogInput) {
  const [item] = await tx.select().from(schema.logframeItems).where(and(eq(schema.logframeItems.id, id), eq(schema.logframeItems.companyId, companyId))).for("update");
  if (!item) throw new UserError("err_not_found");
  const [{ kids }] = await tx.select({ kids: sql<number>`count(*)` }).from(schema.logframeItems).where(eq(schema.logframeItems.parentId, id));
  const line = isBudgetLine(item.level, Number(kids) > 0);
  const budget = line ? lineBudget(input) : 0;
  if (line && budget < await executionOn(tx, id)) throw new UserError("err_budget_below_execution");
  await tx.update(schema.logframeItems).set(line
    ? { ...input, budget }
    : { title: input.title, indicator: input.indicator, target: input.target, verification: input.verification, assumptions: input.assumptions, responsible: input.responsible, startDate: input.startDate, endDate: input.endDate },
  ).where(eq(schema.logframeItems.id, id));
  await audit(tx, companyId, userId, "update", "logframe_item", id, { code: item.code, budget });
}

export async function deleteLogItem(tx: Tx, companyId: string, userId: string, id: string) {
  const [item] = await tx.select().from(schema.logframeItems).where(and(eq(schema.logframeItems.id, id), eq(schema.logframeItems.companyId, companyId)));
  if (!item) throw new UserError("err_not_found");
  const [{ kids }] = await tx.select({ kids: sql<number>`count(*)` }).from(schema.logframeItems).where(eq(schema.logframeItems.parentId, id));
  if (Number(kids)) throw new UserError("err_logframe_has_children");
  const [{ n }] = await tx.select({ n: sql<number>`count(*)` }).from(schema.voucherLines).where(eq(schema.voucherLines.budgetItemId, id));
  const [{ m }] = await tx.select({ m: sql<number>`count(*)` }).from(schema.tenders).where(eq(schema.tenders.budgetItemId, id));
  const [{ a }] = await tx.select({ a: sql<number>`count(*)` }).from(schema.achievements).where(eq(schema.achievements.budgetItemId, id));
  if (Number(n) || Number(m) || Number(a)) throw new UserError("err_line_has_vouchers");
  await tx.delete(schema.logframeItems).where(eq(schema.logframeItems.id, id));
  await audit(tx, companyId, userId, "delete", "logframe_item", id, { code: item.code });
}

/** What is already committed on a budget line, leaving one fund request out when asked. Includes what was spent before TAGPILOT. */
export async function executionOn(db: Db | Tx, budgetItemId: string, exceptVoucherId?: string): Promise<number> {
  const conds = [eq(schema.voucherLines.budgetItemId, budgetItemId), inArray(schema.paymentVouchers.status, COMMITTED)];
  if (exceptVoucherId) conds.push(ne(schema.paymentVouchers.id, exceptVoucherId));
  const [{ total }] = await db.select({ total: sql<string>`coalesce(sum(${schema.voucherLines.amount}), 0)` }).from(schema.voucherLines)
    .innerJoin(schema.paymentVouchers, eq(schema.paymentVouchers.id, schema.voucherLines.voucherId)).where(and(...conds));
  const [item] = await db.select({ baseline: schema.logframeItems.baselineSpent }).from(schema.logframeItems).where(eq(schema.logframeItems.id, budgetItemId));
  return round2(Number(total) + (item?.baseline ?? 0));
}

/** The budget line a request may be charged to, locked so that two requests cannot both take the last of the money. */
async function lockLine(tx: Tx, companyId: string, budgetItemId: string): Promise<LogItem> {
  const [line] = await tx.select().from(schema.logframeItems).where(and(eq(schema.logframeItems.id, budgetItemId), eq(schema.logframeItems.companyId, companyId))).for("update");
  if (!line) throw new UserError("err_not_found");
  const [{ kids }] = await tx.select({ kids: sql<number>`count(*)` }).from(schema.logframeItems).where(eq(schema.logframeItems.parentId, budgetItemId));
  if (!isBudgetLine(line.level, Number(kids) > 0)) throw new UserError("err_not_budget_line");
  return line;
}

export const assertBudgetLine = lockLine;

async function lockVoucher(tx: Tx, companyId: string, id: string) {
  const [v] = await tx.select().from(schema.paymentVouchers).where(and(eq(schema.paymentVouchers.id, id), eq(schema.paymentVouchers.companyId, companyId))).for("update");
  if (!v) throw new UserError("err_not_found");
  return v;
}

const sign = (tx: Tx, companyId: string, voucherId: string, step: VoucherStep, userId: string, note = "") =>
  tx.insert(schema.voucherSteps).values({ companyId, voucherId, step, userId, note });

/** Prepares a draft: it goes for review. Budget and execution are frozen on each line, and overspending is refused. */
export async function submitVoucher(tx: Tx, companyId: string, userId: string, id: string) {
  const v = await lockVoucher(tx, companyId, id);
  if (v.status !== "draft") throw new UserError("err_voucher_state");
  if (v.requestedBy !== userId) throw new UserError("err_voucher_not_yours");
  const lines = await tx.select().from(schema.voucherLines).where(eq(schema.voucherLines.voucherId, id));
  if (!lines.length || !(v.amount > 0)) throw new UserError("err_amount");
  // Locked in a fixed order, so two requests on the same lines wait for each other instead of deadlocking.
  for (const l of [...lines].sort((a, b) => a.budgetItemId.localeCompare(b.budgetItemId))) await lockLine(tx, companyId, l.budgetItemId);
  const used = new Map<string, number>();
  for (const l of lines) {
    const line = await lockLine(tx, companyId, l.budgetItemId);
    const previous = round2(await executionOn(tx, l.budgetItemId, id) + (used.get(l.budgetItemId) ?? 0));
    if (round2(previous + l.amount) > line.budget) throw new UserError("err_over_budget");
    used.set(l.budgetItemId, round2((used.get(l.budgetItemId) ?? 0) + l.amount));
    await tx.update(schema.voucherLines).set({ activityBudget: line.budget, previousExecution: previous }).where(eq(schema.voucherLines.id, l.id));
  }
  await tx.update(schema.paymentVouchers).set({ status: "submitted", submittedAt: new Date() }).where(eq(schema.paymentVouchers.id, id));
  await sign(tx, companyId, id, "prepared", userId);
  await audit(tx, companyId, userId, "prepare", "payment_voucher", v.number, { amount: v.amount });
}

/** The signatures after preparing, in order: each one needs the one before it. */
export const NEXT_STEP: Partial<Record<VoucherStatus, { step: VoucherStep; to: VoucherStatus; area: "voucher_review" | "voucher_approve" | "voucher_authorize" }>> = {
  submitted: { step: "reviewed", to: "reviewed", area: "voucher_review" },
  reviewed: { step: "approved", to: "approved", area: "voucher_approve" },
  approved: { step: "authorized", to: "authorized", area: "voucher_authorize" },
};

/** Signs the next step. One person signs one step of a request, so that four eyes see it; an admin may stand in for anyone. */
export async function signVoucher(tx: Tx, companyId: string, userId: string, isAdmin: boolean, id: string, note: string) {
  const v = await lockVoucher(tx, companyId, id);
  const next = NEXT_STEP[v.status];
  if (!next) throw new UserError("err_voucher_state");
  const steps = await tx.select().from(schema.voucherSteps).where(eq(schema.voucherSteps.voucherId, id));
  const current = steps.filter((s) => (["prepared", "reviewed", "approved", "authorized"] as VoucherStep[]).includes(s.step));
  if (!isAdmin && current.some((s) => s.userId === userId)) throw new UserError("err_self_approval");
  await tx.update(schema.paymentVouchers).set({ status: next.to, decidedBy: userId, decidedAt: new Date(), decisionNote: note }).where(eq(schema.paymentVouchers.id, id));
  await sign(tx, companyId, id, next.step, userId, note);
  await audit(tx, companyId, userId, next.step, "payment_voucher", v.number, { note });
}

/** Sends a request back to its author to correct: the signatures so far start over, and its money is free again. */
export async function returnVoucher(tx: Tx, companyId: string, userId: string, id: string, note: string) {
  const v = await lockVoucher(tx, companyId, id);
  if (!NEXT_STEP[v.status] && v.status !== "authorized") throw new UserError("err_voucher_state");
  await tx.delete(schema.voucherSteps).where(and(eq(schema.voucherSteps.voucherId, id), inArray(schema.voucherSteps.step, ["prepared", "reviewed", "approved", "authorized"])));
  await tx.update(schema.paymentVouchers).set({ status: "draft", submittedAt: null, decisionNote: note }).where(eq(schema.paymentVouchers.id, id));
  await sign(tx, companyId, id, "returned", userId, note);
  await audit(tx, companyId, userId, "return", "payment_voucher", v.number, { note });
}

export async function cancelVoucher(tx: Tx, companyId: string, userId: string, id: string, note: string) {
  const v = await lockVoucher(tx, companyId, id);
  if (v.status === "paid" || v.status === "rejected") throw new UserError("err_voucher_state");
  await tx.update(schema.paymentVouchers).set({ status: "rejected", decidedBy: userId, decidedAt: new Date(), decisionNote: note }).where(eq(schema.paymentVouchers.id, id));
  await sign(tx, companyId, id, "cancelled", userId, note);
  await audit(tx, companyId, userId, "cancel", "payment_voucher", v.number, { note });
}

/** Records that an authorized request was paid, for an organisation that keeps its books elsewhere. */
export async function markVoucherPaid(tx: Tx, companyId: string, userId: string, id: string, reference: string) {
  const v = await lockVoucher(tx, companyId, id);
  if (v.status !== "authorized") throw new UserError("err_voucher_state");
  await tx.update(schema.paymentVouchers).set({ status: "paid", paidBy: userId, paidAt: new Date(), paymentReference: reference }).where(eq(schema.paymentVouchers.id, id));
  await sign(tx, companyId, id, "paid", userId, reference);
  await audit(tx, companyId, userId, "pay", "payment_voucher", v.number, { reference });
}

/** Pays an authorized request and posts it: debit each budget line's account, credit the money account. */
export async function payVoucher(tx: Tx, companyId: string, userId: string, id: string, input: { date: string; moneyAccountId: string; expenseAccountId: string; reference: string }): Promise<string> {
  const v = await lockVoucher(tx, companyId, id);
  if (v.status !== "authorized") throw new UserError("err_voucher_state");
  if (!input.moneyAccountId) throw new UserError("err_required");
  const [money] = await tx.select().from(schema.accounts).where(and(eq(schema.accounts.id, input.moneyAccountId), eq(schema.accounts.companyId, companyId)));
  if (!money || !money.subtype || !["bank", "cash", "momo"].includes(money.subtype)) throw new UserError("err_account");
  const rows = await tx.select({ l: schema.voucherLines, accountId: schema.logframeItems.accountId }).from(schema.voucherLines)
    .innerJoin(schema.logframeItems, eq(schema.logframeItems.id, schema.voucherLines.budgetItemId)).where(eq(schema.voucherLines.voucherId, id)).orderBy(schema.voucherLines.lineNo);
  const lines: LineInput[] = rows.map(({ l, accountId }) => {
    const account = accountId ?? input.expenseAccountId;
    if (!account) throw new UserError("err_required");
    return { accountId: account, debit: l.amount, credit: 0, description: (l.description || v.description).slice(0, 200) };
  });
  lines.push({ accountId: input.moneyAccountId, debit: 0, credit: v.amount, description: input.reference || v.payee || v.description.slice(0, 200) });
  const entryId = await saveEntry(tx, companyId, userId, {
    date: input.date, reference: input.reference || v.number, memo: `${v.number} · ${v.description}`.slice(0, 500),
    partnerId: v.partnerId, projectId: v.projectId, source: "voucher", sourceId: v.id, attachmentId: v.attachmentId, lines,
  }, true);
  await tx.update(schema.paymentVouchers).set({ status: "paid", paidBy: userId, paidAt: new Date(), entryId, paymentReference: input.reference }).where(eq(schema.paymentVouchers.id, id));
  await sign(tx, companyId, id, "paid", userId, input.reference);
  await audit(tx, companyId, userId, "pay", "payment_voucher", v.number, { entryId, reference: input.reference });
  return entryId;
}

/** The next fund request number of a year, as on the register: 001/2025. The lock makes two people saving at once wait for each other. */
export async function nextFundRequestNumber(tx: Tx, companyId: string, date: string): Promise<string> {
  const year = date.slice(0, 4);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${companyId}:FR:${year}`}))`);
  const [row] = await tx.select({ n: sql<number>`coalesce(max(cast(split_part(${schema.paymentVouchers.number}, '/', 1) as integer)), 0)` }).from(schema.paymentVouchers)
    .where(and(eq(schema.paymentVouchers.companyId, companyId), sql`${schema.paymentVouchers.number} like ${`%/${year}`}`));
  return `${String(Number(row?.n ?? 0) + 1).padStart(3, "0")}/${year}`;
}

/** The supporting documents a fund request can need, in the order of the register. */
export const DOC_TYPES = ["fund_request", "concept_note", "purchase_order", "proforma", "contract", "delivery_note", "cheque", "ebm", "participants", "expense_slip", "mission_order", "mission_report", "fuel_report"] as const;
export type DocType = typeof DOC_TYPES[number];
