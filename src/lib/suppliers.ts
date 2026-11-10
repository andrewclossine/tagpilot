import "server-only";
import crypto from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import type { SupplierDocKind, SupplierStatus } from "@/db/schema";
import type { Ctx } from "./auth";
import { addDays, round2, today } from "./format";
import { UserError } from "./ledger";
import { audit } from "./audit";

export const DOC_KINDS: SupplierDocKind[] = ["rdb", "rra", "rssb", "other"];
/** Documents asked at registration; the tax and social security clearances expire. */
export const REQUIRED_DOCS: SupplierDocKind[] = ["rdb", "rra", "rssb"];
export const EXPIRING: SupplierDocKind[] = ["rra", "rssb"];

/** A supplier the organisation added itself has no status and counts as approved. */
export const canBid = (p: { supplierStatus: SupplierStatus | null }) => p.supplierStatus === null || p.supplierStatus === "approved";

export type DocState = "pending" | "rejected" | "valid" | "expiring" | "expired";
export function docState(d: { status: string; expiresOn: string | null }, on = today()): DocState {
  if (d.status === "pending") return "pending";
  if (d.status === "rejected") return "rejected";
  if (d.expiresOn && d.expiresOn < on) return "expired";
  if (d.expiresOn && d.expiresOn <= addDays(on, 30)) return "expiring";
  return "valid";
}

/** Opens or closes self-registration. The first time, a code for the link is made. */
export async function setRegistration(tx: Tx, ctx: Ctx, open: boolean) {
  const code = ctx.company.supplierRegCode ?? crypto.randomBytes(12).toString("base64url");
  await tx.update(schema.companies).set({ supplierRegOpen: open, supplierRegCode: code }).where(eq(schema.companies.id, ctx.company.id));
  await audit(tx, ctx.company.id, ctx.user.id, open ? "open_registration" : "close_registration", "supplier", "");
  return code;
}

export async function companyByCode(db: Db | Tx, code: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(code)) return null;
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.supplierRegCode, code));
  return c && c.supplierRegOpen && !c.suspendedAt && c.modules.includes("procurement") ? c : null;
}

export type RegistrationInput = {
  companyName: string; tin: string; phone: string; email: string; address: string; website: string;
  contact: string; username: string; passwordHash: string; categories: string[];
  documents: { kind: SupplierDocKind; reference: string; expiresOn: string | null; attachmentId: string }[];
};

/**
 * A supplier registers itself with an organisation: it becomes a supplier under review, with a sign-in to the
 * supplier portal, its documents waiting to be checked and the categories it asks to be prequalified for.
 */
export async function registerSupplier(tx: Tx, companyId: string, input: RegistrationInput) {
  if (!input.companyName || !input.contact || !input.tin) throw new UserError("err_required");
  const [same] = await tx.select({ id: schema.partners.id }).from(schema.partners)
    .where(and(eq(schema.partners.companyId, companyId), sql`lower(${schema.partners.tin}) = ${input.tin.toLowerCase()}`));
  if (same) throw new UserError("err_supplier_exists");
  const [taken] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, input.username));
  if (taken) throw new UserError("err_username_taken");
  if (input.email) {
    const [used] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, input.email));
    if (used) throw new UserError("err_email_taken");
  }
  for (const k of REQUIRED_DOCS) {
    const d = input.documents.find((x) => x.kind === k);
    if (!d) throw new UserError("err_supplier_docs");
    if (EXPIRING.includes(k) && (!d.expiresOn || d.expiresOn < today())) throw new UserError("err_supplier_doc_expiry");
  }
  const [p] = await tx.insert(schema.partners).values({
    companyId, name: input.companyName.slice(0, 200), kind: "supplier", tin: input.tin.slice(0, 40), phone: input.phone.slice(0, 40),
    email: input.email, address: input.address.slice(0, 300), website: input.website.slice(0, 200), supplierStatus: "registered",
  }).returning({ id: schema.partners.id });
  const [u] = await tx.insert(schema.users).values({ username: input.username, name: input.contact.slice(0, 120), email: input.email || null, passwordHash: input.passwordHash }).returning({ id: schema.users.id });
  await tx.insert(schema.memberships).values({ companyId, userId: u.id, role: "supplier", partnerId: p.id });
  await tx.insert(schema.supplierDocuments).values(input.documents.map((d) => ({ companyId, partnerId: p.id, kind: d.kind, reference: d.reference.slice(0, 100), expiresOn: d.expiresOn, attachmentId: d.attachmentId, uploadedBy: u.id })));
  const cats = await tx.select({ id: schema.supplierCategories.id }).from(schema.supplierCategories).where(eq(schema.supplierCategories.companyId, companyId));
  const chosen = input.categories.filter((c) => cats.some((x) => x.id === c));
  if (chosen.length) await tx.insert(schema.partnerCategories).values(chosen.map((categoryId) => ({ partnerId: p.id, categoryId })));
  await audit(tx, companyId, u.id, "register", "supplier", input.companyName, { tin: input.tin });
  return { partnerId: p.id, userId: u.id };
}

