import "server-only";
import ExcelJS from "exceljs";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { schema } from "@/db";
import type { LogframeLevel } from "@/db/schema";
import { audit } from "./audit";
import { round2 } from "./format";
import type { T } from "./i18n";
import { UserError } from "./ledger";
import { addLogItem, type LogInput } from "./programs";

/** "Input" is the sub_activity level of the budget tree. */
type TemplateLevel = "goal" | "outcome" | "output" | "activity" | "sub_activity";
export type TemplateRow = { level: TemplateLevel; title: string; unit: string; quantity: number; unitCost: number; budget: number; own: number; row: number };
export type TemplateIssue = { row: number; code: "level" | "title" | "chain" | "money" | "amount" | "own" | "both" };

const HEAD_ROW = 5, FIRST_ROW = 6, LAST_ROW = 1005;
const PARENT: Record<TemplateLevel, TemplateLevel | null> = { goal: null, outcome: "goal", output: "outcome", activity: "output", sub_activity: "activity" };
const COL = { level: 1, title: 2, unit: 3, quantity: 4, unitCost: 5, total: 6, own: 7 };

/** The workbook people fill in: one row per result, in the order of the result chain. */
export async function budgetTemplate(t: T, currency: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TAGPILOT";
  const levels = (["goal", "outcome", "output", "activity", "sub_activity"] as const).map((l) => t(`lv_${l}`));
  const headers = [t("tm_col_level"), t("tm_col_title"), t("bg_unit"), t("bg_units"), `${t("st_unit_cost")} (${currency})`, `${t("bg_total_cost")} (${currency})`, `${t("bs_own")} (${currency})`];
  const dress = (ws: ExcelJS.Worksheet, title: string) => {
    ws.getCell("A1").value = title; ws.getCell("A1").font = { bold: true, size: 14 };
    ws.getCell("A2").value = t("tm_sheet_help"); ws.getCell("A2").font = { italic: true };
    const head = ws.getRow(HEAD_ROW);
    head.values = headers;
    head.font = { bold: true };
    head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0EAFF" } }; c.alignment = { wrapText: true, vertical: "middle" }; });
    [18, 64, 16, 14, 16, 18, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    for (const col of [COL.quantity, COL.unitCost, COL.total, COL.own]) ws.getColumn(col).numFmt = "#,##0.##";
    ws.views = [{ state: "frozen", ySplit: HEAD_ROW }];
  };
  const shade: Record<number, string> = { 0: "FFDCE6F7", 1: "FFE7EEF9", 2: "FFF1F5FB" };

  const ws = wb.addWorksheet(t("budget"));
  dress(ws, t("tm_title"));
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
    ws.getCell(r, COL.level).dataValidation = { type: "list", allowBlank: true, formulae: [`"${levels.join(",")}"`], showErrorMessage: true, errorTitle: t("tm_col_level"), error: t("tm_issue_level").replace("{row}", String(r)) };
    ws.getCell(r, COL.total).value = { formula: `IF(AND(ISNUMBER(D${r}),ISNUMBER(E${r})),D${r}*E${r},"")`, result: "" } as ExcelJS.CellFormulaValue;
  }

  const ex = wb.addWorksheet(t("tm_example"));
  dress(ex, t("tm_example_title"));
  const sample: [number, string, string?, number?, number?, number?][] = [
    [0, t("tm_ex_goal")], [1, t("tm_ex_outcome")], [2, t("tm_ex_output")],
    [3, t("tm_ex_activity1")], [4, t("tm_ex_input1"), "Pcs", 10, 150000, 200000], [4, t("tm_ex_input2"), "Days", 5, 80000],
    [2, t("tm_ex_output2")], [3, t("tm_ex_activity3"), "Sessions", 4, 250000],
    [1, t("tm_ex_outcome2")], [2, t("tm_ex_output3")], [3, t("tm_ex_activity4"), "Months", 12, 300000],
  ];
  sample.forEach(([level, title, unit, qty, cost, own], i) => {
    const r = ex.getRow(FIRST_ROW + i);
    r.values = [levels[level], title, unit ?? "", qty ?? "", cost ?? "", qty && cost ? qty * cost : "", own ?? ""];
    if (level < 3) { r.font = { bold: true }; r.eachCell({ includeEmpty: true }, (c, n) => { if (n <= headers.length) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: shade[level] } }; }); }
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const text = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((x) => x.text).join("").trim();
    if ("result" in v) return text((v as { result: unknown }).result);
    if ("text" in v) return String((v as { text: unknown }).text).trim();
    return "";
  }
  return String(v).trim();
};
const num = (v: unknown): number => {
  const s = text(v).replace(/[\s,  ]/g, "");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};
const levelOf = (s: string): TemplateLevel | null => {
  const l = s.toLowerCase();
  if (/input|intrant|sub.?activit|sous.?activit/.test(l)) return "sub_activity";
  if (/goal|impact|objectif/.test(l)) return "goal";
  if (/outcome|effet/.test(l)) return "outcome";
  if (/output|produit/.test(l)) return "output";
  if (/activit/.test(l)) return "activity";
  return null;
};

