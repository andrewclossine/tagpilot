"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { getDb, schema, type Tx } from "@/db";
import { requireWrite, type Ctx } from "@/lib/auth";
import { fail, withParam } from "@/lib/actions";
import { lastDayOfMonth, parseAmount, round2, str } from "@/lib/format";
import { accountIdByCode, saveEntry, UserError, type LineInput } from "@/lib/ledger";
import { payrollConfig, payslip, type PayInput } from "@/lib/payroll";
import { RWANDA_COMPONENTS } from "@/lib/template";
import { readStaffSheet } from "@/lib/excel";
import { suggestPayrollRules } from "@/lib/ai";
import { getI18n } from "@/lib/i18n";
import { audit } from "@/lib/audit";
import type { PayrollComponent, PayrollSettings } from "@/db/schema";

const monthOk = (m: string) => /^\d{4}-\d{2}$/.test(m);

async function saveSettings(ctx: Ctx, payroll: PayrollSettings) {
  const db = await getDb();
  await db.update(schema.companies).set({ settings: { ...ctx.company.settings, payroll } }).where(eq(schema.companies.id, ctx.company.id));
  await audit(db, ctx.company.id, ctx.user.id, "update", "payroll_rules", ctx.company.id, { components: payroll.components.length, reviewed: payroll.reviewed });
}

export async function saveEmployee(fd: FormData) {
  const ctx = await requireWrite("payroll");
  const id = str(fd, "id");
  const values = {
    name: str(fd, "name"), rssbNo: str(fd, "rssbNo"), nationalId: str(fd, "nationalId"), position: str(fd, "position"),
    projectId: str(fd, "projectId") || null, basic: parseAmount(fd.get("basic")), transport: parseAmount(fd.get("transport")),
    other: parseAmount(fd.get("other")), isActive: str(fd, "isActive") !== "0",
  };
  try {
    if (!values.name) throw new UserError("err_required");
    const db = await getDb();
    if (id) await db.update(schema.employees).set(values).where(and(eq(schema.employees.id, id), eq(schema.employees.companyId, ctx.company.id)));
    else await db.insert(schema.employees).values({ ...values, companyId: ctx.company.id });
    await audit(db, ctx.company.id, ctx.user.id, id ? "update" : "create", "employee", id || values.name);
  } catch (e) { fail(e, "/payroll?tab=employees"); }
  revalidatePath("/payroll");
  redirect("/payroll?tab=employees");
}

const Components = z.array(z.object({
  code: z.string().min(1), name: z.string().min(1), kind: z.enum(["employee", "employer"]), method: z.enum(["percent", "brackets"]),
  rate: z.number(), brackets: z.string(), base: z.enum(["gross", "remaining"]), liabilityAccount: z.string().min(1), expenseAccount: z.string(),
}));

export async function savePayrollRules(fd: FormData) {
  const ctx = await requireWrite("payroll");
  try {
    let components: PayrollComponent[];
    try { components = Components.parse(JSON.parse(String(fd.get("components") ?? "[]"))); } catch { throw new UserError("err_payroll_rules"); }
    if (components.some((c) => c.kind === "employer" && !c.expenseAccount)) throw new UserError("err_payroll_rules");
    await saveSettings(ctx, {
      country: str(fd, "country"), components, reviewed: str(fd, "reviewed") === "1",
      accSalary: str(fd, "accSalary"), accNet: str(fd, "accNet"), accAdv: str(fd, "accAdv"),
    });
  } catch (e) { fail(e, "/payroll?tab=rules"); }
  revalidatePath("/payroll");
  redirect("/payroll?tab=rules&saved=1");
}

