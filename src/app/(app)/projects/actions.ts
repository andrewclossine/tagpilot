"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isUuid, parseAmount, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { addLogItem, deleteLogItem, updateLogItem, type LogInput } from "@/lib/programs";
import { audit } from "@/lib/audit";

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
    }).returning({ id: schema.projects.id });
    id = row.id;
    await audit(db, ctx.company.id, ctx.user.id, "create", "project", code);
  } catch (e) { fail(e, "/projects"); }
  revalidatePath("/projects");
  redirect(`/projects/${id}`);
}

function readItem(fd: FormData): LogInput {
  const title = str(fd, "title");
  const budget = parseAmount(fd.get("budget")), accountId = str(fd, "accountId");
  if (!title) throw new UserError("err_required");
  if (budget < 0) throw new UserError("err_amount");
  return {
    title, indicator: str(fd, "indicator"), target: str(fd, "target"), verification: str(fd, "verification"), assumptions: str(fd, "assumptions"),
    budget, accountId: isUuid(accountId) ? accountId : null,
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
  const back = `/projects/${projectId}?view=${str(fd, "view") || "budget"}`;
  try {
    const db = await getDb();
    const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.companyId, ctx.company.id)));
    if (!project) throw new UserError("err_not_found");
    const input = readItem(fd);
    await assertAccount(ctx.company.id, input.accountId);
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
  const projectId = str(fd, "projectId"), back = `/projects/${projectId}?view=${str(fd, "view") || "budget"}`;
  try {
    const db = await getDb();
    await db.transaction((tx) => deleteLogItem(tx, ctx.company.id, ctx.user.id, str(fd, "id")));
  } catch (e) { fail(e, back); }
  revalidatePath(`/projects/${projectId}`);
  redirect(back);
}
