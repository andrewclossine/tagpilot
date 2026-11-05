import "server-only";
import ExcelJS from "exceljs";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { balances, listAccounts } from "./ledger";
import { addDays, lastDayOfMonth, round2 } from "./format";
import type { Key, T } from "./i18n";

type Db = Awaited<ReturnType<typeof getDb>>;
type Account = typeof schema.accounts.$inferSelect;
type Balances = Awaited<ReturnType<typeof balances>>;
type Line = Awaited<ReturnType<typeof ledgerLines>>[number];

export type Cell = string | number | null;
export type Column = { label: string; type: "text" | "money" | "pct" };
export type Row = {
  style: "head" | "group" | "line" | "sub" | "total";
  cells: Cell[];
  links?: Record<number, string>; // column index -> where that cell leads
  indent?: boolean;
};
export type Report = { columns: Column[]; rows: Row[]; period: string; note?: string };

/** The Company & Financial reports, in the order they are listed. */
export const FINANCIAL_KINDS = ["pl", "pl-detail", "pl-compare", "proj", "pl-unclassified", "pl-customer", "pl-customer-detail", "bs", "bs-detail", "bs-summary", "bs-compare", "cf"] as const;
export type FinancialKind = (typeof FINANCIAL_KINDS)[number];
export const isFinancialKind = (k: string): k is FinancialKind => (FINANCIAL_KINDS as readonly string[]).includes(k);

/** Reports that show one date rather than a period. */
export const AS_AT_KINDS: readonly string[] = ["bs", "bs-summary", "bs-compare"];

export const FINANCIAL_TITLES: Record<FinancialKind, Key> = {
  pl: "r_pl", "pl-detail": "r_pl_detail", "pl-compare": "r_pl_compare", proj: "r_proj", "pl-unclassified": "r_pl_unclassified",
  "pl-customer": "r_pl_customer", "pl-customer-detail": "r_pl_customer_detail",
  bs: "r_bs", "bs-detail": "r_bs_detail", "bs-summary": "r_bs_summary", "bs-compare": "r_bs_compare", cf: "r_cf",
};

/** The same date one year earlier. The last day of a month stays the last day, so 28 Feb 2025 compares with 29 Feb 2024. */
export function yearBefore(date: string): string {
  const year = String(Number(date.slice(0, 4)) - 1);
  const month = date.slice(5, 7);
  const lastOfMonth = date === lastDayOfMonth(date.slice(0, 7));
  return lastOfMonth ? lastDayOfMonth(`${year}-${month}`) : `${year}${date.slice(4)}`;
}

/** Every posted line of a period. A line without its own project or partner takes the one on its entry. */
export async function ledgerLines(db: Db, companyId: string, from: string, to: string) {
  const jl = schema.journalLines, je = schema.journalEntries, p = schema.partners;
  return db.select({
    accountId: jl.accountId, debit: jl.debit, credit: jl.credit,
    entryId: je.id, number: je.number, date: je.date, memo: je.memo, source: je.source, isAdjusting: je.isAdjusting,
    projectId: sql<string | null>`coalesce(${jl.projectId}, ${je.projectId})`,
    partnerId: p.id, partner: p.name, partnerKind: p.kind,
  }).from(jl).innerJoin(je, eq(je.id, jl.entryId))
    .leftJoin(p, sql`${p.id} = coalesce(${jl.partnerId}, ${je.partnerId})`)
    .where(and(eq(jl.companyId, companyId), eq(je.status, "posted"), gte(je.date, from), lte(je.date, to)))
    .orderBy(je.date, je.number, jl.lineNo);
}

/** Income, liabilities and equity read as credit minus debit; assets and expenses as debit minus credit. */
export const natural = (a: { type: string }, net: number) => round2(a.type === "asset" || a.type === "expense" ? net : -net);
const isCostOfSales = (a: Account) => a.type === "expense" && a.code.startsWith("5");
const anyValue = (v: number[]) => v.some((n) => n !== 0);
const addUp = (rows: number[][], n: number) => Array.from({ length: n }, (_, i) => round2(rows.reduce((s, r) => s + r[i], 0)));
const minus = (a: number[], b: number[]) => a.map((v, i) => round2(v - b[i]));