/** Asks the AI for the country's payroll taxes, adds any accounts it needs, and saves them as unreviewed rules. */
export async function suggestRules(fd: FormData) {
  const ctx = await requireWrite("payroll");
  const { lang } = await getI18n();
  const country = str(fd, "country") || ctx.company.country;
  let notes: string[] = [];
  try {
    if (!country) throw new UserError("err_country");
    const db = await getDb();
    const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id));
    const p = await suggestPayrollRules(country, ctx.company.currency, accounts.map((a) => ({ code: a.code, name: a.nameEn, type: a.type })), lang === "fr" ? "French" : "English");
    const existing = new Set(accounts.map((a) => a.code));
    const fresh = p.new_accounts.filter((a) => !existing.has(a.code) && /^[A-Za-z0-9._-]+$/.test(a.code));
    if (fresh.length) await db.insert(schema.accounts).values(fresh.map((a) => ({ companyId: ctx.company.id, code: a.code, nameEn: a.name, nameFr: "", type: a.type }))).onConflictDoNothing();
    const known = new Set([...existing, ...fresh.map((a) => a.code)]);
    const cfg = payrollConfig(ctx.company.settings.payroll);
    await saveSettings(ctx, {
      ...cfg, country, reviewed: false,
      components: p.components.filter((c) => known.has(c.liability_account)).map((c) => ({
        code: c.code.toUpperCase().replace(/[^A-Z0-9_]/g, "_"), name: c.name, kind: c.kind, method: c.method, rate: c.rate, brackets: c.brackets, base: c.base,
        liabilityAccount: c.liability_account, expenseAccount: c.kind === "employer" && known.has(c.expense_account) ? c.expense_account : c.kind === "employer" ? cfg.accSalary : "",
      })),
    });
    notes = p.notes;
  } catch (e) { fail(e, "/payroll?tab=rules"); }
  revalidatePath("/payroll");
  redirect(withParam("/payroll?tab=rules", "notes", notes.join("\n")));
}

export async function loadRwandaPreset() {
  const ctx = await requireWrite("payroll");
  const cfg = payrollConfig(ctx.company.settings.payroll);
  await saveSettings(ctx, { ...cfg, country: "Rwanda", components: RWANDA_COMPONENTS, reviewed: false });
  revalidatePath("/payroll");
  redirect("/payroll?tab=rules");
}

/** Calculates every payslip with the company's rules and books one draft payroll entry, split by project. */
async function createRun(tx: Tx, ctx: Ctx, month: string, inputs: PayInput[], source: string, labels: { gross: string; employer: string; net: string; deduction: string; memo: string; staff: string }) {
  const cfg = payrollConfig(ctx.company.settings.payroll);
  if (!cfg.components.length) throw new UserError("err_payroll_rules");
  if (!cfg.reviewed) throw new UserError("err_payroll_unreviewed");
  const [exists] = await tx.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.companyId, ctx.company.id), eq(schema.payrollRuns.month, month)));
  if (exists) throw new UserError("err_payroll_exists");
  if (!inputs.length) throw new UserError("err_no_lines");
  const rows = inputs.map((p) => payslip(p, cfg.components));
  const acc = (code: string) => accountIdByCode(tx, ctx.company.id, code);

  const lines: LineInput[] = [];
  const add = async (code: string, side: "debit" | "credit", amount: number, description: string, projectId: string | null) => {
    if (!amount) return;
    const accountId = await acc(code);
    const hit = lines.find((l) => l.accountId === accountId && (l.projectId ?? null) === projectId && (side === "debit" ? l.debit : l.credit));
    if (hit) { if (side === "debit") hit.debit = round2(hit.debit + amount); else hit.credit = round2(hit.credit + amount); return; }
    lines.push({ accountId, debit: side === "debit" ? amount : 0, credit: side === "credit" ? amount : 0, description, projectId });
  };
  for (const r of rows) {
    await add(cfg.accSalary, "debit", r.gross, labels.gross, r.projectId);
    for (const c of cfg.components) if (c.kind === "employer") await add(c.expenseAccount, "debit", r.employer[c.code] ?? 0, c.name, r.projectId);
  }
  for (const c of cfg.components) {
    const total = round2(rows.reduce((s, r) => s + ((c.kind === "employee" ? r.deductions : r.employer)[c.code] ?? 0), 0));
    await add(c.liabilityAccount, "credit", total, c.name, null);
  }
  await add(cfg.accAdv, "credit", round2(rows.reduce((s, r) => s + r.otherDeduction, 0)), labels.deduction, null);
  await add(cfg.accNet, "credit", round2(rows.reduce((s, r) => s + r.net, 0)), labels.net, null);

  const [run] = await tx.insert(schema.payrollRuns).values({ companyId: ctx.company.id, month, rows, settings: cfg, source }).returning({ id: schema.payrollRuns.id });
  const projects = new Set(rows.map((r) => r.projectId));
  const entryId = await saveEntry(tx, ctx.company.id, ctx.user.id, {
    date: lastDayOfMonth(month), reference: `PAY-${month}`, memo: `${labels.memo} ${month} - ${rows.length} ${labels.staff}`,
    source: "payroll", sourceId: run.id, projectId: projects.size === 1 ? [...projects][0] : null, lines,
  }, false);
  await tx.update(schema.payrollRuns).set({ entryId }).where(eq(schema.payrollRuns.id, run.id));
  await audit(tx, ctx.company.id, ctx.user.id, "create", "payroll_run", run.id, { month, source, net: round2(rows.reduce((s, r) => s + r.net, 0)) });
}

