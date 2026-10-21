"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { parseAmount, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { audit } from "@/lib/audit";
import type { AccountSubtype, AccountType, Role } from "@/db/schema";

const TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];
const SUBTYPES = ["bank", "cash", "momo", "ar", "ap", "vat_in", "vat_out", "wht"] as const;
const done = (tab: string) => { revalidatePath("/settings"); redirect(`/settings?tab=${tab}&saved=1`); };

export async function saveCompanySettings(fd: FormData) {
  const ctx = await requireWrite("owner");
  const db = await getDb();
  await db.update(schema.companies).set({
    name: str(fd, "name") || ctx.company.name, tin: str(fd, "tin"), address: str(fd, "address"),
    vatRegistered: str(fd, "vatRegistered") === "1", vatRate: parseAmount(fd.get("vatRate")),
    policies: String(fd.get("policies") ?? ""),
    settings: { ...ctx.company.settings, arAccount: str(fd, "arAccount"), apAccount: str(fd, "apAccount"), vatIn: str(fd, "vatIn"), vatOut: str(fd, "vatOut"), whtAccount: str(fd, "whtAccount") },
  }).where(eq(schema.companies.id, ctx.company.id));
  await audit(db, ctx.company.id, ctx.user.id, "update", "company", ctx.company.id);
  done("company");
}

export async function saveAccount(fd: FormData) {
  const ctx = await requireWrite();
  const id = str(fd, "id");
  const type = TYPES.find((x) => x === str(fd, "type")) ?? "expense";
  const sub = SUBTYPES.find((x) => x === str(fd, "subtype")) ?? null;
  const values = { code: str(fd, "code"), nameEn: str(fd, "nameEn"), nameFr: str(fd, "nameFr"), type, subtype: sub as AccountSubtype, isActive: str(fd, "isActive") !== "0" };
  try {
    if (!values.code || !values.nameEn || !/^[A-Za-z0-9._-]+$/.test(values.code)) throw new UserError("err_required");
    const db = await getDb();
    if (id) await db.update(schema.accounts).set(values).where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, ctx.company.id)));
    else await db.insert(schema.accounts).values({ ...values, companyId: ctx.company.id });
    await audit(db, ctx.company.id, ctx.user.id, id ? "update" : "create", "account", values.code);
  } catch (e) { fail(e, "/settings?tab=accounts"); }
  done("accounts");
}

export async function deleteAccount(fd: FormData) {
  const ctx = await requireWrite();
  const id = str(fd, "id");
  try {
    const db = await getDb();
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.journalLines).where(eq(schema.journalLines.accountId, id));
    const [{ m }] = await db.select({ m: sql<number>`(select count(*) from invoice_lines where account_id = ${id}) + (select count(*) from bill_lines where account_id = ${id}) + (select count(*) from bank_lines where account_id = ${id}) + (select count(*) from budgets where account_id = ${id})` }).from(schema.accounts).where(eq(schema.accounts.id, id));
    if (Number(n) || Number(m)) throw new UserError("err_in_use");
    await db.delete(schema.accounts).where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, ctx.company.id)));
  } catch (e) { fail(e, "/settings?tab=accounts"); }
  done("accounts");
}

export async function saveProject(fd: FormData) {
  const ctx = await requireWrite();
  const id = str(fd, "id");
  const values = { code: str(fd, "code").toUpperCase(), name: str(fd, "name"), donor: str(fd, "donor"), isActive: str(fd, "isActive") !== "0" };
  try {
    if (!values.code || !values.name) throw new UserError("err_required");
    const db = await getDb();
    if (id) await db.update(schema.projects).set(values).where(and(eq(schema.projects.id, id), eq(schema.projects.companyId, ctx.company.id)));
    else await db.insert(schema.projects).values({ ...values, companyId: ctx.company.id });
    await audit(db, ctx.company.id, ctx.user.id, id ? "update" : "create", "project", values.code);
  } catch (e) { fail(e, "/settings?tab=projects"); }
  done("projects");
}

export async function deleteProject(fd: FormData) {
  const ctx = await requireWrite();
  const id = str(fd, "id");
  try {
    const db = await getDb();
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.journalLines)
      .where(or(eq(schema.journalLines.projectId, id)));
    if (Number(n)) throw new UserError("err_in_use");
    await db.delete(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.companyId, ctx.company.id)));
  } catch (e) { fail(e, "/settings?tab=projects"); }
  done("projects");
}

export async function addMember(fd: FormData) {
  const ctx = await requireWrite("owner");
  const role = (["owner", "accountant", "viewer"] as Role[]).find((r) => r === str(fd, "role")) ?? "viewer";
  try {
    const db = await getDb();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, str(fd, "email").toLowerCase()));
    if (!u) throw new UserError("err_user_not_found");
    await db.insert(schema.memberships).values({ companyId: ctx.company.id, userId: u.id, role })
      .onConflictDoUpdate({ target: [schema.memberships.companyId, schema.memberships.userId], set: { role } });
    await audit(db, ctx.company.id, ctx.user.id, "grant", "member", u.email, { role });
  } catch (e) { fail(e, "/settings?tab=users"); }
  done("users");
}

export async function removeMember(fd: FormData) {
  const ctx = await requireWrite("owner");
  const userId = str(fd, "userId");
  if (userId !== ctx.user.id) {
    const db = await getDb();
    await db.delete(schema.memberships).where(and(eq(schema.memberships.companyId, ctx.company.id), eq(schema.memberships.userId, userId)));
    await audit(db, ctx.company.id, ctx.user.id, "revoke", "member", userId);
  }
  done("users");
}
