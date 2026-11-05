import "server-only";
import ExcelJS from "exceljs";
import type { Tx } from "@/db";
import { schema } from "@/db";
import type { BudgetPlan, LogframeLevel, Milestone } from "@/db/schema";
import { isIsoDate, round2 } from "./format";
import { UserError } from "./ledger";
import { taskCodeOf } from "./programs";
import { audit } from "./audit";

type Cell = ExcelJS.CellValue;

/** The value Excel last calculated for a cell, or the cell's own value. */
function value(v: Cell): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return null;
  if ("result" in v) return value(v.result as Cell);
  if ("richText" in v) return v.richText.map((r) => r.text).join("");
  if ("text" in v) return String(v.text);
  return null;
}
const text = (v: Cell) => { const x = value(v); return x === null || x instanceof Date ? "" : String(x).replace(/\s+/g, " ").trim(); };
const num = (v: Cell): number | null => {
  const x = value(v);
  if (typeof x === "number") return x;
  if (typeof x === "string" && x.trim() !== "") { const n = Number(x.replace(/[\s,]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
};
const day = (v: Cell): string | null => {
  const x = value(v);
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  return typeof x === "string" && isIsoDate(x.trim()) ? x.trim() : null;
};

export type ImportedLine = { name: string; category: string; unit: string; quantity: number; unitCost: number; budget: number; own: number; plan: BudgetPlan };
export type ImportedActivity = { no: string; name: string; responsible: string; start: string | null; end: string | null; budget: number; own: number; plan: BudgetPlan; lines: ImportedLine[] };
export type ImportedOutput = { no: number; name: string; activities: ImportedActivity[] };
export type ImportedIndicator = { name: string; baseline: number | null; target: number | null; source: string; assumptions: string; milestones: Milestone[] };
export type ImportedResult = { name: string; indicators: ImportedIndicator[] };
export type ImportedProject = {
  title: string; organisation: string; impact: ImportedResult | null; outcomes: ImportedResult[]; outputs: ImportedOutput[];
  outputIndicators: Map<number, ImportedIndicator[]>; fileTotal: number | null; total: number; warnings: string[];
};

const QUARTERS: [string, string, string][] = [
  ["Y1Q1", "G", "H"], ["Y1Q2", "I", "J"], ["Y1Q3", "K", "L"], ["Y1Q4", "M", "N"],
  ["Y2Q1", "P", "Q"], ["Y2Q2", "R", "S"], ["Y2Q3", "T", "U"], ["Y2Q4", "V", "W"],
];

function planOf(row: ExcelJS.Row, unitCost: number): BudgetPlan {
  const plan: BudgetPlan = {};
  for (const [key, q, a] of QUARTERS) {
    const qty = num(row.getCell(q).value) ?? 0;
    const amount = num(row.getCell(a).value) ?? round2(qty * unitCost);
    if (qty || amount) plan[key] = { qty, amount: round2(amount) };
  }
  return plan;
}

const stripNumber = (s: string) => s.replace(/^\d+(\.\d+)*\.?\s*/, "").trim();

/** The Budget sheet: outputs, activities with their number, and the lines under them. */
function readBudget(ws: ExcelJS.Worksheet, warnings: string[]) {
  const outputs: ImportedOutput[] = [];
  let output: ImportedOutput | null = null, activity: ImportedActivity | null = null, fileTotal: number | null = null;
  let pendingName = false;
  ws.eachRow((row, n) => {
    if (n < 5) return;
    // "4.3. 1. Project launch" is line 4.3.1, written with a stray space.
    const a = text(row.getCell("A").value).replace(/^(\d+\.\d+)\.\s+(\d+\.)/, "$1.$2");
    if (!a) return;
    const total = num(row.getCell("F").value);
    const m = /^output\s*(\d+)\s*:?\s*(.*)$/i.exec(a);
    if (m && !/total/i.test(a)) {
      output = { no: Number(m[1]), name: m[2], activities: [] };
      outputs.push(output); activity = null; pendingName = !m[2];
      return;
    }
    if (pendingName && output) { output.name = a; pendingName = false; return; }
    if (/^grand\s*total/i.test(a)) { fileTotal = total; return; }
    // Only a row that starts as a total is one: "50% of total seedlings" is a budget line.
    if (/^(sub[-\s]*total|output\s*\d*\s*total|total)/i.test(a)) return;
    const head = /^(\d+\.\d+)\s*\.?\s+(.*)$/.exec(a);
    // "1.1 Installation" heads a group of lines; "2.5 Knowledge Management" with its own amount is a line by itself.
    const isLineRow = total !== null && (text(row.getCell("B").value) !== "" || num(row.getCell("D").value) !== null);
    if (head && !isLineRow && output) {
      activity = { no: head[1], name: head[2], responsible: "", start: null, end: null, budget: 0, own: 0, plan: {}, lines: [] };
      output.activities.push(activity);
      if (total !== null) activity.budget = total;
      return;
    }
    if (head && isLineRow && output && !/^\d+\.\d+\.\d+/.test(a)) {
      const unitCost = num(row.getCell("E").value) ?? 0;
      activity = { no: head[1], name: head[2], responsible: "", start: null, end: null, budget: total ?? 0, own: num(row.getCell("Y").value) ?? 0, plan: planOf(row, unitCost), lines: [] };
      output.activities.push(activity);
      activity = null;
      return;
    }
    if (total === null) return;
    if (!activity) { warnings.push(`Budget row ${n}: "${a.slice(0, 50)}" has an amount but no activity above it. It was left out.`); return; }
    const unitCost = num(row.getCell("E").value) ?? 0;
    const plan = planOf(row, unitCost);
    const planned = round2(Object.values(plan).reduce((s, q) => s + q.amount, 0));
    if (planned && Math.abs(planned - total) > 1) warnings.push(`Budget row ${n}, ${a.slice(0, 50)}: the quarters add up to ${planned}, but its total is ${round2(total)}. The total was used.`);
    activity.lines.push({
      name: stripNumber(a), category: text(row.getCell("B").value), unit: text(row.getCell("C").value),
      quantity: num(row.getCell("D").value) ?? 0, unitCost, budget: round2(total), own: round2(num(row.getCell("Y").value) ?? 0), plan,
    });
  });
  return { outputs, fileTotal: fileTotal as number | null };
}

/** The Workplan sheet: who does each activity, and when. */
function readWorkplan(ws: ExcelJS.Worksheet, outputs: ImportedOutput[]) {
  const activities = outputs.flatMap((o) => o.activities);
  ws.eachRow((row) => {
    const m = /^(\d+\.\d+)\b/.exec(text(row.getCell("A").value));
    if (!m) return;
    const a = activities.find((x) => x.no === m[1]);
    if (!a) return;
    a.responsible = text(row.getCell("B").value);
    a.start = day(row.getCell("C").value);
    a.end = day(row.getCell("D").value);
  });
}

/**
 * The Logframe sheet repeats each indicator in blocks: a header row naming the result and the periods, then Planned,
 * Achieved and Source rows.
 */
function readLogframe(ws: ExcelJS.Worksheet) {
  let impact: ImportedResult | null = null;
  const outcomes: ImportedResult[] = [];
  const outputIndicators = new Map<number, ImportedIndicator[]>();
  let level: "impact" | "outcome" | "output" | null = null, outputNo = 0;
  let labels: string[] = [];
  const LABEL_COLS = ["E", "F", "G", "H", "I", "J"];
  let current: ImportedResult | null = null;
  let indicator: ImportedIndicator | null = null;
  ws.eachRow((row) => {
    const a = text(row.getCell("A").value), b = text(row.getCell("B").value), c = text(row.getCell("C").value).toLowerCase();
    if (/baseline/i.test(text(row.getCell("D").value)) && /indicator/i.test(b)) {
      if (/^impact/i.test(a)) { level = "impact"; current = null; }
      else if (/^outcome/i.test(a)) { level = "outcome"; current = null; }
      else if (/^output/i.test(a)) { level = "output"; outputNo = Number(/\d+/.exec(a)?.[0] ?? 0); current = null; }
      labels = LABEL_COLS.map((col) => text(row.getCell(col).value).replace(/^milestone\s*/i, ""));
      return;
    }
    if (c === "planned" && level) {
      indicator = {
        name: b, baseline: num(row.getCell("D").value), target: num(row.getCell("K").value), source: "",
        assumptions: text(row.getCell("L").value),
        milestones: LABEL_COLS.flatMap((col, i) => { const planned = num(row.getCell(col).value); return planned === null ? [] : [{ label: labels[i], planned, achieved: null }]; }),
      };
      if (level === "impact") { impact ??= { name: a, indicators: [] }; impact.indicators.push(indicator); }
      else if (level === "outcome") {
        if (!current || current.name !== a) { current = { name: a, indicators: [] }; outcomes.push(current); }
        current.indicators.push(indicator);
      } else {
        outputIndicators.set(outputNo, [...(outputIndicators.get(outputNo) ?? []), indicator]);
      }
      return;
    }
    if (c === "source" && indicator) indicator.source = text(row.getCell("D").value);
  });
  return { impact: impact as ImportedResult | null, outcomes, outputIndicators };
}

/** Reads a project document in the Rwanda Green Fund (FONERWA) template. */
export async function readProjectDocument(buffer: Buffer): Promise<ImportedProject> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer); } catch { throw new UserError("err_import_file"); }
  const budget = wb.getWorksheet("Budget"), workplan = wb.getWorksheet("Workplan"), logframeSheet = wb.getWorksheet("Logframe"), details = wb.getWorksheet("Project details");
  if (!budget || !workplan || !logframeSheet) throw new UserError("err_import_sheets");
  const warnings: string[] = [];
  const { outputs, fileTotal } = readBudget(budget, warnings);
  if (!outputs.length) throw new UserError("err_import_sheets");
  readWorkplan(workplan, outputs);
  const { impact, outcomes, outputIndicators } = readLogframe(logframeSheet);
  const total = round2(outputs.reduce((s, o) => s + o.activities.reduce((t, a) => t + (a.lines.length ? a.lines.reduce((l, x) => l + x.budget, 0) : a.budget), 0), 0));
  if (fileTotal !== null && Math.abs(total - fileTotal) > 1) warnings.push(`The lines add up to ${total}, but the Budget sheet's grand total says ${round2(fileTotal)}.`);
  const stated = details ? num(details.getCell("B18").value) : null;
  if (stated !== null && Math.abs(total - stated) > 1) warnings.push(`The Project details sheet says the total budget is ${round2(stated)}, but the budget lines add up to ${total}.`);
  return {
    title: details ? text(details.getCell("B2").value) : "", organisation: details ? text(details.getCell("B4").value) : "",
    impact, outcomes, outputs, outputIndicators, fileTotal, total, warnings,
  };
}

