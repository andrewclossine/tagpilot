import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { balances, listAccounts } from "./ledger";
import { addDays, round2 } from "./format";
import { buildFinancialReport, fixedAssetCodes, natural, placeOf, resultOf, yearBefore, type Row } from "./financial-reports";
import { dict, type Key } from "./i18n-dict";

type Account = typeof schema.accounts.$inferSelect;
type Lang = "en" | "fr";

/** Labels in the language of the statements, whatever language the reader uses. */
export const tOf = (lang: Lang) => (key: Key) => dict[lang][key] ?? dict.en[key] ?? key;

/**
 * The lines of the statements. Every account belongs to one by its type, role and code, so the trial balance needs no
 * mapping: what a lead schedule does in an audit package, the chart of accounts already says.
 */
export const SOFP_LINES = ["ppe", "investment_property", "biological", "other_non_current_assets", "inventories", "receivables", "other_current_assets", "cash",
  "loans", "deferred_income", "other_non_current_liabilities", "payables", "tax_payable", "other_current_liabilities"] as const;
export const PL_LINES = ["revenue", "grants", "cost_of_sales", "other_income", "employee_costs", "depreciation", "other_expenses", "finance_costs", "income_tax"] as const;
export type FsLine = (typeof SOFP_LINES)[number] | (typeof PL_LINES)[number] | "equity";

const NON_CURRENT_ASSETS: FsLine[] = ["ppe", "investment_property", "biological", "other_non_current_assets"];
const CURRENT_ASSETS: FsLine[] = ["inventories", "receivables", "other_current_assets", "cash"];
const NON_CURRENT_LIABILITIES: FsLine[] = ["loans", "deferred_income", "other_non_current_liabilities"];
const CURRENT_LIABILITIES: FsLine[] = ["payables", "tax_payable", "other_current_liabilities"];

const RETAINED = ["3200", "3900"];

function lineOf(a: Account, fixed: { all: Set<string>; depreciation: Set<string> }): FsLine {
  const place = placeOf(a, fixed.all), code = a.code;
  if (a.type === "asset") {
    if (place === "cash") return "cash";
    if (place === "receivable") return "receivables";
    if (place === "inventory") return "inventories";
    if (place === "other_current_asset") return a.subtype === "vat_in" || code.startsWith("15") || code.startsWith("14") ? "receivables" : "other_current_assets";
    if (code === "1660") return "investment_property";
    if (code === "1700") return "biological";
    return fixed.all.has(code) || code.startsWith("16") ? "ppe" : "other_non_current_assets";
  }
  if (a.type === "liability") {
    if (code === "2340") return "tax_payable";
    if (place === "non_current_liability") return code.startsWith("25") ? "loans" : code.startsWith("26") ? "deferred_income" : "other_non_current_liabilities";
    return place === "payable" || /^2[1-4]/.test(code) ? "payables" : "other_current_liabilities";
  }
  if (a.type === "equity") return "equity";
  if (a.type === "income") return code.startsWith("43") ? "grants" : /^4[12]/.test(code) ? "revenue" : "other_income";
  if (code === "6950") return "income_tax";
  if (code.startsWith("5")) return "cost_of_sales";
  if (code === "6100" || code === "6101") return "employee_costs";
  if (fixed.depreciation.has(code)) return "depreciation";
  if (/interest|intérêt/i.test(`${a.nameEn} ${a.nameFr}`)) return "finance_costs";
  return "other_expenses";
}

export type Pair = [number, number | null];
export type AccountRow = { id: string; code: string; name: string; v: Pair };
export type LineFigures = { line: FsLine; accounts: AccountRow[]; v: Pair };