/** Reads a filled template. Anything wrong is reported by row, and nothing is saved until all of it is right. */
export async function readBudgetTemplate(buffer: Buffer): Promise<{ rows: TemplateRow[]; issues: TemplateIssue[] }> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer); } catch { throw new UserError("err_import_file"); }
  const ws = wb.worksheets[0];
  const headLevel = ws ? text(ws.getCell(HEAD_ROW, COL.level).value).toLowerCase() : "";
  if (!/level|niveau/.test(headLevel)) throw new UserError("err_template_file");
  const rows: TemplateRow[] = [], issues: TemplateIssue[] = [];
  const seen = new Set<TemplateLevel>();
  for (let r = FIRST_ROW; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawLevel = text(row.getCell(COL.level).value), title = text(row.getCell(COL.title).value), unit = text(row.getCell(COL.unit).value);
    const quantity = num(row.getCell(COL.quantity).value), unitCost = num(row.getCell(COL.unitCost).value), total = num(row.getCell(COL.total).value), own = num(row.getCell(COL.own).value);
    if (!rawLevel && !title && !unit && !quantity && !unitCost && !total && !own) continue;
    const level = levelOf(rawLevel);
    if (!level) { issues.push({ row: r, code: "level" }); continue; }
    if (!title) issues.push({ row: r, code: "title" });
    const parent = PARENT[level];
    if (parent && !seen.has(parent)) issues.push({ row: r, code: "chain" });
    // Each row opens a new branch: what was below the row it replaces can no longer be a parent.
    const order: TemplateLevel[] = ["goal", "outcome", "output", "activity", "sub_activity"];
    for (const below of order.slice(order.indexOf(level) + 1)) seen.delete(below);
    seen.add(level);
    if (level !== "activity" && level !== "sub_activity") {
      if (quantity || unitCost || own || total) issues.push({ row: r, code: "money" });
      rows.push({ level, title, unit: "", quantity: 0, unitCost: 0, budget: 0, own: 0, row: r });
      continue;
    }
    if ([quantity, unitCost, total, own].some(Number.isNaN) || quantity < 0 || unitCost < 0 || own < 0) { issues.push({ row: r, code: "amount" }); continue; }
    const byUnits = quantity > 0 && unitCost > 0;
    const budget = byUnits ? round2(quantity * unitCost) : round2(total);
    if (budget > 0 && own > budget) issues.push({ row: r, code: "own" });
    rows.push({ level, title, unit: unit || (budget > 0 && !byUnits ? "Lump sum" : ""), quantity: budget > 0 ? (byUnits ? quantity : 1) : 0, unitCost: budget > 0 ? (byUnits ? unitCost : budget) : 0, budget, own, row: r });
  }
  // Cost sits on an activity or on the inputs under it, never both; and every last level must have a cost.
  rows.forEach((x, i) => {
    if (x.level === "sub_activity" && !(x.budget > 0)) issues.push({ row: x.row, code: "amount" });
    if (x.level !== "activity") return;
    const hasInputs = rows[i + 1]?.level === "sub_activity";
    if (hasInputs && x.budget > 0) issues.push({ row: x.row, code: "both" });
    if (!hasInputs && !(x.budget > 0)) issues.push({ row: x.row, code: "amount" });
  });
  issues.sort((a, b) => a.row - b.row);
  return { rows, issues };
}

const blank = (): LogInput => ({
  title: "", indicator: "", target: "", verification: "", assumptions: "", accountId: null, budget: 0, category: "", unit: "", quantity: 0, unitCost: 0, ownContribution: 0, plan: {},
  responsible: "", startDate: null, endDate: null, baselineQty: 0, baselineSpent: 0,
});

/** Builds the result chain under a project: each row hangs from the last row of the level above it. */
export async function saveTemplateRows(tx: Tx, companyId: string, userId: string, projectId: string, rows: TemplateRow[]) {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)` }).from(schema.logframeItems).where(and(eq(schema.logframeItems.companyId, companyId), eq(schema.logframeItems.projectId, projectId)));
  if (Number(n)) throw new UserError("err_template_not_empty");
  const open = new Map<LogframeLevel, string>();
  let sort = 0;
  for (const r of rows) {
    const parent = PARENT[r.level];
    const id = await addLogItem(tx, companyId, userId, projectId, parent ? open.get(parent)! : null, {
      ...blank(), title: r.title, unit: r.unit, quantity: r.quantity, unitCost: r.unitCost, budget: r.budget, ownContribution: r.own,
    });
    await tx.update(schema.logframeItems).set({ sortOrder: ++sort }).where(eq(schema.logframeItems.id, id));
    open.set(r.level, id);
  }
  await audit(tx, companyId, userId, "import", "budget_template", projectId, { rows: rows.length, total: round2(rows.reduce((s, r) => s + r.budget, 0)) });
}
