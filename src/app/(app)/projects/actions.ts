"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, round2, str, today } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { addLogItem, assertBudgetLine, deleteLogItem, updateLogItem, type LogInput } from "@/lib/programs";
import { readProjectDocument, saveImportedProject } from "@/lib/project-import";
import { optionalUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";
import type { BudgetPlan, Milestone } from "@/db/schema";

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

/** Records what was done on a budget line. */
export async function addAchievement(fd: FormData) {
  const ctx = await requireWrite("achievements");
  const projectId = str(fd, "projectId"), back = backTo(projectId, "achievements");
  try {
    await ownProject(ctx.company.id, projectId);
    const itemId = str(fd, "budgetItemId"), date = str(fd, "date") || today(), quantity = parseAmount(fd.get("quantity"));
    if (!isUuid(itemId) || !isIsoDate(date)) throw new UserError("err_required");
    if (!quantity) throw new UserError("err_amount");
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    const db = await getDb();
    await db.transaction(async (tx) => {
      const line = await assertBudgetLine(tx, ctx.company.id, itemId);
      if (line.projectId !== projectId) throw new UserError("err_not_found");
      await tx.insert(schema.achievements).values({ companyId: ctx.company.id, projectId, budgetItemId: itemId, date, quantity, description: str(fd, "description"), attachmentId, enteredBy: ctx.user.id });
      await audit(tx, ctx.company.id, ctx.user.id, "create", "achievement", line.taskCode || line.code, { quantity, date });
    });
  } catch (e) { fail(e, back); }
  revalidatePath(`/projects/${projectId}`);
  redirect(`${back}&saved=1`);
}

export async function removeAchievement(fd: FormData) {
  const ctx = await requireWrite("achievements");
  const projectId = str(fd, "projectId"), id = str(fd, "id"), back = backTo(projectId, "achievements");
  try {
    const db = await getDb();
    const [a] = await db.select().from(schema.achievements).where(and(eq(schema.achievements.id, id), eq(schema.achievements.companyId, ctx.company.id)));
    if (!a) throw new UserError("err_not_found");
    if (ctx.role === "staff" && a.enteredBy !== ctx.user.id) throw new UserError("err_voucher_not_yours");
    await db.delete(schema.achievements).where(eq(schema.achievements.id, id));
    await audit(db, ctx.company.id, ctx.user.id, "delete", "achievement", id, { quantity: a.quantity, date: a.date });
  } catch (e) { fail(e, back); }
  revalidatePath(`/projects/${projectId}`);
  redirect(back);
}

/** Records what was achieved on an indicator, milestone by milestone. */
export async function saveIndicatorResults(fd: FormData) {
  const ctx = await requireWrite("achievements");
  const projectId = str(fd, "projectId"), id = str(fd, "id"), back = backTo(projectId, "logframe");
  try {
    const db = await getDb();
    const [ind] = await db.select().from(schema.indicators).where(and(eq(schema.indicators.id, id), eq(schema.indicators.companyId, ctx.company.id)));
    if (!ind) throw new UserError("err_not_found");
    const milestones: Milestone[] = ind.milestones.map((m, i) => {
      const raw = str(fd, `achieved_${i}`);
      return { ...m, achieved: raw === "" ? null : parseAmount(raw) };
    });
    await db.update(schema.indicators).set({ milestones }).where(eq(schema.indicators.id, id));
    await audit(db, ctx.company.id, ctx.user.id, "update", "indicator", ind.name.slice(0, 80));
  } catch (e) { fail(e, back); }
  revalidatePath(`/projects/${projectId}`);
  redirect(back);
}

export async function addIndicator(fd: FormData) {
  const ctx = await requireWrite("projects");
  const projectId = str(fd, "projectId"), itemId = str(fd, "itemId"), back = backTo(projectId, "logframe");
  try {
    const name = str(fd, "name");
    if (!name || !isUuid(itemId)) throw new UserError("err_required");
    const db = await getDb();
    const [item] = await db.select().from(schema.logframeItems).where(and(eq(schema.logframeItems.id, itemId), eq(schema.logframeItems.companyId, ctx.company.id)));
    if (!item) throw new UserError("err_not_found");
    // One planned figure per milestone, written "Y1:40, Y2:60".
    const milestones: Milestone[] = str(fd, "milestones").split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
      const [label, planned] = p.split(":").map((x) => x.trim());
      return { label, planned: planned ? parseAmount(planned) : null, achieved: null };
    });
    await db.insert(schema.indicators).values({
      companyId: ctx.company.id, itemId, name, baseline: str(fd, "baseline") === "" ? null : parseAmount(fd.get("baseline")), target: str(fd, "target") === "" ? null : parseAmount(fd.get("target")),
      source: str(fd, "source"), assumptions: str(fd, "assumptions"), milestones,
    });
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
