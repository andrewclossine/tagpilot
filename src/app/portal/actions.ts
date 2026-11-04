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
import { optionalUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";

/** Sends or replaces the supplier's own bid or quotation. The deadline is checked on the server, against its clock. */
export async function submitBid(fd: FormData) {
  const ctx = await requireSupplier();
  const tenderId = str(fd, "tenderId"), back = `/portal/tenders/${tenderId}`;
  try {
    if (ctx.locked) throw new UserError("err_not_bidding");
    const amount = parseAmount(fd.get("amount"));
    if (!(amount > 0)) throw new UserError("err_amount");
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [tender] = await tx.select().from(schema.tenders).where(and(eq(schema.tenders.id, tenderId), eq(schema.tenders.companyId, ctx.company.id))).for("update");
      if (!tender || !(await supplierCanSee(tx, tender, ctx.partnerId))) throw new UserError("err_not_found");
      if (!biddingOpen(tender)) throw new UserError("err_not_bidding");
      const note = str(fd, "note");
      await tx.insert(schema.bids).values({ companyId: ctx.company.id, tenderId, partnerId: ctx.partnerId, amount, note, attachmentId, submittedBy: ctx.user.id })
        .onConflictDoUpdate({
          target: [schema.bids.tenderId, schema.bids.partnerId],
          set: { amount, note, submittedBy: ctx.user.id, submittedAt: new Date(), ...(attachmentId ? { attachmentId } : {}) },
        });
      // While bids are sealed the audit trail says neither who bid nor how much; the bid itself records who sent it.
      await audit(tx, ctx.company.id, null, "submit", "bid", tender.number);
    });
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(`${back}?sent=1`);
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
