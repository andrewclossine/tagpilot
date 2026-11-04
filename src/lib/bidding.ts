import "server-only";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import type { Ctx } from "./auth";
import { UserError } from "./ledger";
import { biddingOpen } from "./procurement";
import { audit } from "./audit";

/** Tenders organisations have advertised to every supplier, still open for bids. */
export async function openAdverts(db: Db) {
  return db.select({ t: schema.tenders, buyer: schema.companies.name, country: schema.companies.country }).from(schema.tenders)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.tenders.companyId))
    .where(and(eq(schema.tenders.openToAll, true), eq(schema.tenders.status, "published"), gt(schema.tenders.deadline, new Date())))
    .orderBy(schema.tenders.deadline).limit(500);
}

/** This supplier organisation's records in the books of the organisations it has dealt with. */
export async function myPartners(db: Db | Tx, companyId: string) {
  return db.select().from(schema.partners).where(eq(schema.partners.linkedCompanyId, companyId));
}

/** Every bid of this supplier organisation, newest first. */
export async function myBids(db: Db, companyId: string) {
  const partners = await myPartners(db, companyId);
  if (!partners.length) return [];
  return db.select({ b: schema.bids, t: schema.tenders, buyer: schema.companies.name }).from(schema.bids)
    .innerJoin(schema.tenders, eq(schema.tenders.id, schema.bids.tenderId))
    .innerJoin(schema.companies, eq(schema.companies.id, schema.tenders.companyId))
    .where(inArray(schema.bids.partnerId, partners.map((p) => p.id))).orderBy(desc(schema.bids.submittedAt));
}

/** The bid of this supplier organisation on one tender, if it has one. */
export async function myBidOn(db: Db | Tx, companyId: string, tender: { id: string; companyId: string }) {
  const [partner] = await db.select().from(schema.partners).where(and(eq(schema.partners.companyId, tender.companyId), eq(schema.partners.linkedCompanyId, companyId)));
  if (!partner) return undefined;
  const [bid] = await db.select().from(schema.bids).where(and(eq(schema.bids.tenderId, tender.id), eq(schema.bids.partnerId, partner.id)));
  return bid;
}

/** An advert this organisation may open: advertised and out, or one it has already bid on. */
export async function advertFor(db: Db, ctx: Ctx, tenderId: string) {
  const [row] = await db.select({ t: schema.tenders, buyer: schema.companies }).from(schema.tenders)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.tenders.companyId)).where(eq(schema.tenders.id, tenderId));
  if (!row || row.t.status === "draft") return null;
  const bid = await myBidOn(db, ctx.company.id, row.t);
  if (!bid && (!row.t.openToAll || row.t.status === "cancelled")) return null;
  return { tender: row.t, buyer: row.buyer, bid };
}

/** Sends or replaces a bid. The bidder appears as a supplier in the buyer's books, the first time it bids to them. */
export async function placeBid(tx: Tx, ctx: Ctx, tenderId: string, input: { amount: number; note: string; attachmentId: string | null }) {
  const [tender] = await tx.select().from(schema.tenders).where(eq(schema.tenders.id, tenderId)).for("update");
  if (!tender || !tender.openToAll) throw new UserError("err_not_found");
  if (tender.companyId === ctx.company.id) throw new UserError("err_own_tender");
  if (!biddingOpen(tender)) throw new UserError("err_not_bidding");
  await tx.insert(schema.partners).values({
    companyId: tender.companyId, name: ctx.company.name, kind: "supplier", tin: ctx.company.tin, phone: ctx.company.phone, email: ctx.company.email,
    address: [ctx.company.address, ctx.company.city, ctx.company.country].filter(Boolean).join(", "), linkedCompanyId: ctx.company.id,
  }).onConflictDoNothing();
  const [partner] = await tx.select().from(schema.partners).where(and(eq(schema.partners.companyId, tender.companyId), eq(schema.partners.linkedCompanyId, ctx.company.id)));
  await tx.insert(schema.bids).values({ companyId: tender.companyId, tenderId, partnerId: partner.id, amount: input.amount, note: input.note, attachmentId: input.attachmentId, submittedBy: ctx.user.id })
    .onConflictDoUpdate({
      target: [schema.bids.tenderId, schema.bids.partnerId],
      set: { amount: input.amount, note: input.note, submittedBy: ctx.user.id, submittedAt: new Date(), ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}) },
    });
  // While bids are sealed the buyer's audit trail says neither who bid nor how much. The bidder's own trail records it.
  await audit(tx, tender.companyId, null, "submit", "bid", tender.number);
  await audit(tx, ctx.company.id, ctx.user.id, "submit", "bid", tender.number, { amount: input.amount });
}
