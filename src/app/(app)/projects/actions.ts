"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, round2, str, today } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { addLogItem, deleteLogItem, logframe, updateLogItem, type LogInput } from "@/lib/programs";
import { deleteReport, isSchedule, saveReport } from "@/lib/achievement-reports";
import { readBudgetTemplate, saveTemplateRows } from "@/lib/budget-template";
import { quartersOf, spreadPlan } from "@/lib/project-status";
import { readProjectDocument, saveImportedProject } from "@/lib/project-import";
import { optionalUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";
import type { BudgetPlan } from "@/db/schema";

const backTo = (id: string, view: string) => `/projects/${id}?view=${view}`;
const dateOrNull = (fd: FormData, key: string) => { const d = str(fd, key); return isIsoDate(d) ? d : null; };

async function ownProject(companyId: string, id: string) {
  const db = await getDb();
  const [p] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.companyId, companyId)));
  if (!p) throw new UserError("err_not_found");
  return p;
}

/** Adds a project or cost center; each one gets its own results framework and budget. */
export async function addProject(fd: FormData) {
  const ctx = await requireWrite("projects");
  let id = "";
  try {
    const code = str(fd, "code"), name = str(fd, "name");
    if (!code || !name) throw new UserError("err_required");
    const db = await getDb();
    const [row] = await db.insert(schema.projects).values({
      companyId: ctx.company.id, code, name, donor: str(fd, "donor"), kind: str(fd, "kind") === "cost_center" ? "cost_center" : "project",
      startDate: dateOrNull(fd, "startDate"), endDate: dateOrNull(fd, "endDate"),
    }).returning({ id: schema.projects.id });
    id = row.id;
    await audit(db, ctx.company.id, ctx.user.id, "create", "project", code);
  } catch (e) { fail(e, "/projects"); }
  revalidatePath("/projects");
  redirect(`/projects/${id}`);
}

/** Creates a project from a project document in Excel: its logical framework, budget and workplan. */
export async function importProject(fd: FormData) {
  const ctx = await requireWrite("projects");
  let id = "";
  try {
    const code = str(fd, "code"), name = str(fd, "name"), file = fd.get("file");
    if (!code || !(file instanceof File) || !file.size) throw new UserError("err_required");
    if (file.size > 15 * 1024 * 1024) throw new UserError("err_file_size");
    const parsed = await readProjectDocument(Buffer.from(await file.arrayBuffer()));
    const db = await getDb();
    id = await db.transaction((tx) => saveImportedProject(tx, ctx.company.id, ctx.user.id, parsed, code, name || parsed.title.slice(0, 120) || code, str(fd, "donor")));
  } catch (e) { fail(e, "/projects/import"); }
  revalidatePath("/projects");
  redirect(`/projects/${id}?view=budget&imported=1`);
}

/** Fills a project's budget from the filled template. Nothing is saved unless every row is right; otherwise each problem is listed by row. */
export async function uploadBudget(fd: FormData) {
  const ctx = await requireWrite("projects");
  const existing = str(fd, "projectId");
  const back = existing ? `/projects/import?project=${existing}` : "/projects/import";
  let id = existing;
  try {
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw new UserError("err_required");
    if (file.size > 15 * 1024 * 1024) throw new UserError("err_file_size");
    const db = await getDb();
    if (existing) { if (!isUuid(existing)) throw new UserError("err_not_found"); await ownProject(ctx.company.id, existing); }
    const code = str(fd, "code"), name = str(fd, "name");
    if (!existing && (!code || !name)) throw new UserError("err_required");
    if (!existing) {
      const [used] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.companyId, ctx.company.id), eq(schema.projects.code, code)));
      if (used) throw new UserError("err_code_taken");
    }
    const { rows, issues } = await readBudgetTemplate(Buffer.from(await file.arrayBuffer()));
    if (issues.length) {
      const list = issues.slice(0, 25).map((i) => `${i.row}:${i.code}`).join(",");
      id = "";
      redirect(`${back}${back.includes("?") ? "&" : "?"}issues=${list}`);
    }
    if (!rows.length) throw new UserError("err_template_empty");
    id = await db.transaction(async (tx) => {
      let projectId = existing;
      if (!projectId) {
        const [row] = await tx.insert(schema.projects).values({ companyId: ctx.company.id, code, name, donor: str(fd, "donor"), kind: str(fd, "kind") === "cost_center" ? "cost_center" : "project" }).returning({ id: schema.projects.id });
        projectId = row.id;
      }
      await saveTemplateRows(tx, ctx.company.id, ctx.user.id, projectId, rows);
      return projectId;
    });
  } catch (e) { fail(e, back); }
  revalidatePath("/projects");
  redirect(`/projects/${id}?view=budget&imported=1`);
}

