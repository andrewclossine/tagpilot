"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSupplier } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, parseAmount, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { biddingOpen, requestAmendment, supplierCanSee } from "@/lib/procurement";
import { submitSupplierBill } from "@/lib/purchasing";
import { optionalUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";
import { itemsOf, readBidPrices, saveBidPrices } from "@/lib/boq";

/** Sends or replaces the supplier's own bid or quotation. The deadline is checked on the server, against its clock. */
export async function submitBid(fd: FormData) {
  const ctx = await requireSupplier();
  const tenderId = str(fd, "tenderId"), back = `/portal/tenders/${tenderId}`;
  try {
    if (ctx.locked) throw new UserError("err_not_bidding");
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [tender] = await tx.select().from(schema.tenders).where(and(eq(schema.tenders.id, tenderId), eq(schema.tenders.companyId, ctx.company.id))).for("update");
      if (!tender || !(await supplierCanSee(tx, tender, ctx.partnerId))) throw new UserError("err_not_found");
      if (!biddingOpen(tender)) throw new UserError("err_not_bidding");
      const note = str(fd, "note");
      const items = await itemsOf(tx, tenderId);
      const priced = items.length ? readBidPrices(fd, items) : null;
      const amount = priced ? priced.amount : parseAmount(fd.get("amount"));
      if (!(amount > 0)) throw new UserError("err_amount");
      const [bid] = await tx.insert(schema.bids).values({ companyId: ctx.company.id, tenderId, partnerId: ctx.partnerId, amount, note, attachmentId, submittedBy: ctx.user.id })
        .onConflictDoUpdate({
          target: [schema.bids.tenderId, schema.bids.partnerId],
          set: { amount, note, submittedBy: ctx.user.id, submittedAt: new Date(), ...(attachmentId ? { attachmentId } : {}) },
        }).returning({ id: schema.bids.id });
      if (priced) await saveBidPrices(tx, bid.id, priced.prices);
      // While bids are sealed the audit trail says neither who bid nor how much; the bid itself records who sent it.
      await audit(tx, ctx.company.id, null, "submit", "bid", tender.number);
    });
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(`${back}?sent=1`);
}

/** The supplier sends a bill against its own contract; the organisation accepts it into its books. */
export async function sendPortalBill(fd: FormData) {
  const ctx = await requireSupplier();
  const contractId = str(fd, "contractId"), back = `/portal/contracts/${contractId}`;
  try {
    if (ctx.locked) throw new UserError("err_contract_closed");
    const date = str(fd, "date"), dueDate = str(fd, "dueDate");
    if (!isIsoDate(date) || !isIsoDate(dueDate)) throw new UserError("err_required");
    const db = await getDb();
    const [c] = await db.select().from(schema.contracts).where(and(eq(schema.contracts.id, contractId), eq(schema.contracts.companyId, ctx.company.id), eq(schema.contracts.partnerId, ctx.partnerId)));
    if (!c) throw new UserError("err_not_found");
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    await db.transaction((tx) => submitSupplierBill(tx, c, ctx.user.id, { reference: str(fd, "reference"), date, dueDate, amount: parseAmount(fd.get("amount")), description: str(fd, "description"), attachmentId }));
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(back);
}

/** The supplier asks for a change to their own contract; the organisation decides. */
export async function supplierAmendment(fd: FormData) {
  const ctx = await requireSupplier();
  const contractId = str(fd, "contractId"), back = `/portal/contracts/${contractId}`;
  try {
    if (ctx.locked) throw new UserError("err_contract_closed");
    const newEndDate = str(fd, "newEndDate");
    if (newEndDate && !isIsoDate(newEndDate)) throw new UserError("err_required");
    const db = await getDb();
    const [c] = await db.select().from(schema.contracts).where(and(eq(schema.contracts.id, contractId), eq(schema.contracts.companyId, ctx.company.id), eq(schema.contracts.partnerId, ctx.partnerId)));
    if (!c) throw new UserError("err_not_found");
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    await db.transaction((tx) => requestAmendment(tx, ctx.company.id, ctx.user.id, contractId, true, {
      reason: str(fd, "reason"), amountChange: parseAmount(fd.get("amountChange")), newEndDate: newEndDate || null, attachmentId,
    }));
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(back);
}
