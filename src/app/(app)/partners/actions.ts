"use server";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { audit } from "@/lib/audit";

/** Where the list was opened from: all partners, customers or suppliers. */
const backOf = (fd: FormData) => ["/sales/customers", "/purchases/suppliers"].find((p) => p === str(fd, "back")) ?? "/partners";

export async function savePartner(fd: FormData) {
  const ctx = await requireWrite("partners");
  const id = str(fd, "id"), back = backOf(fd);
  const kind = (["customer", "supplier", "both"] as const).find((k) => k === str(fd, "kind")) ?? "customer";
  const values = { name: str(fd, "name"), kind, tin: str(fd, "tin"), phone: str(fd, "phone"), email: str(fd, "email"), address: str(fd, "address") };
  try {
    if (!values.name) throw new UserError("err_required");
    const db = await getDb();
    if (id) await db.update(schema.partners).set(values).where(and(eq(schema.partners.id, id), eq(schema.partners.companyId, ctx.company.id)));
    else await db.insert(schema.partners).values({ ...values, companyId: ctx.company.id });
    await audit(db, ctx.company.id, ctx.user.id, id ? "update" : "create", "partner", id || values.name);
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(back);
}

export async function deletePartner(fd: FormData) {
  const ctx = await requireWrite("partners");
  const id = str(fd, "id"), back = backOf(fd);
  try {
    const db = await getDb();
    const [used] = await db.select({ n: sql<number>`count(*)` }).from(schema.journalLines)
      .where(and(eq(schema.journalLines.companyId, ctx.company.id), eq(schema.journalLines.partnerId, id)));
    const [docs] = await db.select({ n: sql<number>`(select count(*) from invoices where partner_id = ${id}) + (select count(*) from bills where partner_id = ${id}) + (select count(*) from proformas where partner_id = ${id}) + (select count(*) from goods_receipts where partner_id = ${id})` }).from(schema.companies).limit(1);
    const [procurement] = await db.select({ n: sql<number>`(select count(*) from bids where partner_id = ${id}) + (select count(*) from contracts where partner_id = ${id}) + (select count(*) from memberships where partner_id = ${id})` }).from(schema.companies).limit(1);
    if (Number(used.n) || Number(docs?.n) || Number(procurement?.n)) throw new UserError("err_in_use");
    await db.delete(schema.partners).where(and(eq(schema.partners.id, id), eq(schema.partners.companyId, ctx.company.id)));
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(back);
}
