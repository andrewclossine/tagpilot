"use server";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { addDays, isIsoDate, parseAmount, str } from "@/lib/format";
import { postDoc, saveDocDraft } from "@/lib/documents";
import { getI18n } from "@/lib/i18n";
import { UserError } from "@/lib/ledger";
import { audit } from "@/lib/audit";

/** Where the list was opened from: all partners, customers or suppliers. */
const backOf = (fd: FormData) => ["/sales/customers", "/purchases/suppliers"].find((p) => p === str(fd, "back")) ?? "/partners";

export async function savePartner(fd: FormData) {
  const ctx = await requireWrite("partners");
  const id = str(fd, "id"), back = backOf(fd);
  const kind = (["customer", "supplier", "both"] as const).find((k) => k === str(fd, "kind")) ?? "customer";
  const taxCode = (["standard", "zero", "exempt"] as const).find((k) => k === str(fd, "taxCode")) ?? "standard";
  const terms = Math.round(Number(str(fd, "paymentTerms") || 0));
  const values = {
    name: str(fd, "name"), kind, tin: str(fd, "tin"), phone: str(fd, "phone"), email: str(fd, "email").toLowerCase(),
    address: str(fd, "address"), address2: str(fd, "address2"), address3: str(fd, "address3"), website: str(fd, "website"), workPhone: str(fd, "workPhone"),
    bankAccount: str(fd, "bankAccount"), paymentTerms: terms, creditLimit: parseAmount(fd.get("creditLimit")), taxCode,
  };
  const opening = parseAmount(fd.get("openingBalance")), openingDate = str(fd, "openingDate");
  try {
    if (!values.name) throw new UserError("err_required");
    if (!Number.isFinite(terms) || terms < 0 || terms > 3650) throw new UserError("err_payment_terms");
    if (values.creditLimit < 0 || opening < 0) throw new UserError("err_amount");
    if (opening && !isIsoDate(openingDate)) throw new UserError("err_opening_date");
    const db = await getDb();
    const { t } = await getI18n();
    await db.transaction(async (tx) => {
      let partnerId = id;
      let current: typeof schema.partners.$inferSelect | undefined;
      if (id) {
        [current] = await tx.select().from(schema.partners).where(and(eq(schema.partners.id, id), eq(schema.partners.companyId, ctx.company.id)));
        if (!current) throw new UserError("err_not_found");
        await tx.update(schema.partners).set(values).where(eq(schema.partners.id, id));
      } else {
        const [row] = await tx.insert(schema.partners).values({ ...values, companyId: ctx.company.id }).returning({ id: schema.partners.id });
        partnerId = row.id;
      }
      // An opening balance is an invoice (or a supplier's bill) dated that day, so it is in the ageing and can be paid like any other.
      if (opening > 0 && !current?.openingDocId) {
        const docKind = kind === "supplier" ? "bill" : "invoice";
        const [equity] = await tx.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), eq(schema.accounts.code, "3900")));
        const equityId = equity?.id ?? (await tx.insert(schema.accounts).values({ companyId: ctx.company.id, code: "3900", type: "equity", nameEn: "Opening balance equity", nameFr: "Capitaux d'ouverture" }).returning({ id: schema.accounts.id }))[0].id;
        const docId = await saveDocDraft(tx, docKind, ctx.company.id, ctx.user.id, undefined, {
          partnerId, date: openingDate, dueDate: addDays(openingDate, terms || 30), notes: t("pt_opening_balance"), projectId: null,
        }, [{ description: t("pt_opening_balance"), quantity: 1, unitPrice: opening, vatApplies: false, accountId: equityId, projectId: null }], 0);
        await postDoc(tx, docKind, ctx.company.id, ctx.user.id, docId, ctx.company.settings);
        await tx.update(schema.partners).set({ openingBalance: opening, openingDate, openingDocId: docId }).where(eq(schema.partners.id, partnerId));
      }
      await audit(tx, ctx.company.id, ctx.user.id, id ? "update" : "create", "partner", id || values.name, opening ? { opening, openingDate } : undefined);
    });
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