/** Saves the workplan: who does each budget line and when. The quarterly plan follows from the dates. */
export async function saveWorkplan(fd: FormData) {
  const ctx = await requireWrite("projects");
  const projectId = str(fd, "projectId"), back = backTo(projectId, "workplan");
  try {
    if (!isUuid(projectId)) throw new UserError("err_not_found");
    await ownProject(ctx.company.id, projectId);
    const startDate = dateOrNull(fd, "startDate"), endDate = dateOrNull(fd, "endDate");
    if (startDate && endDate && endDate < startDate) throw new UserError("err_contract_dates");
    const db = await getDb();
    const rows = await logframe(db, ctx.company.id, projectId);
    const project = { startDate, endDate };
    await db.transaction(async (tx) => {
      await tx.update(schema.projects).set(project).where(eq(schema.projects.id, projectId));
      const planned = rows.filter((r) => r.isLine).map((r) => {
        const start = dateOrNull(fd, `start_${r.id}`), end = dateOrNull(fd, `end_${r.id}`);
        if (start && end && end < start) throw new UserError("err_contract_dates");
        return { r, responsible: str(fd, `resp_${r.id}`), start, end };
      });
      // Long enough for every line, even one that runs past the project's own end date.
      const lastEnd = planned.map((p) => p.end ?? "").concat(endDate ?? "").sort().at(-1) || null;
      const quarters = quartersOf({ startDate, endDate: lastEnd }, []);
      for (const { r, responsible, start, end } of planned) {
        const plan = spreadPlan({ quantity: r.quantity, budget: r.budget, startDate: start, endDate: end }, quarters);
        await tx.update(schema.logframeItems).set({ responsible, startDate: start, endDate: end, plan }).where(eq(schema.logframeItems.id, r.id));
      }
      await audit(tx, ctx.company.id, ctx.user.id, "update", "workplan", projectId, { lines: planned.length });
    });
  } catch (e) { fail(e, back); }
  revalidatePath(`/projects/${projectId}`);
  redirect(`${back}&saved=1`);
}

/** Deletes a project that nothing has been done on yet, for example after importing the wrong file. */
export async function deleteProject(fd: FormData) {
  const ctx = await requireWrite("projects");
  const id = str(fd, "id");
  try {
    await ownProject(ctx.company.id, id);
    const db = await getDb();
    const [{ n }] = await db.select({
      n: sql<number>`(select count(*) from payment_vouchers where project_id = ${id}) + (select count(*) from achievements where project_id = ${id}) + (select count(*) from journal_lines where project_id = ${id}) + (select count(*) from tenders where project_id = ${id}) + (select count(*) from contracts where project_id = ${id})`,
    }).from(schema.companies).limit(1);
    if (Number(n)) throw new UserError("err_in_use");
    await db.delete(schema.projects).where(eq(schema.projects.id, id));
    await audit(db, ctx.company.id, ctx.user.id, "delete", "project", id);
  } catch (e) { fail(e, `/projects/${id}?view=details`); }
  revalidatePath("/projects");
  redirect("/projects");
}

export async function saveProjectDetails(fd: FormData) {
  const ctx = await requireWrite("projects");
  const id = str(fd, "id");
  try {
    await ownProject(ctx.company.id, id);
    if (!str(fd, "name")) throw new UserError("err_required");
    const db = await getDb();
    await db.update(schema.projects).set({
      name: str(fd, "name"), donor: str(fd, "donor"), description: str(fd, "description"), startDate: dateOrNull(fd, "startDate"), endDate: dateOrNull(fd, "endDate"),
    }).where(eq(schema.projects.id, id));
    await audit(db, ctx.company.id, ctx.user.id, "update", "project", id);
  } catch (e) { fail(e, backTo(id, "details")); }
  revalidatePath(`/projects/${id}`);
  redirect(`${backTo(id, "details")}&saved=1`);
}

function readItem(fd: FormData): LogInput {
  const title = str(fd, "title");
  const budget = parseAmount(fd.get("budget")), accountId = str(fd, "accountId"), quantity = parseAmount(fd.get("quantity")), unitCost = parseAmount(fd.get("unitCost"));
  if (!title) throw new UserError("err_required");
  if (budget < 0 || quantity < 0 || unitCost < 0) throw new UserError("err_amount");
  const startDate = dateOrNull(fd, "startDate"), endDate = dateOrNull(fd, "endDate");
  if (startDate && endDate && endDate < startDate) throw new UserError("err_contract_dates");
  // The quantity planned for each quarter; its amount follows from the unit cost.
  const plan: BudgetPlan = {};
  for (const [k, v] of fd.entries()) {
    const m = /^plan_(Y\d+Q\d)$/.exec(k);
    if (!m) continue;
    const qty = parseAmount(v as string);
    if (qty) plan[m[1]] = { qty, amount: round2(qty * unitCost) };
  }
  return {
    title, indicator: str(fd, "indicator"), target: str(fd, "target"), verification: str(fd, "verification"), assumptions: str(fd, "assumptions"),
    budget, accountId: isUuid(accountId) ? accountId : null, category: str(fd, "category"), unit: str(fd, "unit"), quantity, unitCost,
    ownContribution: parseAmount(fd.get("ownContribution")), plan, responsible: str(fd, "responsible"), startDate, endDate,
    baselineQty: parseAmount(fd.get("baselineQty")), baselineSpent: parseAmount(fd.get("baselineSpent")),
  };
}

