import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import { audit } from "./audit";
import { addDays, lastDayOfMonth, round2, today } from "./format";
import { UserError } from "./ledger";
import { logframe, type LogRow } from "./programs";

export const SCHEDULES = ["weekly", "biweekly", "monthly", "quarterly", "annually"] as const;
export type Schedule = (typeof SCHEDULES)[number];
export const isSchedule = (s: string): s is Schedule => (SCHEDULES as readonly string[]).includes(s);

/** The period a date falls in: Monday to Sunday, a calendar month, quarter or year. Two weeks count from the chosen date. */
export function periodOf(schedule: Schedule, date: string): { from: string; to: string } {
  const [y, m] = date.split("-").map(Number);
  if (schedule === "weekly") {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const from = addDays(date, day === 0 ? -6 : 1 - day);
    return { from, to: addDays(from, 6) };
  }
  if (schedule === "biweekly") return { from: date, to: addDays(date, 13) };
  if (schedule === "monthly") { const month = date.slice(0, 7); return { from: `${month}-01`, to: lastDayOfMonth(month) }; }
  if (schedule === "quarterly") {
    const first = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: `${y}-${String(first).padStart(2, "0")}-01`, to: lastDayOfMonth(`${y}-${String(first + 2).padStart(2, "0")}`) };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export type ReportLine = { id: string; previous: number; current: number; total: number; note: string; weighted: number; share: number };

/** Each budget line's previous achievement (baseline included), this report's, and the running total against its target. */
export async function loadReportLines(db: Db | Tx, companyId: string, projectId: string, reportId: string | null, to: string, rows: LogRow[]) {
  const done = await db.select().from(schema.achievements)
    .where(and(eq(schema.achievements.companyId, companyId), eq(schema.achievements.projectId, projectId), lte(schema.achievements.date, to)));
  const lines = rows.filter((r) => r.isLine);
  const grand = lines.reduce((s, r) => s + r.budget, 0);
  const byId = new Map<string, ReportLine>();
  let before = 0, after = 0;
  for (const r of lines) {
    const mine = done.filter((a) => a.budgetItemId === r.id);
    const current = round2(mine.filter((a) => a.reportId === reportId && reportId).reduce((s, a) => s + a.quantity, 0));
    const previous = round2(r.baselineQty + mine.filter((a) => a.reportId !== reportId || !reportId).reduce((s, a) => s + a.quantity, 0));
    const total = round2(previous + current);
    const share = r.quantity > 0 ? Math.min(1, total / r.quantity) : 0;
    const weight = grand ? r.budget / grand : 0;
    before += (r.quantity > 0 ? Math.min(1, previous / r.quantity) : 0) * weight;
    after += share * weight;
    byId.set(r.id, { id: r.id, previous, current, total, share, weighted: share * weight, note: mine.find((a) => a.reportId === reportId && reportId)?.description ?? "" });
  }
  return { byId, before, after };
}

/**
 * Saves a report for a period. Periods of one project cannot overlap, whatever their schedule: otherwise the same work
 * would count twice. Sending a report for the same period again replaces it.
 */
export async function saveReport(tx: Tx, companyId: string, userId: string, canEditOthers: boolean, projectId: string, input: {
  schedule: Schedule; date: string; attachmentId: string | null; lines: { itemId: string; quantity: number; description: string }[];
}) {
  const { from, to } = periodOf(input.schedule, input.date);
  const now = today();
  if (from > now) throw new UserError("err_report_future");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${projectId}:REPORT`}))`);
  const others = await tx.select().from(schema.achievementReports)
    .where(and(eq(schema.achievementReports.projectId, projectId), lte(schema.achievementReports.periodFrom, to), gte(schema.achievementReports.periodTo, from)));
  const same = others.find((o) => o.schedule === input.schedule && o.periodFrom === from && o.periodTo === to);
  if (others.some((o) => o !== same)) throw new UserError("err_report_overlap");
  if (same && !canEditOthers && same.createdBy !== userId) throw new UserError("err_voucher_not_yours");
  const rows = await logframe(tx, companyId, projectId);
  const lineIds = new Set(rows.filter((r) => r.isLine).map((r) => r.id));
  const wanted = input.lines.filter((l) => l.quantity !== 0);
  if (wanted.some((l) => l.quantity < 0)) throw new UserError("err_amount");
  if (wanted.some((l) => !lineIds.has(l.itemId))) throw new UserError("err_not_found");
  if (!wanted.length) throw new UserError("err_required");
  let reportId = same?.id;
  if (reportId) {
    const [kept] = await tx.select({ attachmentId: schema.achievements.attachmentId }).from(schema.achievements).where(eq(schema.achievements.reportId, reportId)).limit(1);
    input.attachmentId ??= kept?.attachmentId ?? null;
    await tx.delete(schema.achievements).where(eq(schema.achievements.reportId, reportId));
  } else {
    const [row] = await tx.insert(schema.achievementReports).values({ companyId, projectId, schedule: input.schedule, periodFrom: from, periodTo: to, createdBy: userId }).returning({ id: schema.achievementReports.id });
    reportId = row.id;
  }
  // The work counts from the period's end, or today while the period is still running.
  const date = to < now ? to : now;
  await tx.insert(schema.achievements).values(wanted.map((l) => ({
    companyId, projectId, budgetItemId: l.itemId, date, quantity: l.quantity, description: l.description, attachmentId: input.attachmentId, enteredBy: userId, reportId,
  })));
  await audit(tx, companyId, userId, same ? "update" : "create", "achievement_report", reportId, { schedule: input.schedule, from, to, lines: wanted.length });
  return reportId;
}

export async function deleteReport(tx: Tx, companyId: string, userId: string, canEditOthers: boolean, id: string) {
  const [r] = await tx.select().from(schema.achievementReports).where(and(eq(schema.achievementReports.id, id), eq(schema.achievementReports.companyId, companyId)));
  if (!r) throw new UserError("err_not_found");
  if (!canEditOthers && r.createdBy !== userId) throw new UserError("err_voucher_not_yours");
  await tx.delete(schema.achievementReports).where(eq(schema.achievementReports.id, id));
  await audit(tx, companyId, userId, "delete", "achievement_report", id, { schedule: r.schedule, from: r.periodFrom, to: r.periodTo });
  return r.projectId;
}
