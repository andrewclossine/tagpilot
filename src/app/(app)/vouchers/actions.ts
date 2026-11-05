"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx, requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, round2, str, today } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import {
  assertBudgetLine, cancelVoucher, DOC_TYPES, markVoucherPaid, NEXT_STEP, nextFundRequestNumber, payVoucher, returnVoucher, signVoucher, submitVoucher,
} from "@/lib/programs";
import { optionalUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";
import type { DocStatusValue } from "@/db/schema";

const refresh = (id: string) => { revalidatePath("/vouchers"); revalidatePath(`/vouchers/${id}`); };

/** Saves the staff member's request as a draft, and prepares it for review when asked. */
export async function saveVoucher(fd: FormData) {
  const ctx = await requireWrite("vouchers");
  const id = str(fd, "id"), back = id ? `/vouchers/${id}?edit=1` : "/vouchers/new";
  const submit = str(fd, "intent") === "submit";
  let savedId = id;
  try {
    const description = str(fd, "description"), date = str(fd, "date") || today();
    if (!description || !isIsoDate(date)) throw new UserError("err_required");
    const items = fd.getAll("lineItem").map(String), amounts = fd.getAll("lineAmount"), notes = fd.getAll("lineNote").map(String);
    const lines = items.map((budgetItemId, i) => ({ budgetItemId, amount: parseAmount(amounts[i]), description: (notes[i] ?? "").trim() })).filter((l) => isUuid(l.budgetItemId));
    if (!lines.length) throw new UserError("err_required");
    if (lines.some((l) => !(l.amount > 0))) throw new UserError("err_amount");
    const amount = round2(lines.reduce((s, l) => s + l.amount, 0));
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    const db = await getDb();
    // A request linked to a contract pays that contract's supplier.
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
      const budgetRows = [];
      for (const l of lines) budgetRows.push(await assertBudgetLine(tx, ctx.company.id, l.budgetItemId));
      const projectId = budgetRows[0].projectId;
      if (budgetRows.some((b) => b.projectId !== projectId)) throw new UserError("err_voucher_one_project");
      const values = { date, projectId, budgetItemId: lines[0].budgetItemId, contractId, partnerId, payee, amount, description };
      let vid = id;
      if (vid) {
        const [old] = await tx.select().from(schema.paymentVouchers).where(and(eq(schema.paymentVouchers.id, vid), eq(schema.paymentVouchers.companyId, ctx.company.id))).for("update");
        if (!old) throw new UserError("err_not_found");
        if (old.status !== "draft") throw new UserError("err_voucher_state");
        if (old.requestedBy !== ctx.user.id) throw new UserError("err_voucher_not_yours");
        await tx.update(schema.paymentVouchers).set({ ...values, attachmentId: attachmentId ?? old.attachmentId }).where(eq(schema.paymentVouchers.id, vid));
        await tx.delete(schema.voucherLines).where(eq(schema.voucherLines.voucherId, vid));
      } else {
        const number = await nextFundRequestNumber(tx, ctx.company.id, date);
        const [row] = await tx.insert(schema.paymentVouchers).values({ ...values, companyId: ctx.company.id, number, requestedBy: ctx.user.id, attachmentId }).returning({ id: schema.paymentVouchers.id });
        vid = row.id;
        await audit(tx, ctx.company.id, ctx.user.id, "create", "payment_voucher", number, { amount });
      }
      await tx.insert(schema.voucherLines).values(lines.map((l, i) => ({ ...l, companyId: ctx.company.id, voucherId: vid, lineNo: i + 1 })));
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
    await audit(db, ctx.company.id, ctx.user.id, "delete", "payment_voucher", v.number, { amount: v.amount });
  } catch (e) { fail(e, `/vouchers/${id}`); }
  revalidatePath("/vouchers");
  redirect("/vouchers");
}

/** Signs the next step, sends the request back, or cancels it. Who may do it depends on the step it has reached. */
export async function decide(fd: FormData) {
  const ctx = await getCtx();
  const id = str(fd, "id"), decision = str(fd, "decision"), note = str(fd, "note");
  try {
    const db = await getDb();
    const [v] = await db.select().from(schema.paymentVouchers).where(and(eq(schema.paymentVouchers.id, id), eq(schema.paymentVouchers.companyId, ctx.company.id)));
    if (!v) throw new UserError("err_not_found");
    const step = NEXT_STEP[v.status];
    if (!step) throw new UserError("err_voucher_state");
    if (!ctx.can(step.area, "write")) throw new UserError("err_voucher_no_right");
    if (decision !== "sign" && !note) throw new UserError("err_reason_required");
    await db.transaction((tx) => decision === "sign" ? signVoucher(tx, ctx.company.id, ctx.user.id, ctx.isAdmin, id, note)
      : decision === "return" ? returnVoucher(tx, ctx.company.id, ctx.user.id, id, note)
        : cancelVoucher(tx, ctx.company.id, ctx.user.id, id, note));
  } catch (e) { fail(e, `/vouchers/${id}`); }
  refresh(id);
  redirect(`/vouchers/${id}`);
}

export async function pay(fd: FormData) {
  const ctx = await requireWrite("voucher_pay");
  const id = str(fd, "id"), date = str(fd, "date") || today(), reference = str(fd, "reference");
  try {
    if (!isIsoDate(date)) throw new UserError("err_required");
    const db = await getDb();
    await db.transaction((tx) => ctx.has("accounting")
      ? payVoucher(tx, ctx.company.id, ctx.user.id, id, { date, moneyAccountId: str(fd, "moneyAccountId"), expenseAccountId: str(fd, "expenseAccountId"), reference }).then(() => undefined)
      : markVoucherPaid(tx, ctx.company.id, ctx.user.id, id, reference));
  } catch (e) { fail(e, `/vouchers/${id}`); }
  refresh(id);
  revalidatePath("/journal");
  redirect(`/vouchers/${id}`);
}

/** Keeps the checklist of supporting documents: each is submitted, pending or not needed, with its file if there is one. */
export async function saveDocuments(fd: FormData) {
  const ctx = await requireWrite("vouchers");
  const id = str(fd, "id"), back = `/vouchers/${id}`;
  try {
    const db = await getDb();
    const [v] = await db.select().from(schema.paymentVouchers).where(and(eq(schema.paymentVouchers.id, id), eq(schema.paymentVouchers.companyId, ctx.company.id)));
    if (!v) throw new UserError("err_not_found");
    if (ctx.role === "staff" && v.requestedBy !== ctx.user.id) throw new UserError("err_voucher_not_yours");
    for (const docType of DOC_TYPES) {
      const raw = str(fd, `doc_${docType}`);
      const status: DocStatusValue = raw === "submitted" || raw === "pending" ? raw : "na";
      const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd, `file_${docType}`);
      await db.insert(schema.voucherDocuments).values({ voucherId: id, docType, status: attachmentId ? "submitted" : status, attachmentId })
        .onConflictDoUpdate({
          target: [schema.voucherDocuments.voucherId, schema.voucherDocuments.docType],
          set: { status: attachmentId ? "submitted" : status, ...(attachmentId ? { attachmentId } : {}) },
        });
    }
    await audit(db, ctx.company.id, ctx.user.id, "update", "voucher_documents", v.number);
  } catch (e) { fail(e, back); }
  refresh(id);
  redirect(`${back}?saved=1`);
}