async function assertAccount(companyId: string, accountId: string | null) {
  if (!accountId) return;
  const db = await getDb();
  const [a] = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.companyId, companyId)));
  if (!a) throw new UserError("err_account");
}

export async function saveLogItem(fd: FormData) {
  const ctx = await requireWrite("projects");
  const projectId = str(fd, "projectId"), id = str(fd, "id"), parentId = str(fd, "parentId");
  const back = backTo(projectId, str(fd, "view") || "budget");
  try {
    await ownProject(ctx.company.id, projectId);
    const input = readItem(fd);
    await assertAccount(ctx.company.id, input.accountId);
    const db = await getDb();
    await db.transaction(async (tx) => {
      if (id) await updateLogItem(tx, ctx.company.id, ctx.user.id, id, input);
      else await addLogItem(tx, ctx.company.id, ctx.user.id, projectId, isUuid(parentId) ? parentId : null, input);
    });
  } catch (e) { fail(e, back); }
  revalidatePath(`/projects/${projectId}`);
  redirect(back);
}

export async function removeLogItem(fd: FormData) {
  const ctx = await requireWrite("projects");
  const projectId = str(fd, "projectId"), back = backTo(projectId, str(fd, "view") || "budget");
  try {
    const db = await getDb();
    await db.transaction((tx) => deleteLogItem(tx, ctx.company.id, ctx.user.id, str(fd, "id")));
  } catch (e) { fail(e, back); }
  revalidatePath(`/projects/${projectId}`);
  redirect(back);
}

/** Saves a progress report: what was achieved on each budget line in the chosen period. */
export async function saveAchievementReport(fd: FormData) {
  const ctx = await requireWrite("achievements");
  const projectId = str(fd, "projectId"), schedule = str(fd, "schedule"), date = str(fd, "date");
  const back = `${backTo(projectId, "achievements")}&schedule=${encodeURIComponent(schedule)}&date=${encodeURIComponent(date)}`;
  try {
    if (!isUuid(projectId)) throw new UserError("err_not_found");
    await ownProject(ctx.company.id, projectId);
    if (!isSchedule(schedule) || !isIsoDate(date)) throw new UserError("err_required");
    const lines = [...fd.keys()].filter((k) => k.startsWith("qty_")).map((k) => {
      const itemId = k.slice(4), raw = str(fd, k);
      return { itemId, quantity: raw ? parseAmount(raw) : 0, description: str(fd, `note_${itemId}`) };
    });
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    const db = await getDb();
    await db.transaction((tx) => saveReport(tx, ctx.company.id, ctx.user.id, ctx.role !== "staff", projectId, { schedule, date, attachmentId, lines }));
  } catch (e) { fail(e, back); }
  revalidatePath(`/projects/${projectId}`);
  redirect(`${back}&saved=1`);
}

export async function removeAchievementReport(fd: FormData) {
  const ctx = await requireWrite("achievements");
  const projectId = str(fd, "projectId"), back = backTo(projectId, "achievements");
  try {
    const id = str(fd, "id");
    if (!isUuid(id)) throw new UserError("err_not_found");
    const db = await getDb();
    await db.transaction((tx) => deleteReport(tx, ctx.company.id, ctx.user.id, ctx.role !== "staff", id));
  } catch (e) { fail(e, back); }
  revalidatePath(`/projects/${projectId}`);
  redirect(back);
}

export async function addFunds(fd: FormData) {
  const ctx = await requireWrite("projects");
  const projectId = str(fd, "projectId"), back = backTo(projectId, "status");
  try {
    await ownProject(ctx.company.id, projectId);
    const date = str(fd, "date"), amount = parseAmount(fd.get("amount"));
    if (!isIsoDate(date)) throw new UserError("err_required");
    if (!(amount > 0)) throw new UserError("err_amount");
    const db = await getDb();
    await db.insert(schema.projectFunds).values({ companyId: ctx.company.id, projectId, date, amount, reference: str(fd, "reference") });
    await audit(db, ctx.company.id, ctx.user.id, "create", "project_funds", projectId, { amount, date });
  } catch (e) { fail(e, back); }
  revalidatePath(`/projects/${projectId}`);
  redirect(back);
}