function netOf(lines: Line[]) {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.accountId, round2((m.get(l.accountId) ?? 0) + l.debit - l.credit));
  return m;
}

const resultOf = (accounts: Account[], m: Balances) =>
  round2(accounts.filter((a) => a.type === "income" || a.type === "expense").reduce((s, a) => s - (m.get(a.id)?.net ?? 0), 0));

/** Where an account sits on the balance sheet and in the cash flow. Accounts are placed by their role, then by their code. */
function placeOf(a: Account, fixedCodes: Set<string>) {
  if (a.type === "asset") {
    if (a.subtype === "cash" || a.subtype === "bank" || a.subtype === "momo") return "cash";
    if (fixedCodes.has(a.code) || /^1[6-9]/.test(a.code)) return "non_current_asset";
    if (a.subtype === "ar" || a.code.startsWith("12")) return "receivable";
    if (a.code.startsWith("13")) return "inventory";
    return "other_current_asset";
  }
  if (a.type === "liability") {
    if (/^2[5789]/.test(a.code)) return "non_current_liability";
    if (a.subtype === "ap" || a.code.startsWith("21")) return "payable";
    return "other_current_liability";
  }
  return a.type;
}

async function fixedAssetCodes(db: Db, companyId: string) {
  const cats = await db.select({ asset: schema.assetCategories.assetAccount, accum: schema.assetCategories.accumDepAccount, dep: schema.assetCategories.depExpenseAccount })
    .from(schema.assetCategories).where(eq(schema.assetCategories.companyId, companyId));
  return {
    cost: new Set(cats.map((c) => c.asset)),
    all: new Set(cats.flatMap((c) => [c.asset, c.accum])),
    depreciation: new Set(["6200", "6210", ...cats.map((c) => c.dep)]),
  };
}