/** A supplier adds or renews one of its documents; it waits to be checked again. */
export async function addDocument(tx: Tx, companyId: string, partnerId: string, userId: string, d: { kind: SupplierDocKind; label: string; reference: string; expiresOn: string | null; attachmentId: string }) {
  if (!DOC_KINDS.includes(d.kind)) throw new UserError("err_required");
  if (EXPIRING.includes(d.kind) && (!d.expiresOn || d.expiresOn < today())) throw new UserError("err_supplier_doc_expiry");
  await tx.insert(schema.supplierDocuments).values({ companyId, partnerId, kind: d.kind, label: d.label.slice(0, 100), reference: d.reference.slice(0, 100), expiresOn: d.expiresOn, attachmentId: d.attachmentId, uploadedBy: userId });
}

async function supplierOf(tx: Tx, companyId: string, partnerId: string) {
  const [p] = await tx.select().from(schema.partners).where(and(eq(schema.partners.id, partnerId), eq(schema.partners.companyId, companyId))).for("update");
  if (!p) throw new UserError("err_not_found");
  return p;
}

export async function reviewDocument(tx: Tx, ctx: Ctx, docId: string, accept: boolean, note: string) {
  const [d] = await tx.select().from(schema.supplierDocuments).where(and(eq(schema.supplierDocuments.id, docId), eq(schema.supplierDocuments.companyId, ctx.company.id)));
  if (!d) throw new UserError("err_not_found");
  if (!accept && !note) throw new UserError("err_reason_required");
  await tx.update(schema.supplierDocuments).set({ status: accept ? "accepted" : "rejected", note, reviewedBy: ctx.user.id, reviewedAt: new Date() }).where(eq(schema.supplierDocuments.id, docId));
  await audit(tx, ctx.company.id, ctx.user.id, accept ? "accept_document" : "reject_document", "supplier", d.kind, { partnerId: d.partnerId, note });
}

/** Approves, rejects or suspends a supplier. Approval needs its required documents accepted and still valid. */
export async function setSupplierStatus(tx: Tx, ctx: Ctx, partnerId: string, status: SupplierStatus, note: string) {
  const p = await supplierOf(tx, ctx.company.id, partnerId);
  if (status !== "approved" && !note) throw new UserError("err_reason_required");
  if (status === "approved") {
    const docs = await tx.select().from(schema.supplierDocuments).where(eq(schema.supplierDocuments.partnerId, partnerId));
    const good = (k: SupplierDocKind) => docs.some((d) => d.kind === k && ["valid", "expiring"].includes(docState(d)));
    if (p.supplierStatus !== null && !REQUIRED_DOCS.every(good)) throw new UserError("err_supplier_docs_not_ok");
  }
  await tx.update(schema.partners).set({ supplierStatus: status, statusNote: note }).where(eq(schema.partners.id, partnerId));
  await audit(tx, ctx.company.id, ctx.user.id, `supplier_${status}`, "supplier", p.name, { note });
  return p;
}

/** Prequalifies a supplier in a category for a year, or refuses it with a reason. */
export async function decideCategory(tx: Tx, ctx: Ctx, partnerId: string, categoryId: string, prequalify: boolean, note: string) {
  const p = await supplierOf(tx, ctx.company.id, partnerId);
  const [c] = await tx.select().from(schema.supplierCategories).where(and(eq(schema.supplierCategories.id, categoryId), eq(schema.supplierCategories.companyId, ctx.company.id)));
  if (!c) throw new UserError("err_not_found");
  if (!prequalify && !note) throw new UserError("err_reason_required");
  const values = { status: prequalify ? "prequalified" as const : "rejected" as const, note, decidedAt: new Date(), validUntil: prequalify ? addDays(today(), 365) : null };
  await tx.insert(schema.partnerCategories).values({ partnerId, categoryId, ...values })
    .onConflictDoUpdate({ target: [schema.partnerCategories.partnerId, schema.partnerCategories.categoryId], set: values });
  await audit(tx, ctx.company.id, ctx.user.id, prequalify ? "prequalify" : "refuse_category", "supplier", p.name, { category: c.name, note });
}

