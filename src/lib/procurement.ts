import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import type { TenderStage, TenderStatus } from "@/db/schema";
import { addDays, round2, today } from "./format";
import { UserError } from "./ledger";
import { nextNumber } from "./numbering";
import { audit } from "./audit";
import { sendMail } from "./mail";

export type Tender = typeof schema.tenders.$inferSelect;
export type Bid = typeof schema.bids.$inferSelect;

/** Bids stay sealed until the opening is recorded: amounts and files are hidden from everyone at the organisation. */
export const isSealed = (t: Pick<Tender, "status">) => t.status === "draft" || t.status === "published";

export const biddingOpen = (t: Pick<Tender, "status" | "deadline">) => t.status === "published" && !!t.deadline && t.deadline.getTime() > Date.now();

/** Which status each step needs, and the status it leads to. Negotiation may be skipped after final notification. */
export const STAGE_RULES: Record<TenderStage, { from: TenderStatus[]; to: TenderStatus }> = {
  opening: { from: ["published"], to: "opened" },
  evaluation: { from: ["opened", "evaluated"], to: "evaluated" },
  provisional: { from: ["evaluated"], to: "provisional" },
  final: { from: ["provisional"], to: "final" },
  negotiation: { from: ["final"], to: "negotiation" },
  minutes: { from: ["negotiation"], to: "negotiated" },
  draft_contract: { from: ["final", "negotiated"], to: "draft_contract" },
  signed: { from: ["draft_contract"], to: "signed" },
};

/** Steps a supplier sees once they are out: provisional goes to every bidder, the rest only to the winner. */
const WINNER_STAGES: TenderStage[] = ["final", "negotiation", "minutes", "draft_contract", "signed"];
export function supplierSeesStage(stage: TenderStage, bid: Bid | undefined): boolean {
  if (!bid) return false;
  if (stage === "provisional") return true;
  return bid.isWinner && WINNER_STAGES.includes(stage);
}

/** Whether a supplier can see this tender at all: it is out, and they were invited, it is open to all, or they already bid. */
export async function supplierCanSee(db: Db | Tx, tender: Tender, partnerId: string): Promise<boolean> {
  if (tender.status === "draft") return false;
  if (tender.openToAll && tender.status !== "cancelled") return true;
  const [invited] = await db.select().from(schema.tenderInvites).where(and(eq(schema.tenderInvites.tenderId, tender.id), eq(schema.tenderInvites.partnerId, partnerId)));
  return !!invited;
}

export type Scores = { bidId: string; responsive: boolean; technical: number; note: string }[];

/**
 * Scores the bids. The financial score gives the lowest responsive price 100 and the others less in proportion;
 * the total weighs technical and financial scores by the tender's technical weight. Non-responsive bids are not ranked.
 */
export function scoreBids(bids: Bid[], scores: Scores, technicalWeight: number) {
  const of = (id: string) => scores.find((s) => s.bidId === id);
  const prices = bids.filter((b) => of(b.id)?.responsive && b.amount > 0).map((b) => b.amount);
  const lowest = prices.length ? Math.min(...prices) : 0;
  const rows = bids.map((b) => {
    const s = of(b.id);
    if (!s?.responsive || !(b.amount > 0)) return { id: b.id, responsive: false, technical: s?.technical ?? 0, financial: 0, total: 0, rank: null as number | null, note: s?.note ?? "", amount: b.amount };
    const financial = round2((lowest / b.amount) * 100);
    const total = round2((s.technical * technicalWeight + financial * (100 - technicalWeight)) / 100);
    return { id: b.id, responsive: true, technical: s.technical, financial, total, rank: null as number | null, note: s.note, amount: b.amount };
  });
  rows.filter((r) => r.responsive).sort((a, b) => b.total - a.total || a.amount - b.amount).forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

export async function recordEvaluation(tx: Tx, companyId: string, userId: string, tender: Tender, scores: Scores, winnerId: string) {
  const bids = await tx.select().from(schema.bids).where(eq(schema.bids.tenderId, tender.id));
  const rows = scoreBids(bids, scores, tender.technicalWeight);
  const ranked = rows.filter((r) => r.rank !== null).sort((a, b) => a.rank! - b.rank!);
  if (!ranked.length) throw new UserError("err_no_responsive_bid");
  const winner = winnerId ? rows.find((r) => r.id === winnerId) : ranked[0];
  if (!winner?.responsive) throw new UserError("err_winner_not_responsive");
  for (const r of rows) {
    await tx.update(schema.bids).set({
      responsive: r.responsive, technicalScore: r.technical, financialScore: r.financial, totalScore: r.total, rank: r.rank,
      evaluationNote: r.note, isWinner: r.id === winner.id,
    }).where(eq(schema.bids.id, r.id));
  }
  await audit(tx, companyId, userId, "evaluate", "tender", tender.number, { winner: winner.id, ranked: ranked.length });
}

/** The first day a final notification may go out. */
export const standstillEnds = (provisionalDate: string, days: number) => addDays(provisionalDate, days);
export const standstillOver = (provisionalDate: string, days: number) => today() >= standstillEnds(provisionalDate, days);

/** Tells suppliers something by email when they have an address. The portal always shows it, so a failed email stops nothing. */
export async function notifySuppliers(db: Db, partnerIds: string[], subject: string, text: string) {
  if (!partnerIds.length) return;
  const partners = await db.select().from(schema.partners).where(inArray(schema.partners.id, partnerIds));
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)).replace(/\n/g, "<br>");
  for (const p of partners) {
    if (!p.email) continue;
    try { await sendMail(p.email, subject, `${p.name},\n\n${text}`, `<p>${esc(p.name)},</p><p>${esc(text)}</p>`); }
    catch (e) { console.error("Supplier email failed", e); }
  }
}

