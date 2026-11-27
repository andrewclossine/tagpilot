// Account types as QuickBooks lists them beside each account (Bank, Accounts receivable, Fixed asset, Cost of sales...),
// worked out from the five main types, the account's role in the books and its code. Shared by the server and the
// account picker in the browser.

export const ACCOUNT_KINDS = [
  "bank", "ar", "inventory", "other_current_asset", "fixed_asset",
  "ap", "credit_card", "other_current_liability", "long_term_liability",
  "equity", "income", "other_income", "cogs", "expense", "other_expense",
] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export const isAccountKind = (s: string): s is AccountKind => (ACCOUNT_KINDS as readonly string[]).includes(s);

type MainType = "asset" | "liability" | "equity" | "income" | "expense";
type Sub = "bank" | "cash" | "momo" | "ar" | "ap" | "vat_in" | "vat_out" | "wht" | null;

/** What a new account of each kind is in the books, and the codes it takes (the chart's numbering). */
export const KIND_SPEC: Record<AccountKind, { type: MainType; subtype: Sub; from: number; to: number }> = {
  bank: { type: "asset", subtype: "bank", from: 1100, to: 1199 },
  ar: { type: "asset", subtype: "ar", from: 1200, to: 1299 },
  inventory: { type: "asset", subtype: null, from: 1300, to: 1399 },
  other_current_asset: { type: "asset", subtype: null, from: 1400, to: 1599 },
  fixed_asset: { type: "asset", subtype: null, from: 1600, to: 1999 },
  ap: { type: "liability", subtype: "ap", from: 2100, to: 2149 },
  credit_card: { type: "liability", subtype: null, from: 2150, to: 2199 },
  other_current_liability: { type: "liability", subtype: null, from: 2200, to: 2499 },
  long_term_liability: { type: "liability", subtype: null, from: 2500, to: 2999 },
  equity: { type: "equity", subtype: null, from: 3000, to: 3999 },
  income: { type: "income", subtype: null, from: 4000, to: 4799 },
  other_income: { type: "income", subtype: null, from: 4800, to: 4999 },
  cogs: { type: "expense", subtype: null, from: 5000, to: 5999 },
  expense: { type: "expense", subtype: null, from: 6000, to: 7999 },
  other_expense: { type: "expense", subtype: null, from: 8000, to: 9999 },
};

/** The kind of an existing account, read from its type, role and code. */
export function kindOf(a: { type: string; subtype?: string | null; code: string; kind?: string | null }): AccountKind {
  // The type someone chose stands, as long as it fits the account's main type.
  if (a.kind && isAccountKind(a.kind) && KIND_SPEC[a.kind].type === a.type) return a.kind;
  const n = Number(a.code.replace(/\D/g, "").slice(0, 4));
  const inRange = (k: AccountKind) => n >= KIND_SPEC[k].from && n <= KIND_SPEC[k].to;
  switch (a.type) {
    case "asset":
      if (a.subtype === "bank" || a.subtype === "cash" || a.subtype === "momo") return "bank";
      if (a.subtype === "ar") return "ar";
      if (inRange("inventory")) return "inventory";
      if (inRange("fixed_asset")) return "fixed_asset";
      return inRange("ar") ? "ar" : "other_current_asset";
    case "liability":
      if (a.subtype === "ap") return "ap";
      if (inRange("long_term_liability")) return "long_term_liability";
      if (inRange("credit_card")) return "credit_card";
      return inRange("ap") ? "ap" : "other_current_liability";
    case "equity": return "equity";
    case "income": return inRange("other_income") ? "other_income" : "income";
    default:
      if (inRange("cogs")) return "cogs";
      return inRange("other_expense") ? "other_expense" : "expense";
  }
}

/** The kinds a picker may create, when it only holds some types (a bank list offers Bank only). */
export const kindsForTypes = (types: readonly string[]) => ACCOUNT_KINDS.filter((k) => types.includes(KIND_SPEC[k].type));

/** The next free code of a kind: ten after the highest used in its range, or its first code. */
export function nextCode(kind: AccountKind, used: string[]): string {
  const { from, to } = KIND_SPEC[kind];
  const taken = new Set(used);
  const nums = used.map((c) => Number(c)).filter((n) => Number.isInteger(n) && n >= from && n <= to);
  const start = nums.length ? Math.floor((Math.max(...nums) + 10) / 10) * 10 : from;
  for (let n = start; n <= to; n++) if (!taken.has(String(n))) return String(n);
  for (let n = from; n <= to; n++) if (!taken.has(String(n))) return String(n);
  return String(to + 1);
}