async function runLabels() {
  const { t } = await getI18n();
  return { gross: t("gross"), employer: t("er_cost"), net: t("net"), deduction: t("deduction"), memo: t("payroll_memo"), staff: t("employees_count") };
}

/** Payroll from the accountant's Excel sheet: name, position, project and gross pay per person. */
export async function uploadPayroll(fd: FormData) {
  const ctx = await requireWrite("payroll");
  const month = str(fd, "month");
  const back = `/payroll?month=${month}`;
  const unknown: string[] = [];
  try {
    if (!monthOk(month)) throw new UserError("err_required");
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw new UserError("err_required");
    const staff = await readStaffSheet(file);
    if (!staff.length) throw new UserError("err_payroll_sheet");
    const db = await getDb();
    const projects = await db.select().from(schema.projects).where(eq(schema.projects.companyId, ctx.company.id));
    const projectOf = (s: string) => {
      if (!s) return null;
      const p = projects.find((x) => x.code.toLowerCase() === s.toLowerCase() || x.name.toLowerCase() === s.toLowerCase());
      if (!p && !unknown.includes(s)) unknown.push(s);
      return p?.id ?? null;
    };
    const inputs: PayInput[] = staff.map((s) => ({ employeeId: null, name: s.name, position: s.position, projectId: projectOf(s.project), gross: s.gross, otherDeduction: s.deduction }));
    const labels = await runLabels();
    await db.transaction((tx) => createRun(tx, ctx, month, inputs, file.name, labels));
  } catch (e) { fail(e, back); }
  revalidatePath("/payroll");
  redirect(unknown.length ? withParam(back, "unknown", unknown.join(", ")) : back);
}

/** Payroll from the employee list, with this month's bonuses and deductions. */
export async function createRunFromEmployees(fd: FormData) {
  const ctx = await requireWrite("payroll");
  const month = str(fd, "month");
  const back = `/payroll?month=${month}&source=employees`;
  try {
    if (!monthOk(month)) throw new UserError("err_required");
    const db = await getDb();
    const emps = await db.select().from(schema.employees)
      .where(and(eq(schema.employees.companyId, ctx.company.id), eq(schema.employees.isActive, true))).orderBy(schema.employees.name);
    const inputs: PayInput[] = emps.map((e) => ({
      employeeId: e.id, name: e.name, position: e.position, projectId: e.projectId,
      gross: round2(e.basic + e.transport + e.other + parseAmount(fd.get(`b_${e.id}`))), otherDeduction: parseAmount(fd.get(`d_${e.id}`)),
    }));
    const labels = await runLabels();
    await db.transaction((tx) => createRun(tx, ctx, month, inputs, "employees", labels));
  } catch (e) { fail(e, back); }
  revalidatePath("/payroll");
  redirect(`/payroll?month=${month}`);
}

export async function deletePayrollRun(fd: FormData) {
  const ctx = await requireWrite("payroll");
  const id = str(fd, "id");
  let month = "";
  try {
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [run] = await tx.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.id, id), eq(schema.payrollRuns.companyId, ctx.company.id)));
      if (!run) throw new UserError("err_not_found");
      month = run.month;
      if (run.entryId) {
        const [e] = await tx.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, run.entryId));
        if (e?.status === "posted" && !e.reversedById) throw new UserError("err_posted_locked");
        if (e?.status === "draft") { await tx.update(schema.payrollRuns).set({ entryId: null }).where(eq(schema.payrollRuns.id, id)); await tx.delete(schema.journalEntries).where(eq(schema.journalEntries.id, e.id)); }
      }
      await tx.delete(schema.payrollRuns).where(eq(schema.payrollRuns.id, id));
      await audit(tx, ctx.company.id, ctx.user.id, "delete", "payroll_run", id, { month: run.month });
    });
  } catch (e) { fail(e, "/payroll"); }
  revalidatePath("/payroll");
  redirect(`/payroll?month=${month}`);
}
