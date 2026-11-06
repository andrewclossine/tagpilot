"use server";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";

export type QuickPartner = { ok: true; id: string; name: string } | { ok: false; error: string };

/**
 * Adds a customer or supplier from inside a form, so the person does not lose what they were typing.
 * A name that already exists is reused rather than added twice.
 */
export async function quickAddPartner(kind: "customer" | "supplier", input: { name: string; tin: string; phone: string; email: string }): Promise<QuickPartner> {
  const ctx = await getCtx();
  const { t } = await getI18n();
  if (!ctx.can("partners", "write") || ctx.locked) return { ok: false, error: t("no_access_title") };
  if (kind !== "customer" && kind !== "supplier") return { ok: false, error: t("err_required") };
  const name = String(input.name ?? "").trim().slice(0, 200);
  if (!name) return { ok: false, error: t("err_required") };
  const clean = (v: unknown, n = 120) => String(v ?? "").trim().slice(0, n);
  const db = await getDb();
  const [same] = await db.select().from(schema.partners)
    .where(and(eq(schema.partners.companyId, ctx.company.id), sql`lower(${schema.partners.name}) = lower(${name})`)).limit(1);
  if (same) {
    // Someone already known as the other kind becomes both.
    if (same.kind !== kind && same.kind !== "both") await db.update(schema.partners).set({ kind: "both" }).where(eq(schema.partners.id, same.id));
    return { ok: true, id: same.id, name: same.name };
  }
  const [row] = await db.insert(schema.partners).values({
    companyId: ctx.company.id, name, kind, tin: clean(input.tin, 40), phone: clean(input.phone, 40), email: clean(input.email).toLowerCase(), address: "",
  }).returning({ id: schema.partners.id });
  await audit(db, ctx.company.id, ctx.user.id, "create", "partner", name);
  revalidatePath(kind === "customer" ? "/sales/customers" : "/purchases/suppliers");
  return { ok: true, id: row.id, name };
}
