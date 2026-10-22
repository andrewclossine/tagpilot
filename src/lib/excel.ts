import "server-only";
import ExcelJS from "exceljs";

export type StaffRow = { name: string; position: string; project: string; email: string; gross: number; deduction: number };

const HEAD = {
  name: /^(staff|employee|full ?name|names?|nom|noms|amazina|personnel)/i,
  position: /(position|poste|title|job|fonction|function)/i,
  project: /(project|projet|program|programme|donor)/i,
  gross: /(gross|brut|salary|salaire|amount|montant)/i,
  deduction: /(deduct|advance|avance|retenue|loan)/i,
  email: /(e-?mail|courriel)/i,
};

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v) return toNumber((v as { result: unknown }).result);
  const n = Number(String(v ?? "").replace(/[\s,  ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
const toText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  if (typeof v === "object" && "result" in v) return toText((v as { result: unknown }).result);
  return String(v).trim();
};

/** Reads the staff sheet: one row per person with name, position, project and gross pay (an advance column is optional). */
export async function readStaffSheet(file: File): Promise<StaffRow[]> {
  let table: unknown[][];
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    const text = await file.text();
    const delim = text.split("\n")[0].includes(";") ? ";" : text.split("\n")[0].includes("\t") ? "\t" : ",";
    table = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(delim).map((c) => c.replace(/^"|"$/g, "").trim()));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    table = [];
    ws.eachRow({ includeEmpty: false }, (row) => { table.push((row.values as unknown[]).slice(1)); });
  }
  // The header is the first row that names both a person column and a gross pay column.
  const hi = table.findIndex((r) => r.some((c) => HEAD.name.test(toText(c))) && r.some((c) => HEAD.gross.test(toText(c))));
  if (hi < 0) return [];
  const head = table[hi].map(toText);
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const ci = { name: col(HEAD.name), position: col(HEAD.position), project: col(HEAD.project), gross: col(HEAD.gross), deduction: col(HEAD.deduction), email: col(HEAD.email) };
  return table.slice(hi + 1).map((r) => ({
    name: toText(r[ci.name]), position: ci.position >= 0 ? toText(r[ci.position]) : "",
    project: ci.project >= 0 ? toText(r[ci.project]) : "", email: ci.email >= 0 ? toText(r[ci.email]).toLowerCase() : "", gross: Math.round(toNumber(r[ci.gross]) * 100) / 100,
    deduction: ci.deduction >= 0 ? Math.round(toNumber(r[ci.deduction]) * 100) / 100 : 0,
  })).filter((r) => r.name && r.gross > 0 && !/^total/i.test(r.name));
}

