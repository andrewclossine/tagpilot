import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import type { LogframeLevel, VoucherStatus } from "@/db/schema";
import { round2 } from "./format";
import { saveEntry, UserError } from "./ledger";
import { audit } from "./audit";

export const LEVELS: LogframeLevel[] = ["goal", "outcome", "output", "activity", "sub_activity"];

/** The level a row must have under a parent of the given level; null means the top of the framework. */
export function childLevel(parent: LogframeLevel | null): LogframeLevel | null {
  if (!parent) return "goal";
  return LEVELS[LEVELS.indexOf(parent) + 1] ?? null;
}

/** Vouchers that use up budget: everything asked for and not refused. */
const COMMITTED: VoucherStatus[] = ["submitted", "approved", "paid"];

export type LogItem = typeof schema.logframeItems.$inferSelect;
export type LogRow = LogItem & {
  depth: number; hasChildren: boolean; isLine: boolean;
  totalBudget: number; executed: number; paid: number;
};

/** A row can carry budget only at activity or sub-activity level, and only when nothing sits under it. */
export const isBudgetLine = (level: LogframeLevel, hasChildren: boolean) => (level === "activity" || level === "sub_activity") && !hasChildren;

/** The framework of a project in reading order, with budget and execution added up from its budget lines. */
export async function logframe(db: Db | Tx, companyId: string, projectId: string): Promise<LogRow[]> {
  const [items, spend] = await Promise.all([
    db.select().from(schema.logframeItems).where(and(eq(schema.logframeItems.companyId, companyId), eq(schema.logframeItems.projectId, projectId))),
    db.select({
      id: schema.paymentVouchers.budgetItemId, status: schema.paymentVouchers.status,
      total: sql<string>`sum(${schema.paymentVouchers.amount})`,
    }).from(schema.paymentVouchers)
      .where(and(eq(schema.paymentVouchers.companyId, companyId), eq(schema.paymentVouchers.projectId, projectId), inArray(schema.paymentVouchers.status, COMMITTED)))
      .groupBy(schema.paymentVouchers.budgetItemId, schema.paymentVouchers.status),
  ]);
  const childrenOf = new Map<string | null, LogItem[]>();
  for (const i of items) childrenOf.set(i.parentId, [...(childrenOf.get(i.parentId) ?? []), i]);
  for (const list of childrenOf.values()) list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const out: LogRow[] = [];
  const walk = (item: LogItem, depth: number): { b: number; e: number; p: number } => {
    const kids = childrenOf.get(item.id) ?? [];
    const row: LogRow = { ...item, depth, hasChildren: kids.length > 0, isLine: isBudgetLine(item.level, kids.length > 0), totalBudget: 0, executed: 0, paid: 0 };
    out.push(row);
    let sum = { b: 0, e: 0, p: 0 };
    if (row.isLine) {
      const mine = spend.filter((s) => s.id === item.id);
      sum = {
        b: item.budget,
        e: round2(mine.reduce((s, r) => s + Number(r.total), 0)),
        p: round2(mine.filter((r) => r.status === "paid").reduce((s, r) => s + Number(r.total), 0)),
      };
    } else {
      for (const k of kids) { const c = walk(k, depth + 1); sum = { b: sum.b + c.b, e: sum.e + c.e, p: sum.p + c.p }; }
    }
    row.totalBudget = round2(sum.b); row.executed = round2(sum.e); row.paid = round2(sum.p);
    return sum;
  };
  for (const top of childrenOf.get(null) ?? []) walk(top, 0);
  return out;
}

/** Every budget line of the company with what is left on it, for the voucher form. */
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
  const last = Math.max(0, ...siblings.map((s) => Number(s.code.replace(/^G/, "").split(".").pop()) || 0));
  if (level === "goal") return `G${last + 1}`;
  return parent?.level === "goal" ? String(last + 1) : `${parent!.code}.${last + 1}`;
}

export type LogInput = { title: string; indicator: string; target: string; verification: string; assumptions: string; budget: number; accountId: string | null };

