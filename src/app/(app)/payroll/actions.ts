"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { lastDayOfMonth, parseAmount, round2, str } from "@/lib/format";
import { accountIdByCode, saveEntry, UserError, type LineInput } from "@/lib/ledger";
import { payslip } from "@/lib/payroll";
import { PAYROLL_DEFAULTS } from "@/lib/template";
import { getI18n } from "@/lib/i18n";
import { audit } from "@/lib/audit";
import type { PayrollSettings } from "@/db/schema";

const monthOk = (m: string) => /^\d{4}-\d{2}$/.test(m);

export async function saveEmployee(fd: FormData) {
  const ctx = await requireWrite();
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
  } catch (e) { fail(e, "/payroll"); }
  revalidatePath("/payroll");
  redirect("/payroll");
}

export async function savePayrollSettings(fd: FormData) {
  const ctx = await requireWrite("owner");
  const n = (k: string) => parseAmount(fd.get(k));
  const payroll: PayrollSettings = {
    brackets: str(fd, "brackets") || PAYROLL_DEFAULTS.brackets,
    pensionEmp: n("pensionEmp"), pensionEr: n("pensionEr"), matEmp: n("matEmp"), matEr: n("matEr"), ohEr: n("ohEr"), cbhi: n("cbhi"),
    payeTransport: str(fd, "payeTransport") === "1", rssbTransport: str(fd, "rssbTransport") === "1",
    accSalary: str(fd, "accSalary"), accEmployer: str(fd, "accEmployer"), accPaye: str(fd, "accPaye"),
    accRssb: str(fd, "accRssb"), accNet: str(fd, "accNet"), accAdv: str(fd, "accAdv"),
  };
  const db = await getDb();
  await db.update(schema.companies).set({ settings: { ...ctx.company.settings, payroll } }).where(eq(schema.companies.id, ctx.company.id));
  await audit(db, ctx.company.id, ctx.user.id, "update", "payroll_settings", ctx.company.id);
  revalidatePath("/payroll");
  redirect("/payroll?saved=1");
}

/** Calculates every active employee's payslip for the month and books one draft payroll entry. */
export async function createPayrollRun(fd: FormData) {
  const ctx = await requireWrite();
  const { t } = await getI18n();
  const month = str(fd, "month");
  const back = `/payroll?month=${month}`;
  try {
    if (!monthOk(month)) throw new UserError("err_required");
    const cfg = { ...PAYROLL_DEFAULTS, ...ctx.company.settings.payroll };
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [exists] = await tx.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.companyId, ctx.company.id), eq(schema.payrollRuns.month, month)));
      if (exists) throw new UserError("err_payroll_exists");
      const emps = await tx.select().from(schema.employees)
        .where(and(eq(schema.employees.companyId, ctx.company.id), eq(schema.employees.isActive, true))).orderBy(schema.employees.name);
      if (!emps.length) throw new UserError("err_no_lines");
      const rows = emps.map((e) => payslip(e, { bonus: parseAmount(fd.get(`b_${e.id}`)), deduction: parseAmount(fd.get(`d_${e.id}`)) }, cfg));
      const sum = (k: keyof (typeof rows)[number]) => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));

      const acc = async (code: string) => accountIdByCode(tx, ctx.company.id, code);
      const byProject = new Map<string, { gross: number; er: number }>();
      for (const r of rows) {
        const k = r.projectId ?? "";
        const v = byProject.get(k) ?? { gross: 0, er: 0 };
        v.gross = round2(v.gross + r.gross); v.er = round2(v.er + r.employer);
        byProject.set(k, v);
      }
      const lines: LineInput[] = [];
      for (const [p, v] of byProject) {
        lines.push({ accountId: await acc(cfg.accSalary), debit: v.gross, credit: 0, description: t("gross"), projectId: p || null });
        if (v.er) lines.push({ accountId: await acc(cfg.accEmployer), debit: v.er, credit: 0, description: t("er_cost"), projectId: p || null });
      }
      const rssb = round2(sum("penE") + sum("penR") + sum("matE") + sum("matR") + sum("oh") + sum("cbhi"));
      if (sum("paye")) lines.push({ accountId: await acc(cfg.accPaye), debit: 0, credit: sum("paye"), description: t("paye") });
      if (rssb) lines.push({ accountId: await acc(cfg.accRssb), debit: 0, credit: rssb, description: `${t("pension")}, ${t("maternity")}, ${t("oh")}, ${t("cbhi")}` });
      if (sum("deduction")) lines.push({ accountId: await acc(cfg.accAdv), debit: 0, credit: sum("deduction"), description: t("deduction") });
      lines.push({ accountId: await acc(cfg.accNet), debit: 0, credit: sum("net"), description: t("net") });

      const [run] = await tx.insert(schema.payrollRuns).values({ companyId: ctx.company.id, month, rows, settings: cfg }).returning({ id: schema.payrollRuns.id });
      const entryId = await saveEntry(tx, ctx.company.id, ctx.user.id, {
        date: lastDayOfMonth(month), reference: `PAY-${month}`, memo: `${t("payroll_memo")} ${month} - ${rows.length} ${t("employees_count")}`,
        source: "payroll", sourceId: run.id, projectId: byProject.size === 1 ? [...byProject.keys()][0] || null : null, lines,
      }, false);
      await tx.update(schema.payrollRuns).set({ entryId }).where(eq(schema.payrollRuns.id, run.id));
      await audit(tx, ctx.company.id, ctx.user.id, "create", "payroll_run", run.id, { month, net: sum("net") });
    });
  } catch (e) { fail(e, back); }
  revalidatePath("/payroll");
  redirect(back);
}

export async function deletePayrollRun(fd: FormData) {
  const ctx = await requireWrite();
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
