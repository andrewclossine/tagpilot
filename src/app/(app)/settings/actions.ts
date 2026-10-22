"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { parseAmount, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { companyProfile, CURRENCIES } from "@/lib/template";
import { audit } from "@/lib/audit";
import type { AccountSubtype, AccountType } from "@/db/schema";

const TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];
const SUBTYPES = ["bank", "cash", "momo", "ar", "ap", "vat_in", "vat_out", "wht"] as const;

export async function saveCompanySettings(fd: FormData) {
  const ctx = await requireWrite("company");
  const vatRegistered = str(fd, "vat") === "1";
  const db = await getDb();
  await db.update(schema.companies).set({
    name: str(fd, "name") || ctx.company.name, ...companyProfile(fd),
    currency: CURRENCIES.includes(str(fd, "currency")) ? str(fd, "currency") : ctx.company.currency,
    vatRegistered, vatRate: vatRegistered ? parseAmount(fd.get("vatRate")) : 0,
    policies: String(fd.get("policies") ?? ""),
    settings: { ...ctx.company.settings, arAccount: str(fd, "arAccount"), apAccount: str(fd, "apAccount"), vatIn: str(fd, "vatIn"), vatOut: str(fd, "vatOut"), whtAccount: str(fd, "whtAccount") },
  }).where(eq(schema.companies.id, ctx.company.id));
  await audit(db, ctx.company.id, ctx.user.id, "update", "company", ctx.company.id);
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function saveAccount(fd: FormData) {
  const ctx = await requireWrite("accounts");
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
  } catch (e) { fail(e, "/accounts"); }
  revalidatePath("/accounts");
  redirect("/accounts?saved=1");
}

export async function deleteAccount(fd: FormData) {
  const ctx = await requireWrite("accounts");
  const id = str(fd, "id");
  try {
    const db = await getDb();
    const [{ n }] = await db.select({ n: sql<number>`(select count(*) from journal_lines where account_id = ${id}) + (select count(*) from invoice_lines where account_id = ${id}) + (select count(*) from bill_lines where account_id = ${id}) + (select count(*) from bank_lines where account_id = ${id}) + (select count(*) from budgets where account_id = ${id})` })
      .from(schema.accounts).where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, ctx.company.id)));
    if (Number(n)) throw new UserError("err_in_use");
    await db.delete(schema.accounts).where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, ctx.company.id)));
  } catch (e) { fail(e, "/accounts"); }
  revalidatePath("/accounts");
  redirect("/accounts");
}

export async function saveProject(fd: FormData) {
  const ctx = await requireWrite("accounts");
  const id = str(fd, "id");
  const values = { code: str(fd, "code").toUpperCase(), name: str(fd, "name"), donor: str(fd, "donor"), isActive: str(fd, "isActive") !== "0" };
  try {
    if (!values.code || !values.name) throw new UserError("err_required");
    const db = await getDb();
    if (id) await db.update(schema.projects).set(values).where(and(eq(schema.projects.id, id), eq(schema.projects.companyId, ctx.company.id)));
    else await db.insert(schema.projects).values({ ...values, companyId: ctx.company.id });
    await audit(db, ctx.company.id, ctx.user.id, id ? "update" : "create", "project", values.code);
  } catch (e) { fail(e, "/settings?tab=projects"); }
  revalidatePath("/settings");
  redirect("/settings?tab=projects&saved=1");
}

export async function deleteProject(fd: FormData) {
  const ctx = await requireWrite("accounts");
  const id = str(fd, "id");
  try {
    const db = await getDb();
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.journalLines).where(eq(schema.journalLines.projectId, id));
    if (Number(n)) throw new UserError("err_in_use");
    await db.delete(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.companyId, ctx.company.id)));
  } catch (e) { fail(e, "/settings?tab=projects"); }
  revalidatePath("/settings");
  redirect("/settings?tab=projects");
}