/** Everything the statements and the notes print, for a period and the same period a year before. */
export async function fsFigures(companyId: string, from: string, to: string, comparative: boolean, lang: Lang) {
  const t = tOf(lang);
  const db = await getDb();
  const accounts = await listAccounts(db, companyId);
  const fixed = await fixedAssetCodes(db, companyId);
  const name = (a: Account) => (lang === "fr" && a.nameFr ? a.nameFr : a.nameEn);
  const pFrom = yearBefore(from), pTo = yearBefore(to);
  const [close, closePrev, move, movePrev, openCur, openPrev] = await Promise.all([
    balances(db, companyId, { to }),
    comparative ? balances(db, companyId, { to: pTo }) : Promise.resolve(null),
    balances(db, companyId, { from, to }),
    comparative ? balances(db, companyId, { from: pFrom, to: pTo }) : Promise.resolve(null),
    balances(db, companyId, { to: addDays(from, -1) }),
    comparative ? balances(db, companyId, { to: addDays(pFrom, -1) }) : Promise.resolve(null),
  ]);
  const nat = (m: Map<string, { net: number }> | null, a: Account) => (m ? natural(a, m.get(a.id)?.net ?? 0) : null);
  const lines = new Map(accounts.map((a) => [a.id, lineOf(a, fixed)]));
  const group = (line: FsLine, cur: typeof close, prev: typeof close | null): LineFigures => {
    const rows = accounts.filter((a) => lines.get(a.id) === line)
      .map((a) => ({ id: a.id, code: a.code, name: name(a), v: [nat(cur, a) ?? 0, nat(prev, a)] as Pair }))
      .filter((r) => r.v[0] || r.v[1]);
    return { line, accounts: rows, v: [round2(rows.reduce((s, r) => s + r.v[0], 0)), prev ? round2(rows.reduce((s, r) => s + (r.v[1] ?? 0), 0)) : null] };
  };
  const sum = (list: LineFigures[]): Pair => [round2(list.reduce((s, l) => s + l.v[0], 0)), comparative ? round2(list.reduce((s, l) => s + (l.v[1] ?? 0), 0)) : null];
  const minus = (a: Pair, b: Pair): Pair => [round2(a[0] - b[0]), a[1] === null || b[1] === null ? null : round2(a[1] - b[1])];
  const plus = (...ps: Pair[]): Pair => [round2(ps.reduce((s, p) => s + p[0], 0)), ps.some((p) => p[1] === null) ? null : round2(ps.reduce((s, p) => s + (p[1] ?? 0), 0))];

  // ---- statement of financial position
  const sofp = Object.fromEntries(SOFP_LINES.map((l) => [l, group(l, close, closePrev)])) as Record<(typeof SOFP_LINES)[number], LineFigures>;
  // Equity: each capital or fund account as it is named in the chart, then retained earnings with every result to date.
  const resultTo = (m: typeof close | null) => (m ? resultOf(accounts, m) : null);
  const equityAccounts = accounts.filter((a) => a.type === "equity" && !RETAINED.includes(a.code));
  const equity: AccountRow[] = equityAccounts.map((a) => ({ id: a.id, code: a.code, name: name(a), v: [nat(close, a) ?? 0, nat(closePrev, a)] as Pair })).filter((r) => r.v[0] || r.v[1]);
  const retainedAccounts = accounts.filter((a) => RETAINED.includes(a.code));
  const retainedOf = (m: typeof close | null) => (m ? round2(retainedAccounts.reduce((s, a) => s + (nat(m, a) ?? 0), 0) + (resultTo(m) ?? 0)) : null);
  const retainedName = name(accounts.find((a) => a.code === "3200") ?? ({ nameEn: t("fs_retained"), nameFr: t("fs_retained") } as Account));
  const retained: AccountRow = { id: "retained", code: "3200", name: retainedName, v: [retainedOf(close) ?? 0, retainedOf(closePrev)] };
  const equityTotal: Pair = [round2(equity.reduce((s, r) => s + r.v[0], 0) + retained.v[0]), comparative ? round2(equity.reduce((s, r) => s + (r.v[1] ?? 0), 0) + (retained.v[1] ?? 0)) : null];
  const nonCurrentAssets = sum(NON_CURRENT_ASSETS.map((l) => sofp[l as keyof typeof sofp]));
  const currentAssets = sum(CURRENT_ASSETS.map((l) => sofp[l as keyof typeof sofp]));
  const nonCurrentLiabilities = sum(NON_CURRENT_LIABILITIES.map((l) => sofp[l as keyof typeof sofp]));
  const currentLiabilities = sum(CURRENT_LIABILITIES.map((l) => sofp[l as keyof typeof sofp]));
  const totalAssets = plus(nonCurrentAssets, currentAssets);
  const totalLiabilities = plus(nonCurrentLiabilities, currentLiabilities);
  const totalEquityLiabilities = plus(equityTotal, totalLiabilities);

  // ---- profit or loss
  const pl = Object.fromEntries(PL_LINES.map((l) => [l, group(l, move, movePrev)])) as Record<(typeof PL_LINES)[number], LineFigures>;
  const income = sum([pl.revenue, pl.grants]);
  const gross = minus(income, pl.cost_of_sales.v);
  const operating = minus(plus(gross, pl.other_income.v), plus(pl.employee_costs.v, pl.depreciation.v, pl.other_expenses.v));
  const beforeTax = minus(operating, pl.finance_costs.v);
  const profit = minus(beforeTax, pl.income_tax.v);

  // ---- changes in equity: one column per capital or fund account, then retained earnings
  const equityCols = [...equityAccounts.filter((a) => [openCur, close, openPrev, closePrev].some((m) => m && nat(m, a))), null];
  const colValue = (m: typeof close | null, a: Account | null) => (m ? (a ? nat(m, a) ?? 0 : retainedOf(m) ?? 0) : 0);
  const periodRows = (open: typeof close, end: typeof close, mv: typeof close, label: string) => {
    const opening = equityCols.map((a) => colValue(open, a));
    const closing = equityCols.map((a) => colValue(end, a));
    const result = equityCols.map((a) => (a ? 0 : resultOf(accounts, mv)));
    const other = equityCols.map((_, i) => round2(closing[i] - opening[i] - result[i]));
    return { label, opening, result, other, closing };
  };
  const soce = {
    columns: equityCols.map((a) => (a ? name(a) : retainedName)),
    periods: [
      ...(comparative && openPrev && closePrev && movePrev ? [periodRows(openPrev, closePrev, movePrev, pTo)] : []),
      periodRows(openCur, close, move, to),
    ],
  };

  // ---- cash flows: the ledger's own statement, the prior year beside it
  const tt = t as Parameters<typeof buildFinancialReport>[4];
  const nameFn = (a: { nameEn: string; nameFr: string }) => (lang === "fr" && a.nameFr ? a.nameFr : a.nameEn);
  const cfCur = await buildFinancialReport("cf", companyId, from, to, tt, nameFn);
  const cfPrev = comparative ? await buildFinancialReport("cf", companyId, pFrom, pTo, tt, nameFn) : null;
  const cf = mergeByLabel(cfCur.rows, cfPrev?.rows ?? null);

  // ---- detailed income statement: every income and expense account
  const detailed = ([...PL_LINES] as FsLine[]).map((l) => pl[l as keyof typeof pl]).filter((g) => g.accounts.length);

  // ---- property, plant and equipment by class, for its note
  const cats = await db.select().from(schema.assetCategories).where(eq(schema.assetCategories.companyId, companyId));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const ppe = cats.map((c) => {
    const cost = byCode.get(c.assetAccount), acc = byCode.get(c.accumDepAccount);
    const v = (m: typeof close | null, a?: Account) => (m && a ? nat(m, a) ?? 0 : 0);
    const costV: Pair = [v(close, cost), comparative ? v(closePrev, cost) : null];
    const accV: Pair = [v(close, acc), comparative ? v(closePrev, acc) : null];
    return { name: c.name, months: c.usefulLifeMonths, method: c.method, rate: c.rate, cost: costV, accumulated: accV, carrying: plus(costV, accV) };
  }).filter((r) => r.cost[0] || r.cost[1] || r.accumulated[0] || r.accumulated[1]);

  return {
    from, to, pFrom, pTo, comparative,
    sofp, equity, retained, equityTotal, nonCurrentAssets, currentAssets, nonCurrentLiabilities, currentLiabilities, totalAssets, totalLiabilities, totalEquityLiabilities,
    balanced: Math.abs(totalAssets[0] - totalEquityLiabilities[0]) < 0.5,
    pl, income, gross, operating, beforeTax, profit, soce, cf, detailed, ppe,
    lineOf: (l: FsLine) => (sofp as Record<string, LineFigures>)[l] ?? (pl as Record<string, LineFigures>)[l],
  };
}
export type FsFigures = Awaited<ReturnType<typeof fsFigures>>;

