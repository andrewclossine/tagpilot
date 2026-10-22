import type { LegacyPayrollSettings, LegacyPayslipRow, PayrollComponent, PayrollSettings, PayslipRow } from "@/db/schema";
import { round2 } from "./format";
import { PAYROLL_DEFAULTS, RWANDA_COMPONENTS } from "./template";

type Bracket = { upTo: number; rate: number };

/** "60000:0, 100000:10, *:30" -> monthly bands, each taxed at its own rate. */
export function parseBrackets(s: string): Bracket[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const [a, r] = x.split(":");
    return { upTo: a.trim() === "*" ? Infinity : Number(a), rate: Number(r) / 100 };
  }).filter((b) => !Number.isNaN(b.upTo) && !Number.isNaN(b.rate)).sort((a, b) => a.upTo - b.upTo);
}

export function progressiveTax(base: number, brackets: Bracket[]): number {
  let tax = 0, prev = 0;
  for (const b of brackets) {
    if (base <= prev) break;
    tax += (Math.min(base, b.upTo) - prev) * b.rate;
    prev = b.upTo;
  }
  return Math.round(tax);
}

/** Payroll rules saved before they became configurable are read as the Rwanda preset with the saved rates. */
export function payrollConfig(saved: PayrollSettings | LegacyPayrollSettings | undefined): PayrollSettings {
  if (!saved) return PAYROLL_DEFAULTS;
  if ("components" in saved) return { ...PAYROLL_DEFAULTS, ...saved };
  const rate = (code: string, r: number) => ({ ...RWANDA_COMPONENTS.find((c) => c.code === code)!, rate: r });
  return {
    country: "Rwanda", reviewed: true, accSalary: saved.accSalary, accNet: saved.accNet, accAdv: saved.accAdv,
    components: [
      { ...RWANDA_COMPONENTS[0], brackets: saved.brackets, liabilityAccount: saved.accPaye },
      { ...rate("PEN_E", saved.pensionEmp), liabilityAccount: saved.accRssb },
      { ...rate("MAT_E", saved.matEmp), liabilityAccount: saved.accRssb },
      { ...rate("CBHI", saved.cbhi), liabilityAccount: saved.accRssb },
      { ...rate("PEN_R", saved.pensionEr), liabilityAccount: saved.accRssb, expenseAccount: saved.accEmployer },
      { ...rate("MAT_R", saved.matEr), liabilityAccount: saved.accRssb, expenseAccount: saved.accEmployer },
      { ...rate("OH", saved.ohEr), liabilityAccount: saved.accRssb, expenseAccount: saved.accEmployer },
    ],
  };
}

export function readPayslip(r: PayslipRow | LegacyPayslipRow): PayslipRow {
  if ("deductions" in r) return r;
  return {
    employeeId: r.employeeId, name: r.name, position: "", projectId: r.projectId, gross: r.gross,
    deductions: { PAYE: r.paye, PEN_E: r.penE, MAT_E: r.matE, CBHI: r.cbhi },
    employer: { PEN_R: r.penR, MAT_R: r.matR, OH: r.oh },
    otherDeduction: r.deduction, net: r.net, employerTotal: r.employer,
  };
}

export type PayInput = { employeeId: string | null; name: string; position: string; projectId: string | null; email?: string; gross: number; otherDeduction?: number };

/** Applies the company's payroll rules, in order, to one person's gross pay for the month. */
export function payslip(p: PayInput, components: PayrollComponent[]): PayslipRow {
  const gross = round2(p.gross);
  const deductions: Record<string, number> = {}, employer: Record<string, number> = {};
  let remaining = gross;
  for (const c of components) {
    const base = c.base === "remaining" ? remaining : gross;
    const amount = c.method === "brackets" ? progressiveTax(base, parseBrackets(c.brackets)) : Math.round((base * c.rate) / 100);
    if (c.kind === "employee") { deductions[c.code] = amount; remaining = round2(remaining - amount); }
    else employer[c.code] = amount;
  }
  const otherDeduction = round2(p.otherDeduction ?? 0);
  const totalDed = Object.values(deductions).reduce((s, v) => s + v, 0);
  return {
    employeeId: p.employeeId, name: p.name, position: p.position, projectId: p.projectId, email: p.email ?? "", gross,
    deductions, employer, otherDeduction,
    net: round2(gross - totalDed - otherDeduction),
    employerTotal: Object.values(employer).reduce((s, v) => s + v, 0),
  };
}