/** Rates the supplier of an order once it delivered: quality, delivery on time, service, each from 1 to 5. */
export async function rateOrder(tx: Tx, ctx: Ctx, orderId: string, input: { quality: number; delivery: number; service: number; comment: string }) {
  const [o] = await tx.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, orderId), eq(schema.purchaseOrders.companyId, ctx.company.id)));
  if (!o) throw new UserError("err_not_found");
  const [got] = await tx.select({ n: sql<number>`count(*)` }).from(schema.orderReceipts).where(and(eq(schema.orderReceipts.orderId, orderId), eq(schema.orderReceipts.status, "received")));
  if (!Number(got.n)) throw new UserError("err_rate_after_receipt");
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5;
  if (![input.quality, input.delivery, input.service].every(ok)) throw new UserError("err_rating");
  const values = { quality: input.quality, delivery: input.delivery, service: input.service, comment: input.comment.slice(0, 1000), ratedBy: ctx.user.id };
  await tx.insert(schema.supplierRatings).values({ companyId: ctx.company.id, partnerId: o.partnerId, orderId, ...values })
    .onConflictDoUpdate({ target: schema.supplierRatings.orderId, set: values });
  await audit(tx, ctx.company.id, ctx.user.id, "rate", "purchase_order", o.number, values);
}

/** Average of each supplier's ratings, all three points together, out of 5. */
export async function ratingsOf(db: Db | Tx, partnerIds: string[]) {
  const out = new Map<string, { avg: number; count: number }>();
  if (!partnerIds.length) return out;
  const rows = await db.select().from(schema.supplierRatings).where(inArray(schema.supplierRatings.partnerId, partnerIds));
  for (const id of partnerIds) {
    const mine = rows.filter((r) => r.partnerId === id);
    if (mine.length) out.set(id, { avg: round2(mine.reduce((s, r) => s + (r.quality + r.delivery + r.service) / 3, 0) / mine.length), count: mine.length });
  }
  return out;
}

/** Each supplier's categories and the state of its documents, for the register and the invitation list. */
export async function registry(db: Db | Tx, companyId: string) {
  const [partners, cats, links, docs] = await Promise.all([
    db.select().from(schema.partners).where(and(eq(schema.partners.companyId, companyId), inArray(schema.partners.kind, ["supplier", "both"]))).orderBy(asc(schema.partners.name)),
    db.select().from(schema.supplierCategories).where(eq(schema.supplierCategories.companyId, companyId)).orderBy(asc(schema.supplierCategories.sortOrder), asc(schema.supplierCategories.name)),
    db.select({ l: schema.partnerCategories }).from(schema.partnerCategories).innerJoin(schema.supplierCategories, eq(schema.supplierCategories.id, schema.partnerCategories.categoryId))
      .where(eq(schema.supplierCategories.companyId, companyId)),
    db.select().from(schema.supplierDocuments).where(eq(schema.supplierDocuments.companyId, companyId)),
  ]);
  const ratings = await ratingsOf(db, partners.map((p) => p.id));
  const on = today();
  return {
    categories: cats,
    suppliers: partners.map((p) => {
      const mine = docs.filter((d) => d.partnerId === p.id);
      // The latest document of each kind is the one that counts.
      const latest = new Map<string, typeof mine[number]>();
      for (const d of [...mine].sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime())) latest.set(d.kind, d);
      const states = [...latest.values()].map((d) => docState(d, on));
      const docFlag: DocState | "none" = !states.length ? "none" : states.includes("expired") ? "expired" : states.includes("rejected") ? "rejected" : states.includes("pending") ? "pending" : states.includes("expiring") ? "expiring" : "valid";
      return {
        p, docFlag, rating: ratings.get(p.id) ?? null,
        categories: links.filter((x) => x.l.partnerId === p.id).map((x) => ({ ...x.l, name: cats.find((c) => c.id === x.l.categoryId)?.name ?? "" })),
      };
    }),
  };
}