export async function buildFinancialReport(
  kind: FinancialKind, companyId: string, from: string, to: string,
  t: T, accName: (a: { nameEn: string; nameFr: string }) => string,
): Promise<Report> {
  const db = await getDb();
  const accounts = await listAccounts(db, companyId);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const label = (a: Account) => `${a.code} ${accName(a)}`;
  const gl = (a: Account) => `/reports/gl?from=${from}&to=${to}&account=${a.id}`;
  const journal = (id: string) => `/journal/${id}`;
  const period = `${from} → ${to}`;
  const asAt = `${t("as_at")} ${to}`;
  const money = (l: string): Column => ({ label: l, type: "money" });
  const text = (l: string): Column => ({ label: l, type: "text" });
  const head = (title: string): Row => ({ style: "head", cells: [title] });
  const sum = (title: string, v: Cell[], style: Row["style"] = "sub"): Row => ({ style, cells: [title, ...v] });

  /** Income statement rows for any number of amount columns. */
  const plRows = (values: (a: Account) => number[], n: number): Row[] => {
    const section = (list: Account[]) => {
      const rows = list.map((a) => ({ a, v: values(a) })).filter((r) => anyValue(r.v));
      return { rows: rows.map((r): Row => ({ style: "line", indent: true, cells: [label(r.a), ...r.v], links: { 0: gl(r.a) } })), total: addUp(rows.map((r) => r.v), n), any: rows.length > 0 };
    };
    const inc = section(accounts.filter((a) => a.type === "income"));
    const cost = section(accounts.filter(isCostOfSales));
    const exp = section(accounts.filter((a) => a.type === "expense" && !isCostOfSales(a)));
    if (!inc.any && !cost.any && !exp.any) return [];
    const gross = minus(inc.total, cost.total);
    return [
      head(t("income")), ...inc.rows, sum(t("r_total_income"), inc.total),
      ...(cost.any ? [head(t("r_cost_of_sales")), ...cost.rows, sum(t("r_total_cost_of_sales"), cost.total), sum(t("r_gross_profit"), gross)] : []),
      head(t("expenses")), ...exp.rows, sum(t("r_total_expenses"), exp.total),
      sum(t("net_result"), minus(gross, exp.total), "total"),
    ];
  };

  /** Adds "change" and "% change" after the two amount columns of a comparison. */
  const withChange = (rows: Row[]): Row[] => rows.map((r) => {
    if (r.style === "head" || r.style === "group") return r;
    const cur = Number(r.cells[1]), prev = Number(r.cells[2]);
    return { ...r, cells: [...r.cells, round2(cur - prev), prev ? (cur - prev) / Math.abs(prev) : null] };
  });

  /** Balance sheet rows for one or more dates. */
  const bsRows = async (dates: string[]): Promise<Row[]> => {
    const fixed = await fixedAssetCodes(db, companyId);
    const maps = await Promise.all(dates.map((d) => balances(db, companyId, { to: d })));
    const earlier = await Promise.all(dates.map((d) => balances(db, companyId, { to: addDays(`${d.slice(0, 4)}-01-01`, -1) })));
    const n = dates.length;
    const values = (a: Account) => maps.map((m) => natural(a, m.get(a.id)?.net ?? 0));
    const section = (list: Account[]) => {
      const rows = list.map((a) => ({ a, v: values(a) })).filter((r) => anyValue(r.v));
      return { rows: rows.map((r): Row => ({ style: "line", indent: true, cells: [label(r.a), ...r.v], links: { 0: `/reports/gl?from=${from}&to=${dates[0]}&account=${r.a.id}` } })), total: addUp(rows.map((r) => r.v), n), any: rows.length > 0 };
    };
    const place = (...names: string[]) => accounts.filter((a) => names.includes(placeOf(a, fixed.all)));
    const curA = section(place("cash", "receivable", "inventory", "other_current_asset"));
    const nonA = section(place("non_current_asset"));
    const curL = section(place("payable", "other_current_liability"));
    const nonL = section(place("non_current_liability"));
    const eq_ = section(place("equity"));
    const prior = earlier.map((m) => resultOf(accounts, m));
    const year = maps.map((m, i) => round2(resultOf(accounts, m) - prior[i]));
    const assets = addUp([curA.total, nonA.total], n), liabilities = addUp([curL.total, nonL.total], n);
    const equity = addUp([eq_.total, prior, year], n), le = addUp([liabilities, equity], n);
    if (!curA.any && !nonA.any && !curL.any && !nonL.any && !eq_.any && !anyValue(prior) && !anyValue(year)) return [];
    const outOfBalance = anyValue(minus(assets, le));
    // A group with nothing in it is left out.
    const group = (title: string, s: { rows: Row[]; total: number[]; any: boolean }, totalLabel: string): Row[] =>
      s.any ? [{ style: "group", cells: [title] }, ...s.rows, sum(totalLabel, s.total)] : [];
    return [
      head(t("assets")),
      ...group(t("r_current_assets"), curA, t("r_total_current_assets")),
      ...group(t("r_non_current_assets"), nonA, t("r_total_non_current_assets")),
      sum(t("r_total_assets"), assets, "total"),
      head(t("liabilities")),
      ...group(t("r_current_liabilities"), curL, t("r_total_current_liabilities")),
      ...group(t("r_non_current_liabilities"), nonL, t("r_total_non_current_liabilities")),
      sum(t("r_total_liabilities"), liabilities),
      head(t("equity")), ...eq_.rows,
      ...(anyValue(prior) ? [{ style: "line" as const, indent: true, cells: [t("r_prior_result"), ...prior] }] : []),
      { style: "line", indent: true, cells: [t("r_year_result"), ...year] },
      sum(t("r_total_equity"), equity),
      sum(t("total_le"), le, "total"),
      ...(outOfBalance ? [sum(t("r_out_of_balance"), minus(assets, le))] : []),
    ];
  };

  switch (kind) {
    case "pl": {
      const m = await balances(db, companyId, { from, to });
      return { period, columns: [text(t("account")), money(t("amount"))], rows: plRows((a) => [natural(a, m.get(a.id)?.net ?? 0)], 1) };
    }

    case "pl-compare": {
      const prevFrom = yearBefore(from), prevTo = yearBefore(to);
      const [cur, prev] = await Promise.all([balances(db, companyId, { from, to }), balances(db, companyId, { from: prevFrom, to: prevTo })]);
      return {
        period,
        columns: [text(t("account")), money(period), money(`${prevFrom} → ${prevTo}`), money(t("r_change")), { label: t("r_change_pct"), type: "pct" }],
        rows: withChange(plRows((a) => [natural(a, cur.get(a.id)?.net ?? 0), natural(a, prev.get(a.id)?.net ?? 0)], 2)),
      };
    }

    case "pl-unclassified": {
      const m = netOf((await ledgerLines(db, companyId, from, to)).filter((l) => !l.projectId));
      return { period, note: t("r_unclassified_note"), columns: [text(t("account")), money(t("amount"))], rows: plRows((a) => [natural(a, m.get(a.id) ?? 0)], 1) };
    }

    case "proj": {
      const lines = await ledgerLines(db, companyId, from, to);
      const projects = await db.select().from(schema.projects).where(eq(schema.projects.companyId, companyId)).orderBy(schema.projects.code);
      const isResult = (id: string) => { const a = byId.get(id); return a?.type === "income" || a?.type === "expense"; };
      const used = projects.filter((p) => lines.some((l) => l.projectId === p.id && isResult(l.accountId)));
      const nets = new Map(used.map((p) => [p.id, netOf(lines.filter((l) => l.projectId === p.id))]));
      const none = netOf(lines.filter((l) => !l.projectId));
      return {
        period,
        columns: [text(t("account")), ...used.map((p) => money(`${p.code} ${p.name}`)), money(t("r_unclassified")), money(t("total"))],
        rows: plRows((a) => {
          const v = [...used.map((p) => natural(a, nets.get(p.id)?.get(a.id) ?? 0)), natural(a, none.get(a.id) ?? 0)];
          return [...v, round2(v.reduce((s, x) => s + x, 0))];
        }, used.length + 2),
      };
    }

    case "pl-detail": {
      const lines = await ledgerLines(db, companyId, from, to);
      const projects = await db.select({ id: schema.projects.id, code: schema.projects.code }).from(schema.projects).where(eq(schema.projects.companyId, companyId));
      const codeOf = new Map(projects.map((p) => [p.id, p.code]));
      const section = (list: Account[]) => {
        const rows: Row[] = []; let total = 0;
        for (const a of list) {
          const own = lines.filter((l) => l.accountId === a.id);
          if (!own.length) continue;
          rows.push({ style: "group", cells: [label(a)], links: { 0: gl(a) } });
          let run = 0;
          for (const l of own) {
            const amount = natural(a, l.debit - l.credit);
            run = round2(run + amount);
            rows.push({ style: "line", cells: [l.date, l.number, l.partner ?? "", l.memo, l.projectId ? codeOf.get(l.projectId) ?? "" : "", amount, run], links: { 1: journal(l.entryId) } });
          }
          rows.push(sum(`${t("total")} ${label(a)}`, [null, null, null, null, run, run]));
          total = round2(total + run);
        }
        return { rows, total };
      };
      const inc = section(accounts.filter((a) => a.type === "income"));
      const exp = section(accounts.filter((a) => a.type === "expense"));
      if (!inc.rows.length && !exp.rows.length) return { period, columns: [], rows: [] };
      return {
        period,
        columns: [text(t("date")), text(t("number")), text(t("r_name")), text(t("memo")), text(t("project")), money(t("amount")), money(t("balance"))],
        rows: [
          head(t("income")), ...inc.rows, sum(t("r_total_income"), [null, null, null, null, inc.total, null]),
          head(t("expenses")), ...exp.rows, sum(t("r_total_expenses"), [null, null, null, null, exp.total, null]),
          sum(t("net_result"), [null, null, null, null, round2(inc.total - exp.total), null], "total"),
        ],
      };
    }

    case "pl-customer":
    case "pl-customer-detail": {
      const lines = await ledgerLines(db, companyId, from, to);
      const noCustomer = t("r_no_customer");
      // Costs paid to a supplier are not a customer's cost, so they go with "no customer" and the totals still equal the income statement.
      const customer = (l: Line) => (l.partner && l.partnerKind !== "supplier" ? l.partner : noCustomer);
      const counted = lines.flatMap((l) => {
        const a = byId.get(l.accountId);
        if (!a) return [];
        if (a.type === "income") return [{ l, a, income: natural(a, l.debit - l.credit), cost: 0 }];
        if (isCostOfSales(a)) return [{ l, a, income: 0, cost: natural(a, l.debit - l.credit) }];
        return [];
      });
      const names = [...new Set(counted.map((c) => customer(c.l)))].sort((x, y) => (x === noCustomer ? 1 : y === noCustomer ? -1 : x.localeCompare(y)));
      const pct = (income: number, cost: number) => (income ? (income - cost) / Math.abs(income) : null);
      const tot = (list: typeof counted) => ({ income: round2(list.reduce((s, c) => s + c.income, 0)), cost: round2(list.reduce((s, c) => s + c.cost, 0)) });
      const all = tot(counted);
      if (kind === "pl-customer") {
        return {
          period,
          columns: [text(t("customer")), money(t("income")), money(t("r_cost_of_sales")), money(t("r_gross_profit")), { label: t("r_margin_pct"), type: "pct" }],
          rows: counted.length ? [
            ...names.map((name): Row => { const v = tot(counted.filter((c) => customer(c.l) === name)); return { style: "line", cells: [name, v.income, v.cost, round2(v.income - v.cost), pct(v.income, v.cost)] }; }),
            sum(t("total"), [all.income, all.cost, round2(all.income - all.cost), pct(all.income, all.cost)], "total"),
          ] : [],
        };
      }
      return {
        period,
        columns: [text(t("date")), text(t("number")), text(t("memo")), text(t("account")), money(t("income")), money(t("r_cost_of_sales"))],
        rows: counted.length ? [
          ...names.flatMap((name): Row[] => {
            const own = counted.filter((c) => customer(c.l) === name), v = tot(own);
            return [
              head(name),
              ...own.map((c): Row => ({ style: "line", cells: [c.l.date, c.l.number, c.l.memo, label(c.a), c.income || null, c.cost || null], links: { 1: journal(c.l.entryId) } })),
              sum(`${t("total")} ${name}`, [null, null, null, v.income, v.cost]),
            ];
          }),
          sum(t("total"), [null, null, null, all.income, all.cost], "total"),
          sum(t("r_gross_profit"), [null, null, null, round2(all.income - all.cost), null]),
        ] : [],
      };
    }

    case "bs":
      return { period: asAt, columns: [text(t("account")), money(t("amount"))], rows: await bsRows([to]) };

    case "bs-compare": {
      const prev = yearBefore(to);
      return {
        period: asAt,
        columns: [text(t("account")), money(to), money(prev), money(t("r_change")), { label: t("r_change_pct"), type: "pct" }],
        rows: withChange(await bsRows([to, prev])),
      };
    }

    case "bs-summary": {
      const fixed = await fixedAssetCodes(db, companyId);
      const m = await balances(db, companyId, { to });
      const of = (...names: string[]) => round2(accounts.filter((a) => names.includes(placeOf(a, fixed.all))).reduce((s, a) => s + natural(a, m.get(a.id)?.net ?? 0), 0));
      const line = (title: string, v: number): Row[] => (v ? [{ style: "line", indent: true, cells: [title, v] }] : []);
      const current = of("cash", "receivable", "inventory", "other_current_asset"), nonCurrent = of("non_current_asset");
      const liabilities = of("payable", "other_current_liability", "non_current_liability");
      const result = resultOf(accounts, m), capital = of("equity");
      if (!current && !nonCurrent && !liabilities && !result && !capital) return { period: asAt, columns: [], rows: [] };
      return {
        period: asAt,
        columns: [text(t("r_group")), money(t("amount"))],
        rows: [
          head(t("assets")),
          ...line(t("r_cash_bank"), of("cash")), ...line(t("r_receivables"), of("receivable")), ...line(t("r_inventory"), of("inventory")), ...line(t("r_other_current_assets"), of("other_current_asset")),
          sum(t("r_total_current_assets"), [current]),
          ...line(t("r_non_current_assets"), nonCurrent),
          sum(t("r_total_assets"), [round2(current + nonCurrent)], "total"),
          head(t("liabilities")),
          ...line(t("r_payables"), of("payable")), ...line(t("r_other_current_liabilities"), of("other_current_liability")), ...line(t("r_non_current_liabilities"), of("non_current_liability")),
          sum(t("r_total_liabilities"), [liabilities]),
          head(t("equity")),
          ...line(t("r_capital_reserves"), capital), ...line(t("r_accumulated_result"), result),
          sum(t("r_total_equity"), [round2(capital + result)]),
          sum(t("total_le"), [round2(liabilities + capital + result)], "total"),
        ],
      };
    }

    case "bs-detail": {
      const lines = await ledgerLines(db, companyId, from, to);
      const open = await balances(db, companyId, { to: addDays(from, -1) });
      const section = (type: Account["type"]) => {
        const rows: Row[] = []; let total = 0;
        for (const a of accounts.filter((x) => x.type === type)) {
          const own = lines.filter((l) => l.accountId === a.id);
          const opening = natural(a, open.get(a.id)?.net ?? 0);
          if (!own.length && !opening) continue;
          rows.push({ style: "group", cells: [label(a)], links: { 0: gl(a) } });
          rows.push({ style: "line", cells: [t("opening"), null, null, null, null, null, opening] });
          let run = opening, dr = 0, cr = 0;
          for (const l of own) {
            run = round2(run + natural(a, l.debit - l.credit)); dr = round2(dr + l.debit); cr = round2(cr + l.credit);
            rows.push({ style: "line", cells: [l.date, l.number, l.partner ?? "", l.memo, l.debit || null, l.credit || null, run], links: { 1: journal(l.entryId) } });
          }
          rows.push(sum(t("closing"), [null, null, null, dr, cr, run]));
          total = round2(total + run);
        }
        return { rows, total };
      };
      const a = section("asset"), l = section("liability"), e = section("equity");
      const closing = await balances(db, companyId, { to });
      const resultOpen = resultOf(accounts, open), resultClose = resultOf(accounts, closing);
      if (!a.rows.length && !l.rows.length && !e.rows.length && !resultClose) return { period, columns: [], rows: [] };
      return {
        period,
        columns: [text(t("date")), text(t("number")), text(t("r_name")), text(t("memo")), money(t("debit")), money(t("credit")), money(t("balance"))],
        rows: [
          head(t("assets")), ...a.rows, sum(t("r_total_assets"), [null, null, null, null, null, a.total], "total"),
          head(t("liabilities")), ...l.rows, sum(t("r_total_liabilities"), [null, null, null, null, null, l.total]),
          head(t("equity")), ...e.rows,
          { style: "group", cells: [t("r_accumulated_result")] },
          { style: "line", cells: [t("opening"), null, null, null, null, null, resultOpen] },
          sum(t("closing"), [null, null, null, null, null, resultClose]),
          sum(t("r_total_equity"), [null, null, null, null, null, round2(e.total + resultClose)]),
          sum(t("total_le"), [null, null, null, null, null, round2(l.total + e.total + resultClose)], "total"),
        ],
      };
    }

    case "cf": {
      const fixed = await fixedAssetCodes(db, companyId);
      const move = await balances(db, companyId, { from, to });
      const openMap = await balances(db, companyId, { to: addDays(from, -1) });
      const moved = (a: Account) => move.get(a.id)?.net ?? 0;
      const place = (a: Account) => placeOf(a, fixed.all);
      const isCash = (a: Account) => place(a) === "cash";
      const isCodeOf = (...codes: string[]) => (a: Account) => codes.includes(a.code);
      const total = (list: Account[], f: (a: Account) => number) => round2(list.reduce((s, a) => s + f(a), 0));

      const result = resultOf(accounts, move);
      const depreciation = total(accounts.filter((a) => a.type === "expense" && fixed.depreciation.has(a.code)), moved);
      // Gains are credits, so a gain is negative here: taking it out of the result lowers operating cash.
      const disposal = total(accounts.filter(isCodeOf("4800", "6800")), moved);
      const cashEffect = (a: Account) => round2(-moved(a));
      const working = accounts.filter((a) => ["receivable", "inventory", "other_current_asset", "payable", "other_current_liability"].includes(place(a)) && moved(a));
      const operating = round2(result + depreciation + disposal + total(working, cashEffect));

      const longAssets = accounts.filter((a) => place(a) === "non_current_asset");
      const revaluation = accounts.filter(isCodeOf("3300"));
      // Depreciation, disposal results and revaluations move these accounts without moving any cash.
      const investing = round2(total(longAssets, cashEffect) - depreciation - disposal + total(revaluation, cashEffect));

      // Cash taken in on the entries that take an asset's cost off the books; the rest of the movement is buying assets.
      const lines = await ledgerLines(db, companyId, from, to);
      const disposalEntries = new Set(lines.filter((l) => { const a = byId.get(l.accountId); return a && fixed.cost.has(a.code) && l.credit > 0; }).map((l) => l.entryId));
      const proceeds = round2(lines.filter((l) => { const a = byId.get(l.accountId); return a && isCash(a) && disposalEntries.has(l.entryId); }).reduce((s, l) => s + l.debit - l.credit, 0));
      const purchases = round2(investing - proceeds);

      const financingAccounts = accounts.filter((a) => (place(a) === "non_current_liability" || (a.type === "equity" && a.code !== "3300")) && moved(a));
      const financing = total(financingAccounts, cashEffect);
      const net = round2(operating + investing + financing);
      const opening = total(accounts.filter(isCash), (a) => openMap.get(a.id)?.net ?? 0);
      const closing = round2(opening + total(accounts.filter(isCash), moved));
      const ln = (title: string, v: number, href?: string): Row[] => (v ? [{ style: "line", indent: true, cells: [title, v], links: href ? { 0: href } : undefined }] : []);
      if (!move.size && !opening) return { period, columns: [], rows: [] };
      return {
        period, note: t("r_cf_note"),
        columns: [text(t("r_item")), money(t("amount"))],
        rows: [
          head(t("r_cf_operating")),
          { style: "line", indent: true, cells: [t("net_result"), result] },
          ...ln(t("r_cf_depreciation"), depreciation),
          ...ln(t("r_cf_disposal_result"), disposal),
          ...working.flatMap((a) => ln(label(a), cashEffect(a), gl(a))),
          sum(t("r_cf_operating_total"), [operating]),
          head(t("r_cf_investing")),
          ...ln(t("r_cf_purchases"), purchases),
          ...ln(t("r_cf_proceeds"), proceeds),
          sum(t("r_cf_investing_total"), [investing]),
          head(t("r_cf_financing")),
          ...financingAccounts.flatMap((a) => ln(label(a), cashEffect(a), gl(a))),
          sum(t("r_cf_financing_total"), [financing]),
          sum(t("r_cf_net"), [net], "total"),
          { style: "line", cells: [t("r_cf_opening"), opening] },
          sum(t("r_cf_closing"), [closing], "total"),
          ...(round2(opening + net - closing) ? [sum(t("r_out_of_balance"), [round2(opening + net - closing)])] : []),
        ],
      };
    }
  }
}

