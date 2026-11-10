"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isUuid, str } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { UserError } from "@/lib/ledger";
import { audit } from "@/lib/audit";
import { notifySuppliers } from "@/lib/procurement";
import { decideCategory, reviewDocument, setRegistration, setSupplierStatus } from "@/lib/suppliers";
import type { SupplierStatus } from "@/db/schema";

const REG = "/procurement/suppliers/registry";
const profile = (id: string) => `/procurement/suppliers/${id}`;

export async function toggleRegistration(fd: FormData) {
  const ctx = await requireWrite("procurement");
  try {
    const db = await getDb();
    await db.transaction((tx) => setRegistration(tx, ctx, str(fd, "open") === "1"));
  } catch (e) { fail(e, REG); }
  revalidatePath(REG);
  redirect(REG);
}

export async function addCategory(fd: FormData) {
  const ctx = await requireWrite("procurement");
  try {
    const name = str(fd, "name").slice(0, 100);
    if (!name) throw new UserError("err_required");
    const db = await getDb();
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.supplierCategories).where(eq(schema.supplierCategories.companyId, ctx.company.id));
    await db.insert(schema.supplierCategories).values({ companyId: ctx.company.id, name, sortOrder: Number(n) + 1 });
    await audit(db, ctx.company.id, ctx.user.id, "add_category", "supplier", name);
  } catch (e) { fail(e, REG); }
  revalidatePath(REG);
  redirect(`${REG}#categories`);
}

export async function removeCategory(fd: FormData) {
  const ctx = await requireWrite("procurement");
  try {
    const id = str(fd, "categoryId");
    if (!isUuid(id)) throw new UserError("err_not_found");
    const db = await getDb();
    await db.delete(schema.supplierCategories).where(and(eq(schema.supplierCategories.id, id), eq(schema.supplierCategories.companyId, ctx.company.id)));
  } catch (e) { fail(e, REG); }
  revalidatePath(REG);
  redirect(`${REG}#categories`);
}

export async function reviewDocumentAction(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "partnerId");
  try {
    const db = await getDb();
    await db.transaction((tx) => reviewDocument(tx, ctx, str(fd, "docId"), str(fd, "decision") === "accept", str(fd, "note")));
  } catch (e) { fail(e, profile(id)); }
  revalidatePath(profile(id));
  redirect(`${profile(id)}#documents`);
}

/** Approves, rejects or suspends; the supplier hears it by email. */
export async function setStatusAction(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "partnerId"), status = str(fd, "status") as SupplierStatus, note = str(fd, "note");
  const { t } = await getI18n();
  try {
    if (!["approved", "rejected", "suspended"].includes(status)) throw new UserError("err_generic");
    const db = await getDb();
    await db.transaction((tx) => setSupplierStatus(tx, ctx, id, status, note));
    await notifySuppliers(db, [id], `${t(`sst_${status as "approved"}`)} - ${ctx.company.name}`, `${t("reg_mail_status")}: ${t(`sst_${status as "approved"}`)}${note ? `\n\n${note}` : ""}`);
  } catch (e) { fail(e, profile(id)); }
  revalidatePath(profile(id));
  revalidatePath(REG);
  redirect(profile(id));
}

export async function decideCategoryAction(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "partnerId");
  try {
    const db = await getDb();
    await db.transaction((tx) => decideCategory(tx, ctx, id, str(fd, "categoryId"), str(fd, "decision") === "prequalify", str(fd, "note")));
  } catch (e) { fail(e, profile(id)); }
  revalidatePath(profile(id));
  redirect(`${profile(id)}#categories`);
}
