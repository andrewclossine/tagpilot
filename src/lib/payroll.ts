import type { PayrollSettings, PayslipRow } from "@/db/schema";
import { round2 } from "./format";

type Bracket = { upTo: number; rate: number };

/** "60000:0, 100000:10, *:30" -> monthly bands, each taxed at its own rate. */
export function parseBrackets(s: string): Bracket[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const [a, r] = x.split(":");
    return { upTo: a.trim() === "*" ? Infinity : Number(a), rate: Number(r) / 100 };
  }).filter((b) => !Number.isNaN(b.upTo) && !Number.isNaN(b.rate)).sort((a, b) => a.upTo - b.upTo);
}

export function payeOf(base: number, brackets: Bracket[]): number {
  let tax = 0, prev = 0;
  for (const b of brackets) {
    if (base <= prev) break;
    tax += (Math.min(base, b.upTo) - prev) * b.rate;
    prev = b.upTo;
  }
  return Math.round(tax);
}

export type EmployeePay = { id: string; name: string; projectId: string | null; basic: number; transport: number; other: number };

export function payslip(emp: EmployeePay, adj: { bonus?: number; deduction?: number }, cfg: PayrollSettings): PayslipRow {
  const bonus = round2(adj.bonus ?? 0), deduction = round2(adj.deduction ?? 0);
  const gross = round2(emp.basic + emp.transport + emp.other + bonus);
  const payeBase = gross - (cfg.payeTransport ? 0 : emp.transport);
  const rssbBase = gross - (cfg.rssbTransport ? 0 : emp.transport);
  const pct = (base: number, r: number) => Math.round((base * r) / 100);
  const paye = payeOf(payeBase, parseBrackets(cfg.brackets));
  const penE = pct(rssbBase, cfg.pensionEmp), penR = pct(rssbBase, cfg.pensionEr);
  const matE = pct(rssbBase, cfg.matEmp), matR = pct(rssbBase, cfg.matEr), oh = pct(rssbBase, cfg.ohEr);
  const cbhi = pct(gross - paye - penE - matE, cfg.cbhi);
  return {
    employeeId: emp.id, name: emp.name, projectId: emp.projectId,
    basic: emp.basic, transport: emp.transport, other: emp.other, bonus, gross,
    paye, penE, penR, matE, matR, oh, cbhi, deduction,
    net: round2(gross - paye - penE - matE - cbhi - deduction),
    employer: penR + matR + oh,
  };
}
