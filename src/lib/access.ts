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
    if (isSealed(bid.t) || bid.t.companyId !== ctx.company.id) return false;
    if (ctx.can("procurement")) return true;
    const [member] = await db.select().from(schema.tenderCommittee).where(and(eq(schema.tenderCommittee.tenderId, bid.t.id), eq(schema.tenderCommittee.userId, ctx.user.id)));
    return !!member || bid.t.awardApproverId === ctx.user.id;
  }

  const [form] = await db.select({ tenderId: schema.tenderForms.tenderId }).from(schema.tenderForms).where(eq(schema.tenderForms.attachmentId, attachmentId));
  const [tender] = await db.select().from(schema.tenders).where(form ? eq(schema.tenders.id, form.tenderId) : eq(schema.tenders.attachmentId, attachmentId));
  if (tender) return supplier ? tender.status !== "draft" && supplierCanSee(db, tender, supplier) : ctx.can("procurement") && tender.companyId === ctx.company.id;

  const [stage] = await db.select().from(schema.tenderStages).where(eq(schema.tenderStages.attachmentId, attachmentId));
  if (stage) {
    if (!supplier) return ctx.can("procurement");
    const [mine] = await db.select().from(schema.bids).where(and(eq(schema.bids.tenderId, stage.tenderId), eq(schema.bids.partnerId, supplier)));
    return supplierSeesStage(stage.stage as TenderStage, mine);
  }

  const [bill] = await db.select().from(schema.supplierBills).where(eq(schema.supplierBills.attachmentId, attachmentId));
  if (bill) return supplier ? bill.partnerId === supplier : ctx.can("purchases") || ctx.can("journal") || ctx.can("contracts");

  const [g] = await db.select({ contractId: schema.performanceGuarantees.contractId }).from(schema.performanceGuarantees).where(eq(schema.performanceGuarantees.attachmentId, attachmentId));
  const [a] = await db.select({ contractId: schema.contractAmendments.contractId }).from(schema.contractAmendments).where(eq(schema.contractAmendments.attachmentId, attachmentId));
  const [contract] = await db.select().from(schema.contracts).where(or(
    eq(schema.contracts.attachmentId, attachmentId),
    ...(g ? [eq(schema.contracts.id, g.contractId)] : []),
    ...(a ? [eq(schema.contracts.id, a.contractId)] : []),
  ));
  if (contract) return supplier ? contract.partnerId === supplier : ctx.can("contracts");

  const [voucher] = await db.select().from(schema.paymentVouchers).where(eq(schema.paymentVouchers.attachmentId, attachmentId));
  const [vdoc] = await db.select({ voucherId: schema.voucherDocuments.voucherId }).from(schema.voucherDocuments).where(eq(schema.voucherDocuments.attachmentId, attachmentId));
  if (vdoc && !supplier) {
    const [owner] = await db.select().from(schema.paymentVouchers).where(eq(schema.paymentVouchers.id, vdoc.voucherId));
    return !!owner && canSeeVoucher(ctx, owner);
  }
  const [done] = await db.select({ id: schema.achievements.id }).from(schema.achievements).where(eq(schema.achievements.attachmentId, attachmentId));
  if (done) return !supplier && ctx.can("achievements");

  // A paid voucher's document is also the support of its journal entry.
  if (voucher && !supplier) return canSeeVoucher(ctx, voucher) || ctx.can("journal");

  // A file from a supplier that nothing points to any more, such as a bid they replaced, stays closed.
  const uploaders = await db.select({ role: schema.memberships.role, companyId: schema.memberships.companyId }).from(schema.attachments)
    .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.attachments.uploadedBy))
    .where(eq(schema.attachments.id, attachmentId));
  if (uploaders.some((u) => u.role === "supplier" || u.companyId !== ctx.company.id)) return false;

  // Everything else is a supporting document of the books.
  return !supplier && ctx.role !== "staff" && ctx.role !== "procurement" && ctx.has("accounting");
}

/**
 * A file held by another organisation, for a supplier organisation that bids to it: the document of an advert,
 * its own bid, the notices it may read, and what belongs to a contract it won. Other bidders' files stay closed.
 */
export async function canReadAsBidder(db: Db, ctx: Ctx, attachmentId: string): Promise<boolean> {
  if (!ctx.can("bidding")) return false;
  const partners = await db.select({ id: schema.partners.id }).from(schema.partners).where(eq(schema.partners.linkedCompanyId, ctx.company.id));
  const mine = (partnerId: string) => partners.some((p) => p.id === partnerId);

  const [bid] = await db.select().from(schema.bids).where(eq(schema.bids.attachmentId, attachmentId));
  if (bid) return mine(bid.partnerId);

  const [form] = await db.select({ tenderId: schema.tenderForms.tenderId }).from(schema.tenderForms).where(eq(schema.tenderForms.attachmentId, attachmentId));
  const [tender] = await db.select().from(schema.tenders).where(form ? eq(schema.tenders.id, form.tenderId) : eq(schema.tenders.attachmentId, attachmentId));
  if (tender) {
    if (tender.openToAll && tender.status !== "draft" && tender.status !== "cancelled") return true;
    const bids = await db.select().from(schema.bids).where(eq(schema.bids.tenderId, tender.id));
    return tender.status !== "draft" && bids.some((b) => mine(b.partnerId));
  }

  const [stage] = await db.select().from(schema.tenderStages).where(eq(schema.tenderStages.attachmentId, attachmentId));
  if (stage) {
    const bids = await db.select().from(schema.bids).where(eq(schema.bids.tenderId, stage.tenderId));
    return supplierSeesStage(stage.stage as TenderStage, bids.find((b) => mine(b.partnerId)));
  }

  const [bill] = await db.select().from(schema.supplierBills).where(eq(schema.supplierBills.attachmentId, attachmentId));
  if (bill) return mine(bill.partnerId);

  const [g] = await db.select({ contractId: schema.performanceGuarantees.contractId }).from(schema.performanceGuarantees).where(eq(schema.performanceGuarantees.attachmentId, attachmentId));
  const [a] = await db.select({ contractId: schema.contractAmendments.contractId }).from(schema.contractAmendments).where(eq(schema.contractAmendments.attachmentId, attachmentId));
  const [contract] = await db.select().from(schema.contracts).where(or(
    eq(schema.contracts.attachmentId, attachmentId),
    ...(g ? [eq(schema.contracts.id, g.contractId)] : []),
    ...(a ? [eq(schema.contracts.id, a.contractId)] : []),
  ));
  return !!contract && mine(contract.partnerId);
}

/** Staff see their own requests; those who approve, pay or review see them all. */
export function canSeeVoucher(ctx: Ctx, v: { requestedBy: string }) {
  if (!ctx.can("vouchers")) return false;
  return ctx.role !== "staff" || v.requestedBy === ctx.user.id;
}