export async function addLogItem(tx: Tx, companyId: string, userId: string, projectId: string, parentId: string | null, input: LogInput): Promise<string> {
  let parent: LogItem | null = null;
  if (parentId) {
    [parent] = await tx.select().from(schema.logframeItems).where(and(eq(schema.logframeItems.id, parentId), eq(schema.logframeItems.companyId, companyId), eq(schema.logframeItems.projectId, projectId))).for("update");
    if (!parent) throw new UserError("err_not_found");
  }
  const level = childLevel(parent?.level ?? null);
  if (!level) throw new UserError("err_logframe_depth");
  // A budget line that has been charged cannot be split: its vouchers would no longer sit on a budget line.
  if (parent && (parent.level === "activity")) {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)` }).from(schema.paymentVouchers).where(eq(schema.paymentVouchers.budgetItemId, parent.id));
    if (Number(n)) throw new UserError("err_line_has_vouchers");
    if (parent.budget) await tx.update(schema.logframeItems).set({ budget: 0 }).where(eq(schema.logframeItems.id, parent.id));
  }
  const code = await nextCode(tx, companyId, projectId, parent, level);
  const canBudget = level === "activity" || level === "sub_activity";
  const [row] = await tx.insert(schema.logframeItems).values({
    companyId, projectId, parentId: parent?.id ?? null, level, code, ...input,
    budget: canBudget ? input.budget : 0, accountId: canBudget ? input.accountId : null,
  }).returning({ id: schema.logframeItems.id });
  await audit(tx, companyId, userId, "create", "logframe_item", row.id, { code, level, budget: canBudget ? input.budget : 0 });
  return row.id;
}

export async function updateLogItem(tx: Tx, companyId: string, userId: string, id: string, input: LogInput) {
  const [item] = await tx.select().from(schema.logframeItems).where(and(eq(schema.logframeItems.id, id), eq(schema.logframeItems.companyId, companyId))).for("update");
  if (!item) throw new UserError("err_not_found");
  const [{ kids }] = await tx.select({ kids: sql<number>`count(*)` }).from(schema.logframeItems).where(eq(schema.logframeItems.parentId, id));
  const line = isBudgetLine(item.level, Number(kids) > 0);
  if (line && input.budget < await executionOn(tx, id)) throw new UserError("err_budget_below_execution");
  await tx.update(schema.logframeItems).set({ ...input, budget: line ? input.budget : 0, accountId: line ? input.accountId : null }).where(eq(schema.logframeItems.id, id));
  await audit(tx, companyId, userId, "update", "logframe_item", id, { code: item.code, budget: line ? input.budget : 0 });
}

export async function deleteLogItem(tx: Tx, companyId: string, userId: string, id: string) {
  const [item] = await tx.select().from(schema.logframeItems).where(and(eq(schema.logframeItems.id, id), eq(schema.logframeItems.companyId, companyId)));
  if (!item) throw new UserError("err_not_found");
  const [{ kids }] = await tx.select({ kids: sql<number>`count(*)` }).from(schema.logframeItems).where(eq(schema.logframeItems.parentId, id));
  if (Number(kids)) throw new UserError("err_logframe_has_children");
  const [{ n }] = await tx.select({ n: sql<number>`count(*)` }).from(schema.paymentVouchers).where(eq(schema.paymentVouchers.budgetItemId, id));
  const [{ m }] = await tx.select({ m: sql<number>`count(*)` }).from(schema.tenders).where(eq(schema.tenders.budgetItemId, id));
  if (Number(n) || Number(m)) throw new UserError("err_line_has_vouchers");
  await tx.delete(schema.logframeItems).where(eq(schema.logframeItems.id, id));
  await audit(tx, companyId, userId, "delete", "logframe_item", id, { code: item.code });
}

/** What is already committed on a budget line, leaving one voucher out when asked. */
export async function executionOn(db: Db | Tx, budgetItemId: string, exceptVoucherId?: string): Promise<number> {
  const conds = [eq(schema.paymentVouchers.budgetItemId, budgetItemId), inArray(schema.paymentVouchers.status, COMMITTED)];
  if (exceptVoucherId) conds.push(ne(schema.paymentVouchers.id, exceptVoucherId));
  const [{ total }] = await db.select({ total: sql<string>`coalesce(sum(${schema.paymentVouchers.amount}), 0)` }).from(schema.paymentVouchers).where(and(...conds));
  return round2(Number(total));
}

/** The budget line a voucher may be charged to, locked so that two requests cannot both take the last of the money. */
async function lockLine(tx: Tx, companyId: string, budgetItemId: string): Promise<LogItem> {
  const [line] = await tx.select().from(schema.logframeItems).where(and(eq(schema.logframeItems.id, budgetItemId), eq(schema.logframeItems.companyId, companyId))).for("update");
  if (!line) throw new UserError("err_not_found");
  const [{ kids }] = await tx.select({ kids: sql<number>`count(*)` }).from(schema.logframeItems).where(eq(schema.logframeItems.parentId, budgetItemId));
  if (!isBudgetLine(line.level, Number(kids) > 0)) throw new UserError("err_not_budget_line");
  return line;
}

export async function assertBudgetLine(tx: Tx, companyId: string, budgetItemId: string) { return lockLine(tx, companyId, budgetItemId); }

/** Sends a draft for approval. Budget and execution are frozen on the voucher here, and overspending is refused. */
export async function submitVoucher(tx: Tx, companyId: string, userId: string, id: string) {
  const [v] = await tx.select().from(schema.paymentVouchers).where(and(eq(schema.paymentVouchers.id, id), eq(schema.paymentVouchers.companyId, companyId))).for("update");
  if (!v) throw new UserError("err_not_found");
  if (v.status !== "draft") throw new UserError("err_voucher_state");
  if (v.requestedBy !== userId) throw new UserError("err_voucher_not_yours");
  if (!(v.amount > 0)) throw new UserError("err_amount");
  const line = await lockLine(tx, companyId, v.budgetItemId);
  const previous = await executionOn(tx, v.budgetItemId, id);
  if (round2(previous + v.amount) > line.budget) throw new UserError("err_over_budget");
  await tx.update(schema.paymentVouchers).set({ status: "submitted", submittedAt: new Date(), activityBudget: line.budget, previousExecution: previous }).where(eq(schema.paymentVouchers.id, id));
  await audit(tx, companyId, userId, "submit", "payment_voucher", v.number, { amount: v.amount });
}

/** Approves or refuses a request. Nobody but an admin may approve their own request. */
export async function decideVoucher(tx: Tx, companyId: string, userId: string, isAdmin: boolean, id: string, approve: boolean, note: string) {
  const [v] = await tx.select().from(schema.paymentVouchers).where(and(eq(schema.paymentVouchers.id, id), eq(schema.paymentVouchers.companyId, companyId))).for("update");
  if (!v) throw new UserError("err_not_found");
  if (approve ? v.status !== "submitted" : v.status !== "submitted" && v.status !== "approved") throw new UserError("err_voucher_state");
  if (approve && v.requestedBy === userId && !isAdmin) throw new UserError("err_self_approval");
  await tx.update(schema.paymentVouchers).set({ status: approve ? "approved" : "rejected", decidedBy: userId, decidedAt: new Date(), decisionNote: note }).where(eq(schema.paymentVouchers.id, id));
  await audit(tx, companyId, userId, approve ? "approve" : "reject", "payment_voucher", v.number, { note });
}

/** Records that an approved voucher was paid, for an organisation that keeps its books elsewhere. */
export async function markVoucherPaid(tx: Tx, companyId: string, userId: string, id: string, reference: string) {
  const [v] = await tx.select().from(schema.paymentVouchers).where(and(eq(schema.paymentVouchers.id, id), eq(schema.paymentVouchers.companyId, companyId))).for("update");
  if (!v) throw new UserError("err_not_found");
  if (v.status !== "approved") throw new UserError("err_voucher_state");
  await tx.update(schema.paymentVouchers).set({ status: "paid", paidBy: userId, paidAt: new Date(), paymentReference: reference }).where(eq(schema.paymentVouchers.id, id));
  await audit(tx, companyId, userId, "pay", "payment_voucher", v.number, { reference });
}

/** Pays an approved voucher and posts it: debit the budget line's account, credit the money account. */
export async function payVoucher(tx: Tx, companyId: string, userId: string, id: string, input: { date: string; moneyAccountId: string; expenseAccountId: string }): Promise<string> {
  const [v] = await tx.select().from(schema.paymentVouchers).where(and(eq(schema.paymentVouchers.id, id), eq(schema.paymentVouchers.companyId, companyId))).for("update");
  if (!v) throw new UserError("err_not_found");
  if (v.status !== "approved") throw new UserError("err_voucher_state");
  if (!input.moneyAccountId || !input.expenseAccountId) throw new UserError("err_required");
  const [money] = await tx.select().from(schema.accounts).where(and(eq(schema.accounts.id, input.moneyAccountId), eq(schema.accounts.companyId, companyId)));
  if (!money || !money.subtype || !["bank", "cash", "momo"].includes(money.subtype)) throw new UserError("err_account");
  const entryId = await saveEntry(tx, companyId, userId, {
    date: input.date, reference: v.number, memo: `${v.number} · ${v.description}`.slice(0, 500),
    partnerId: v.partnerId, projectId: v.projectId, source: "voucher", sourceId: v.id, attachmentId: v.attachmentId,
    lines: [
      { accountId: input.expenseAccountId, debit: v.amount, credit: 0, description: v.description.slice(0, 200) },
      { accountId: input.moneyAccountId, debit: 0, credit: v.amount, description: v.payee || v.description.slice(0, 200) },
    ],
  }, true);
  await tx.update(schema.paymentVouchers).set({ status: "paid", paidBy: userId, paidAt: new Date(), entryId }).where(eq(schema.paymentVouchers.id, id));
  await audit(tx, companyId, userId, "pay", "payment_voucher", v.number, { entryId });
  return entryId;
}
