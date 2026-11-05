"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { myPartners, placeBid } from "@/lib/bidding";
import { biddingOpen, requestAmendment } from "@/lib/procurement";
import { submitSupplierBill } from "@/lib/purchasing";
import { optionalUpload } from "@/lib/upload";

/** Sends or replaces this organisation's bid on an advert. The deadline is checked on the server, against its clock. */
export async function submitAdvertBid(fd: FormData) {
  const ctx = await requireWrite("bidding");
  const tenderId = str(fd, "tenderId"), back = `/adverts/${tenderId}`;
  try {
    if (!isUuid(tenderId)) throw new UserError("err_not_found");
    const amount = parseAmount(fd.get("amount"));
    if (!(amount > 0)) throw new UserError("err_amount");
    const db = await getDb();
    const [tender] = await db.select().from(schema.tenders).where(eq(schema.tenders.id, tenderId));
    if (!tender || !tender.openToAll) throw new UserError("err_not_found");
    if (!biddingOpen(tender)) throw new UserError("err_not_bidding");
    // The file belongs with the tender, in the buyer's storage, and the sealed-bid rules decide who may open it.
    const attachmentId = await optionalUpload(tender.companyId, ctx.user.id, fd);
    await db.transaction((tx) => placeBid(tx, ctx, tenderId, { amount, note: str(fd, "note"), attachmentId }));
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  revalidatePath("/my-bids");
  redirect(`${back}?sent=1`);
}

/** Sends a bill against a contract this organisation won; the buyer accepts it into its books. */
export async function sendContractBill(fd: FormData) {
  const ctx = await requireWrite("bidding");
  const contractId = str(fd, "contractId"), back = `/my-contracts/${contractId}`;
  try {
    if (!isUuid(contractId)) throw new UserError("err_not_found");
    const date = str(fd, "date"), dueDate = str(fd, "dueDate");
    if (!isIsoDate(date) || !isIsoDate(dueDate)) throw new UserError("err_required");
    const db = await getDb();
    const partners = await myPartners(db, ctx.company.id);
    const [c] = partners.length ? await db.select().from(schema.contracts).where(and(eq(schema.contracts.id, contractId), inArray(schema.contracts.partnerId, partners.map((p) => p.id)))) : [];
    if (!c) throw new UserError("err_not_found");
    const attachmentId = await optionalUpload(c.companyId, ctx.user.id, fd);
    await db.transaction((tx) => submitSupplierBill(tx, c, ctx.user.id, { reference: str(fd, "reference"), date, dueDate, amount: parseAmount(fd.get("amount")), description: str(fd, "description"), attachmentId }));
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(back);
}

/** Asks for a change to a contract this organisation won; the buyer decides. */
export async function requestContractChange(fd: FormData) {
  const ctx = await requireWrite("bidding");
  const contractId = str(fd, "contractId"), back = `/my-contracts/${contractId}`;
  try {
    if (!isUuid(contractId)) throw new UserError("err_not_found");
    const newEndDate = str(fd, "newEndDate");
    if (newEndDate && !isIsoDate(newEndDate)) throw new UserError("err_required");
    const db = await getDb();
    const partners = await myPartners(db, ctx.company.id);
    const [c] = partners.length ? await db.select().from(schema.contracts).where(and(eq(schema.contracts.id, contractId), inArray(schema.contracts.partnerId, partners.map((p) => p.id)))) : [];
    if (!c) throw new UserError("err_not_found");
    const attachmentId = await optionalUpload(c.companyId, ctx.user.id, fd);
    await db.transaction((tx) => requestAmendment(tx, c.companyId, ctx.user.id, contractId, true, {
      reason: str(fd, "reason"), amountChange: parseAmount(fd.get("amountChange")), newEndDate: newEndDate || null, attachmentId,
    }));
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(back);
}