/** Puts last year's cash flow beside this year's, row by row, matching rows by their wording. */
function mergeByLabel(cur: Row[], prev: Row[] | null): { label: string; style: Row["style"]; v: Pair }[] {
  const key = (r: Row) => `${r.style}|${String(r.cells[0])}`;
  const prevMap = new Map((prev ?? []).map((r) => [key(r), r]));
  const out = cur.map((r) => ({ label: String(r.cells[0] ?? ""), style: r.style, v: [Number(r.cells[1] ?? 0), prev ? Number(prevMap.get(key(r))?.cells[1] ?? 0) : null] as Pair }));
  // Rows only last year had (a working capital account that did not move this year) go before the section total.
  for (const r of prev ?? []) {
    if (cur.some((c) => key(c) === key(r)) || r.style !== "line") continue;
    const at = out.findIndex((o) => o.style === "sub");
    out.splice(at < 0 ? out.length : at, 0, { label: String(r.cells[0] ?? ""), style: r.style, v: [0, Number(r.cells[1] ?? 0)] });
  }
  return out;
}

/** Which statement line a note explains, so the statements can print the note's number beside it. */
export const NOTE_FOR_LINE: Partial<Record<FsLine, string>> = {
  ppe: "n_ppe", investment_property: "n_investment_property", biological: "n_biological", inventories: "n_inventories", receivables: "n_receivables",
  cash: "n_cash", loans: "n_loans", deferred_income: "n_deferred_income", payables: "n_payables", tax_payable: "n_income_tax",
  revenue: "n_revenue", grants: "n_grants", other_income: "n_other_income", cost_of_sales: "n_cost_of_sales", employee_costs: "n_employee_costs",
  depreciation: "n_ppe", other_expenses: "n_other_expenses", finance_costs: "n_finance_costs", income_tax: "n_income_tax", equity: "n_equity",
};