/** The report as an Excel file, with real numbers an accountant can add up. */
export async function reportWorkbook(report: Report, title: string, company: string, currency: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TAGPILOT";
  const ws = wb.addWorksheet(title.replace(/[\\/*?:[\]]/g, " ").slice(0, 31));
  ws.addRow([company]).font = { bold: true, size: 14 };
  ws.addRow([title]).font = { bold: true };
  ws.addRow([`${report.period} · ${currency}`]);
  ws.addRow([]);
  const headRow = ws.addRow(report.columns.map((c) => c.label));
  headRow.font = { bold: true };
  headRow.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0EAFF" } }; c.alignment = { wrapText: true, vertical: "middle" }; });
  for (const r of report.rows) {
    const row = ws.addRow(r.cells.map((c) => c ?? ""));
    if (r.style !== "line") row.font = { bold: true };
    if (r.style === "total") row.eachCell((c) => { c.border = { top: { style: "thin" } }; });
    if (r.indent) row.getCell(1).alignment = { indent: 1 };
  }
  report.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.type === "text" ? (report.columns.length <= 5 && i === 0 ? 46 : i === 3 ? 40 : 18) : 18;
    if (c.type === "money") col.numFmt = "#,##0.00";
    if (c.type === "pct") col.numFmt = "0.0%";
  });
  ws.views = [{ state: "frozen", ySplit: 5 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
