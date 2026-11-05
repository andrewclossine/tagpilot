import "server-only";
import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "./auth";
import type { T } from "./i18n";
import { addDays, daysBetween, round2, today } from "./format";
import { logframe, projectTotals, type LogRow } from "./programs";

export type LineFlag = "overspent" | "late" | "ahead_money" | "unfunded_activity";

/** What deserves a look on a budget line. */
export function lineFlags(r: LogRow, on: string): LineFlag[] {
  if (!r.isLine) return [];
  const flags: LineFlag[] = [];
  if (r.executed > r.totalBudget + 0.01) flags.push("overspent");
  if (r.endDate && r.endDate < on && r.activityExecution < 1) flags.push("late");
  // Money going out well ahead of the work done, or the work done with no money requested.
  if (r.budgetExecution - r.activityExecution > 0.2) flags.push("ahead_money");
  if (r.activityExecution - r.budgetExecution > 0.2) flags.push("unfunded_activity");
  return flags;
}

/** How far through its time a line should be on a date: 0 before it starts, 1 once it ends. */
export function expectedProgress(r: Pick<LogRow, "startDate" | "endDate">, on: string): number | null {
  if (!r.startDate || !r.endDate) return null;
  if (on <= r.startDate) return 0;
  if (on >= r.endDate) return 1;
  const all = daysBetween(r.startDate, r.endDate);
  return all > 0 ? daysBetween(r.startDate, on) / all : 1;
}

export async function loadStatus(ctx: Ctx, projectId: string, to?: string) {
  const db = await getDb();
  const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.companyId, ctx.company.id)));
  if (!project) return null;
  const on = to || today();
  const [rows, funds] = await Promise.all([
    logframe(db, ctx.company.id, projectId, { to: on }),
    db.select().from(schema.projectFunds).where(and(eq(schema.projectFunds.companyId, ctx.company.id), eq(schema.projectFunds.projectId, projectId))).orderBy(schema.projectFunds.date),
  ]);
  const totals = projectTotals(rows);
  const lines = rows.filter((r) => r.isLine);
  const planned = totals.budget ? lines.reduce((s, r) => s + (expectedProgress(r, on) ?? 0) * r.totalBudget, 0) / totals.budget : 0;
  const received = round2(funds.filter((f) => f.date <= on).reduce((s, f) => s + f.amount, 0));
  return { project, rows, totals, funds, received, on, plannedProgress: planned };
}

/** Quarters of a project, in order, from what its budget plans and how long it runs. */
export function quartersOf(project: { startDate: string | null; endDate: string | null }, rows: LogRow[]) {
  const fromPlan = rows.flatMap((r) => Object.keys(r.plan));
  let years = Math.max(1, ...fromPlan.map((k) => Number(k[1]) || 1));
  if (project.startDate && project.endDate) years = Math.max(years, Math.ceil(daysBetween(project.startDate, project.endDate) / 365));
  const out: { key: string; label: string; from: string | null; to: string | null }[] = [];
  for (let y = 1; y <= years; y++) for (let q = 1; q <= 4; q++) {
    let from: string | null = null, to: string | null = null;
    if (project.startDate) {
      const d = new Date(`${project.startDate}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + (y - 1) * 12 + (q - 1) * 3); from = d.toISOString().slice(0, 10);
      d.setUTCMonth(d.getUTCMonth() + 3); to = addDays(d.toISOString().slice(0, 10), -1);
    }
    out.push({ key: `Y${y}Q${q}`, label: `Y${y} Q${q}`, from, to });
  }
  return out;
}

/** The implementation status as an Excel file, laid out like the budget performance sheet. */
export async function statusWorkbook(ctx: Ctx, projectId: string, t: T, to?: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const s = await loadStatus(ctx, projectId, to);
  if (!s) return null;
  const wb = new ExcelJS.Workbook();
  wb.creator = "TAGPILOT";
  const ws = wb.addWorksheet(t("st_title").slice(0, 31));
  ws.addRow([s.project.name]).font = { bold: true, size: 14 };
  ws.addRow([`${t("st_as_of")} ${s.on} · ${ctx.company.currency}`]);
  ws.addRow([]);
  const head = ws.addRow(["TSK", t("st_activity"), t("gr_unit"), t("qty"), t("st_unit_cost"), t("budget"), t("wp_start"), t("wp_end"), t("st_achieved"), t("st_balance_target"), t("st_requested"), t("prj_paid"), t("balance_left"), t("st_activity_exec"), t("st_budget_exec"), t("st_weight"), t("st_performance")]);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0EAFF" } }; c.alignment = { wrapText: true, vertical: "middle" }; });
  for (const r of s.rows) {
    if (r.level === "goal" || r.level === "outcome") continue;
    const row = ws.addRow(r.isLine
      ? [r.taskCode, r.title, r.unit, r.quantity, r.unitCost, r.totalBudget, r.startDate ?? "", r.endDate ?? "", r.achieved, round2(r.quantity - r.achieved), r.executed, r.paid, round2(r.totalBudget - r.executed), r.activityExecution, r.budgetExecution, r.weight, r.performance]
      : ["", `${r.code} ${r.title}`, "", "", "", r.totalBudget, r.startDate ?? "", r.endDate ?? "", "", "", r.executed, r.paid, round2(r.totalBudget - r.executed), r.activityExecution, r.budgetExecution, r.weight, r.performance]);
    if (!r.isLine) row.font = { bold: true };
  }
  const total = ws.addRow(["", t("total"), "", "", "", s.totals.budget, "", "", "", "", s.totals.requested, s.totals.paid, s.totals.balance, s.totals.activityExecution, s.totals.budgetExecution, 1, s.totals.activityExecution]);
  total.font = { bold: true };
  ws.columns.forEach((c, i) => { c.width = i === 1 ? 52 : 14; });
  for (const col of [5, 6, 11, 12, 13]) ws.getColumn(col).numFmt = "#,##0";
  for (const col of [14, 15, 16, 17]) ws.getColumn(col).numFmt = "0.0%";
  ws.views = [{ state: "frozen", ySplit: 4 }];
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `implementation-status-${s.project.code}-${s.on}.xlsx` };
}