/** The statements' own data, for the draft page and the PDF. */
export async function loadDraft(companyId: string, id: string) {
  const db = await getDb();
  const [d] = await db.select().from(schema.fsDrafts).where(eq(schema.fsDrafts.id, id));
  if (!d || d.companyId !== companyId) return null;
  const notes = await db.select().from(schema.fsNotes).where(eq(schema.fsNotes.draftId, id)).orderBy(schema.fsNotes.sortOrder);
  return { d, notes };
}

/**
 * Numbers for what is printed: the accounting policies are note 1 (1.1, 1.2...), then each included note in order.
 * Returns the number of every note by id, and by template key for the statements' references.
 */
export function numberNotes(notes: { id: string; kind: string; key: string; included: boolean }[]) {
  const byId = new Map<string, string>(), byKey = new Map<string, string>();
  let p = 0, n = 1;
  for (const x of notes.filter((y) => y.included)) {
    if (x.kind === "policy") byId.set(x.id, `1.${++p}`);
    else if (x.kind === "note") { byId.set(x.id, String(++n)); if (!byKey.has(x.key)) byKey.set(x.key, String(n)); }
  }
  return { byId, byKey };
}

/** What the words in braces in reports and notes stand for. */
export function fsTokens(
  d: { lang: Lang; periodFrom: string; periodTo: string; framework: string; approvedBy: string; approvedOn: string | null },
  c: { name: string; country: string; currency: string; address?: string; city?: string },
  f?: { beforeTax: Pair; profit: Pair },
) {
  const t = tOf(d.lang);
  const amount = (n: number | undefined) => {
    if (n === undefined) return "-";
    const s = Math.abs(Math.round(n)).toLocaleString(d.lang === "fr" ? "fr-FR" : "en-US");
    return n < 0 ? `(${s})` : s;
  };
  return {
    company: c.name, country: c.country || "-", currency: c.currency, period_start: d.periodFrom, period_end: d.periodTo,
    address: [c.address, c.city, c.country].filter(Boolean).join(", ") || "[address]",
    framework: t(d.framework === "ifrs" ? "fs_fw_ifrs_long" : "fs_fw_sme_long"),
    approved_by: d.approvedBy.trim() || t("fs_approved_by_blank"), approved_on: d.approvedOn ?? t("fs_approved_on_blank"),
    profit_before_tax: amount(f?.beforeTax[0]), profit_after_tax: amount(f?.profit[0]),
  } as Record<string, string>;
}
