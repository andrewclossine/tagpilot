"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { computeTotals, saveDocDraft } from "@/lib/documents";
import { isIsoDate, isUuid, str, today } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { nextNumber } from "@/lib/numbering";
import { parseDocLines } from "@/lib/parse";
import { audit } from "@/lib/audit";

const BASE = "/sales/proformas";
const vatOf = (c: { vatRegistered: boolean; vatRate: number }) => (c.vatRegistered ? c.vatRate : 0);

/** Saves a proforma. It books nothing, so it can change freely until it becomes an invoice. */
export async function saveProforma(fd: FormData) {
  const ctx = await requireWrite("sales");
  const id = str(fd, "id"), back = id ? `${BASE}/${id}?edit=1` : `${BASE}/new`;
  let savedId = id;
  try {
    const partnerId = str(fd, "partnerId"), date = str(fd, "date"), validUntil = str(fd, "validUntil");
    if (!isUuid(partnerId) || !isIsoDate(date) || !isIsoDate(validUntil)) throw new UserError("err_required");
    const parsed = parseDocLines(fd);
    const totals = computeTotals(parsed, vatOf(ctx.company));
    const db = await getDb();
    const [partner] = await db.select({ id: schema.partners.id }).from(schema.partners).where(and(eq(schema.partners.id, partnerId), eq(schema.partners.companyId, ctx.company.id)));
    if (!partner) throw new UserError("err_not_found");
    const values = { partnerId, date, validUntil, notes: str(fd, "notes"), projectId: str(fd, "projectId") || null, subtotal: totals.subtotal, vat: totals.vat, total: totals.total };
    savedId = await db.transaction(async (tx) => {
      let pid = id;
      if (pid) {
        const [old] = await tx.select().from(schema.proformas).where(and(eq(schema.proformas.id, pid), eq(schema.proformas.companyId, ctx.company.id))).for("update");
        if (!old) throw new UserError("err_not_found");
        if (old.status !== "open") throw new UserError("err_voucher_state");
        await tx.update(schema.proformas).set(values).where(eq(schema.proformas.id, pid));
        await tx.delete(schema.proformaLines).where(eq(schema.proformaLines.proformaId, pid));
      } else {
        const number = await nextNumber(tx, schema.proformas, { number: schema.proformas.number, companyId: schema.proformas.companyId }, ctx.company.id, "PRO");
        const [row] = await tx.insert(schema.proformas).values({ ...values, companyId: ctx.company.id, number }).returning({ id: schema.proformas.id });
        pid = row.id;
        await audit(tx, ctx.company.id, ctx.user.id, "create", "proforma", number, { total: totals.total });
      }
      await tx.insert(schema.proformaLines).values(totals.lines.map((l, i) => ({
        proformaId: pid, lineNo: i + 1, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, vatApplies: l.vatApplies,
        accountId: l.accountId, projectId: l.projectId || values.projectId, itemId: l.itemId || null, amount: l.amount,
      })));
      return pid;
    });
  } catch (e) { fail(e, back); }
  revalidatePath(BASE);
  redirect(`${BASE}/${savedId}`);
}

/** The customer agreed: the proforma becomes a draft invoice, to check and issue. */
export async function convertProforma(fd: FormData) {
  const ctx = await requireWrite("sales");
  const id = str(fd, "id");
  let invoiceId = "";
  try {
    const db = await getDb();
    invoiceId = await db.transaction(async (tx) => {
      const [p] = await tx.select().from(schema.proformas).where(and(eq(schema.proformas.id, id), eq(schema.proformas.companyId, ctx.company.id))).for("update");
      if (!p) throw new UserError("err_not_found");
      if (p.status !== "open") throw new UserError("err_voucher_state");
      const lines = await tx.select().from(schema.proformaLines).where(eq(schema.proformaLines.proformaId, id)).orderBy(schema.proformaLines.lineNo);
      const date = today();
      const inv = await saveDocDraft(tx, "invoice", ctx.company.id, ctx.user.id, undefined, {
        partnerId: p.partnerId, date, dueDate: p.validUntil > date ? p.validUntil : date, notes: [p.number, p.notes].filter(Boolean).join(" · "), projectId: p.projectId,
      }, lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, vatApplies: l.vatApplies, accountId: l.accountId, projectId: l.projectId, itemId: l.itemId })), vatOf(ctx.company));
      await tx.update(schema.proformas).set({ status: "converted", invoiceId: inv }).where(eq(schema.proformas.id, id));
      await audit(tx, ctx.company.id, ctx.user.id, "convert", "proforma", p.number, { invoice: inv });
      return inv;
    });
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  redirect(`/sales/invoices/${invoiceId}`);
}

export async function cancelProforma(fd: FormData) {
  const ctx = await requireWrite("sales");
  const id = str(fd, "id");
  try {
    const db = await getDb();
    const [p] = await db.select().from(schema.proformas).where(and(eq(schema.proformas.id, id), eq(schema.proformas.companyId, ctx.company.id)));
    if (!p) throw new UserError("err_not_found");
    if (p.status !== "open") throw new UserError("err_voucher_state");
    await db.update(schema.proformas).set({ status: "cancelled" }).where(eq(schema.proformas.id, id));
    await audit(db, ctx.company.id, ctx.user.id, "cancel", "proforma", p.number);
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}`);
}