/** Creates the project and its logical framework, budget and workplan from what was read. */
export async function saveImportedProject(tx: Tx, companyId: string, userId: string, p: ImportedProject, code: string, name: string, donor: string): Promise<string> {
  const dates = p.outputs.flatMap((o) => o.activities.flatMap((a) => [a.start, a.end])).filter((d): d is string => !!d).sort();
  const [project] = await tx.insert(schema.projects).values({
    companyId, code, name, donor, description: p.title, startDate: dates[0] ?? null, endDate: dates.at(-1) ?? null, importNotes: p.warnings,
  }).returning({ id: schema.projects.id });
  let order = 0;
  const insert = async (parentId: string | null, level: LogframeLevel, itemCode: string, title: string, extra: Partial<typeof schema.logframeItems.$inferInsert> = {}) => {
    const [row] = await tx.insert(schema.logframeItems).values({ companyId, projectId: project.id, parentId, level, code: itemCode, title, sortOrder: ++order, ...extra }).returning({ id: schema.logframeItems.id });
    return row.id;
  };
  const addIndicators = async (itemId: string, list: ImportedIndicator[]) => {
    if (list.length) await tx.insert(schema.indicators).values(list.map((x, i) => ({ companyId, itemId, sortOrder: i, name: x.name, baseline: x.baseline, target: x.target, source: x.source, assumptions: x.assumptions, milestones: x.milestones })));
  };
  const goal = await insert(null, "goal", "G1", p.impact?.name || p.title || name);
  await addIndicators(goal, p.impact?.indicators ?? []);
  for (const [i, o] of p.outcomes.entries()) await addIndicators(await insert(goal, "outcome", `O${i + 1}`, o.name), o.indicators);
  for (const o of p.outputs) {
    const output = await insert(goal, "output", String(o.no), o.name);
    await addIndicators(output, p.outputIndicators.get(o.no) ?? []);
    for (const a of o.activities) {
      const when = { responsible: a.responsible, startDate: a.start, endDate: a.end };
      if (!a.lines.length) {
        await insert(output, "activity", a.no, a.name, { ...when, budget: round2(a.budget), ownContribution: round2(a.own), plan: a.plan, taskCode: taskCodeOf(a.no), quantity: 1, unit: "Lump sum", unitCost: a.budget });
        continue;
      }
      const activity = await insert(output, "activity", a.no, a.name, when);
      for (const [i, l] of a.lines.entries()) {
        const lineCode = `${a.no}.${i + 1}`;
        await insert(activity, "sub_activity", lineCode, l.name, {
          ...when, taskCode: taskCodeOf(lineCode), category: l.category, unit: l.unit, quantity: l.quantity, unitCost: l.unitCost, budget: l.budget, ownContribution: l.own, plan: l.plan,
        });
      }
    }
  }
  await audit(tx, companyId, userId, "import", "project", code, { total: p.total, outputs: p.outputs.length });
  return project.id;
}
