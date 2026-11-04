"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, str, today } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { nextNumber } from "@/lib/numbering";
import { assertBudgetLine, decideVoucher, payVoucher, submitVoucher } from "@/lib/programs";
import { optionalUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";

const refresh = (id: string) => { revalidatePath("/vouchers"); revalidatePath(`/vouchers/${id}`); };

/** Saves the staff member's request as a draft, and sends it for approval when asked. */
export async function saveVoucher(fd: FormData) {
  const ctx = await requireWrite("vouchers");
  const id = str(fd, "id"), back = id ? `/vouchers/${id}?edit=1` : "/vouchers/new";
  const submit = str(fd, "intent") === "submit";
  let savedId = id;
  try {
    const budgetItemId = str(fd, "budgetItemId"), description = str(fd, "description"), date = str(fd, "date") || today();
    const amount = parseAmount(fd.get("amount"));
    if (!isUuid(budgetItemId) || !description) throw new UserError("err_required");
    if (!(amount > 0)) throw new UserError("err_amount");
    if (!isIsoDate(date)) throw new UserError("err_required");
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    const db = await getDb();
    // A voucher linked to a contract pays that contract's supplier.
    const contractId = ctx.can("contracts") && isUuid(str(fd, "contractId")) ? str(fd, "contractId") : null;
    let partnerId = isUuid(str(fd, "partnerId")) ? str(fd, "partnerId") : null;
    if (contractId) {
      const [c] = await db.select().from(schema.contracts).where(and(eq(schema.contracts.id, contractId), eq(schema.contracts.companyId, ctx.company.id)));
      if (!c) throw new UserError("err_not_found");
      partnerId = c.partnerId;
    }
    let payee = str(fd, "payee");
    if (partnerId) {
      const [p] = await db.select().from(schema.partners).where(and(eq(schema.partners.id, partnerId), eq(schema.partners.companyId, ctx.company.id)));
      if (!p) throw new UserError("err_not_found");
      payee = payee || p.name;
    }
    savedId = await db.transaction(async (tx) => {
      const line = await assertBudgetLine(tx, ctx.company.id, budgetItemId);
      const values = { date, projectId: line.projectId, budgetItemId, contractId, partnerId, payee, amount, description };
      let vid = id;
      if (vid) {
        const [old] = await tx.select().from(schema.paymentVouchers).where(and(eq(schema.paymentVouchers.id, vid), eq(schema.paymentVouchers.companyId, ctx.company.id))).for("update");
        if (!old) throw new UserError("err_not_found");
        if (old.status !== "draft") throw new UserError("err_voucher_state");
        if (old.requestedBy !== ctx.user.id) throw new UserError("err_voucher_not_yours");
        await tx.update(schema.paymentVouchers).set({ ...values, attachmentId: attachmentId ?? old.attachmentId }).where(eq(schema.paymentVouchers.id, vid));
      } else {
        const number = await nextNumber(tx, schema.paymentVouchers, { number: schema.paymentVouchers.number, companyId: schema.paymentVouchers.companyId }, ctx.company.id, "PV");
        const [row] = await tx.insert(schema.paymentVouchers).values({ ...values, companyId: ctx.company.id, number, requestedBy: ctx.user.id, attachmentId }).returning({ id: schema.paymentVouchers.id });
        vid = row.id;
        await audit(tx, ctx.company.id, ctx.user.id, "create", "payment_voucher", number, { amount });
      }
      if (submit) await submitVoucher(tx, ctx.company.id, ctx.user.id, vid);
      return vid;
    });
  } catch (e) { fail(e, back); }
  refresh(savedId);
  redirect(`/vouchers/${savedId}`);
}

export async function submitDraft(fd: FormData) {
  const ctx = await requireWrite("vouchers");
  const id = str(fd, "id");
  try {
    const db = await getDb();
    await db.transaction((tx) => submitVoucher(tx, ctx.company.id, ctx.user.id, id));
  } catch (e) { fail(e, `/vouchers/${id}`); }
  refresh(id);
  redirect(`/vouchers/${id}`);
}

export async function deleteVoucher(fd: FormData) {
  const ctx = await requireWrite("vouchers");
  const id = str(fd, "id");
  try {
    const db = await getDb();
    const [v] = await db.select().from(schema.paymentVouchers).where(and(eq(schema.paymentVouchers.id, id), eq(schema.paymentVouchers.companyId, ctx.company.id)));
    if (!v) throw new UserError("err_not_found");
    if (v.status !== "draft") throw new UserError("err_voucher_state");
    if (v.requestedBy !== ctx.user.id) throw new UserError("err_voucher_not_yours");
    await db.delete(schema.paymentVouchers).where(eq(schema.paymentVouchers.id, id));
    await audit(db, ctx.company.id, ctx.user.id, "delete", "payment_voucher", v.number);
  } catch (e) { fail(e, `/vouchers/${id}`); }
  revalidatePath("/vouchers");
  redirect("/vouchers");
}

export async function decide(fd: FormData) {
  const ctx = await requireWrite("voucher_approve");
  const id = str(fd, "id"), approve = str(fd, "decision") === "approve", note = str(fd, "note");
  try {
    if (!approve && !note) throw new UserError("err_reason_required");
    const db = await getDb();
    await db.transaction((tx) => decideVoucher(tx, ctx.company.id, ctx.user.id, ctx.isAdmin, id, approve, note));
  } catch (e) { fail(e, `/vouchers/${id}`); }
  refresh(id);
  redirect(`/vouchers/${id}`);
}

export async function pay(fd: FormData) {
  const ctx = await requireWrite("voucher_pay");
  const id = str(fd, "id"), date = str(fd, "date") || today();
  try {
    if (!isIsoDate(date)) throw new UserError("err_required");
    const db = await getDb();
    await db.transaction((tx) => payVoucher(tx, ctx.company.id, ctx.user.id, id, { date, moneyAccountId: str(fd, "moneyAccountId"), expenseAccountId: str(fd, "expenseAccountId") }));
  } catch (e) { fail(e, `/vouchers/${id}`); }
  refresh(id);
  revalidatePath("/journal");
  redirect(`/vouchers/${id}`);
}
