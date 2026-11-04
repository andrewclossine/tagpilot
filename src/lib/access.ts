import "server-only";
import { and, eq, or } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { TenderStage } from "@/db/schema";
import type { Ctx } from "./auth";
import { isSealed, supplierCanSee, supplierSeesStage } from "./procurement";

/**
 * Whether this person may open this file. Supplier, staff and procurement accounts only get files linked to their
 * own work. A file attached to a bid stays closed to the whole organisation until the bids are opened.
 */
export async function canReadAttachment(db: Db, ctx: Ctx, attachmentId: string): Promise<boolean> {
  if (ctx.company.logoAttachmentId === attachmentId) return true;
  const supplier = ctx.role === "supplier" ? ctx.partnerId : null;
  if (ctx.role === "supplier" && !supplier) return false;

  const [bid] = await db.select({ b: schema.bids, t: schema.tenders }).from(schema.bids).innerJoin(schema.tenders, eq(schema.tenders.id, schema.bids.tenderId))
    .where(eq(schema.bids.attachmentId, attachmentId));
  if (bid) {
    if (supplier) return bid.b.partnerId === supplier;
    return ctx.can("procurement") && !isSealed(bid.t);
  }

  const [tender] = await db.select().from(schema.tenders).where(eq(schema.tenders.attachmentId, attachmentId));
  if (tender) return supplier ? supplierCanSee(db, tender, supplier) : ctx.can("procurement");

  const [stage] = await db.select().from(schema.tenderStages).where(eq(schema.tenderStages.attachmentId, attachmentId));
  if (stage) {
    if (!supplier) return ctx.can("procurement");
    const [mine] = await db.select().from(schema.bids).where(and(eq(schema.bids.tenderId, stage.tenderId), eq(schema.bids.partnerId, supplier)));
    return supplierSeesStage(stage.stage as TenderStage, mine);
  }

  const [g] = await db.select({ contractId: schema.performanceGuarantees.contractId }).from(schema.performanceGuarantees).where(eq(schema.performanceGuarantees.attachmentId, attachmentId));
  const [a] = await db.select({ contractId: schema.contractAmendments.contractId }).from(schema.contractAmendments).where(eq(schema.contractAmendments.attachmentId, attachmentId));
  const [contract] = await db.select().from(schema.contracts).where(or(
    eq(schema.contracts.attachmentId, attachmentId),
    ...(g ? [eq(schema.contracts.id, g.contractId)] : []),
    ...(a ? [eq(schema.contracts.id, a.contractId)] : []),
  ));
  if (contract) return supplier ? contract.partnerId === supplier : ctx.can("contracts");

  const [voucher] = await db.select().from(schema.paymentVouchers).where(eq(schema.paymentVouchers.attachmentId, attachmentId));
  if (voucher && !supplier) return canSeeVoucher(ctx, voucher);

  // Everything else is a supporting document of the books.
  return !supplier && ctx.role !== "staff" && ctx.role !== "procurement";
}

/** Staff see their own requests; those who approve, pay or review see them all. */
export function canSeeVoucher(ctx: Ctx, v: { requestedBy: string }) {
  if (!ctx.can("vouchers")) return false;
  return ctx.role !== "staff" || v.requestedBy === ctx.user.id;
}