export async function newContractNumber(tx: Tx, companyId: string) {
  return nextNumber(tx, schema.contracts, { number: schema.contracts.number, companyId: schema.contracts.companyId }, companyId, "CTR");
}

// ---------- contracts ----------
export const MAX_AMENDMENTS = 10;
export type Contract = typeof schema.contracts.$inferSelect;
export type Amendment = typeof schema.contractAmendments.$inferSelect;

/** Value and end date today: the signed terms plus every approved amendment, in order. */
export function currentTerms(c: Pick<Contract, "amount" | "endDate">, amendments: Amendment[]) {
  const ok = amendments.filter((a) => a.status === "approved").sort((a, b) => a.no - b.no);
  return {
    amount: round2(ok.reduce((s, a) => s + a.amountChange, c.amount)),
    endDate: ok.reduce((d, a) => a.newEndDate ?? d, c.endDate),
    approved: ok.length,
  };
}

/** Opens amendment request number N. Only one can wait for a decision at a time, and a contract takes ten at most. */
export async function requestAmendment(tx: Tx, companyId: string, userId: string, contractId: string, fromSupplier: boolean, input: { reason: string; amountChange: number; newEndDate: string | null; attachmentId: string | null }) {
  const [c] = await tx.select().from(schema.contracts).where(and(eq(schema.contracts.id, contractId), eq(schema.contracts.companyId, companyId))).for("update");
  if (!c) throw new UserError("err_not_found");
  if (c.status !== "active") throw new UserError("err_contract_closed");
  if (!input.reason) throw new UserError("err_required");
  const rows = await tx.select().from(schema.contractAmendments).where(eq(schema.contractAmendments.contractId, contractId));
  if (rows.some((a) => a.status === "requested")) throw new UserError("err_amendment_pending");
  const approved = rows.filter((a) => a.status === "approved").length;
  if (approved >= MAX_AMENDMENTS) throw new UserError("err_amendment_limit");
  const terms = currentTerms(c, rows);
  if (terms.amount + input.amountChange < 0) throw new UserError("err_amount");
  if (input.newEndDate && input.newEndDate < c.startDate) throw new UserError("err_contract_dates");
  await tx.insert(schema.contractAmendments).values({ companyId, contractId, no: approved + 1, requestedBy: userId, fromSupplier, ...input });
  await audit(tx, companyId, userId, "request", "contract_amendment", c.number, { no: approved + 1, amountChange: input.amountChange });
}

export async function decideAmendment(tx: Tx, companyId: string, userId: string, id: string, approve: boolean, note: string) {
  const [a] = await tx.select().from(schema.contractAmendments).where(and(eq(schema.contractAmendments.id, id), eq(schema.contractAmendments.companyId, companyId))).for("update");
  if (!a) throw new UserError("err_not_found");
  if (a.status !== "requested") throw new UserError("err_voucher_state");
  await tx.update(schema.contractAmendments).set({ status: approve ? "approved" : "rejected", decidedBy: userId, decidedAt: new Date(), decisionNote: note }).where(eq(schema.contractAmendments.id, id));
  await audit(tx, companyId, userId, approve ? "approve" : "reject", "contract_amendment", a.contractId, { no: a.no, note });
}

export async function countBids(db: Db | Tx, tenderId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.bids).where(eq(schema.bids.tenderId, tenderId));
  return Number(n);
}
