import type { Key } from "./i18n";

type TaxAccount = { code: string; type: string; taxLine?: string | null };

/** The lines of an income tax working paper. Each income or expense account belongs to one of them. */
export const INCOME_TAX_LINES = ["sales", "other_income", "exempt"] as const;
export const EXPENSE_TAX_LINES = ["cost_of_sales", "salaries", "rent", "transport", "professional", "office", "finance", "depreciation", "other_deductible", "non_deductible"] as const;
export type TaxLine = (typeof INCOME_TAX_LINES)[number] | (typeof EXPENSE_TAX_LINES)[number];

export const taxLineKey = (l: TaxLine) => `tl_${l}` as Key;

/** Where an account goes until someone chooses otherwise. */
export function defaultTaxLine(a: TaxAccount): TaxLine {
  const c = a.code;
  if (a.type === "income") return /^4[12]/.test(c) ? "sales" : "other_income";
  if (c.startsWith("5")) return "cost_of_sales";
  if (c === "6100" || c === "6101") return "salaries";
  if (c === "6110" || c === "6120") return "rent";
  if (c === "6105" || c === "6180") return "transport";
  if (c === "6160") return "professional";
  if (c === "6170") return "finance";
  if (c === "6200" || c === "6210") return "depreciation";
  if (c === "6130" || c === "6140" || c === "6150" || c === "6190") return "office";
  return "other_deductible";
}

export const taxLinesFor = (type: string): readonly TaxLine[] => (type === "income" ? INCOME_TAX_LINES : EXPENSE_TAX_LINES);

export function taxLineOf(a: TaxAccount): TaxLine {
  const chosen = a.taxLine as TaxLine | null | undefined;
  return chosen && taxLinesFor(a.type).includes(chosen) ? chosen : defaultTaxLine(a);
}
