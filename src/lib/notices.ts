import "server-only";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { dict, type Key } from "./i18n-dict";
import { mailConfigured, sendMail } from "./mail";
import { today } from "./format";
import { receivedByLine } from "./purchase-orders";

const DAY = 86400000;
const both = (key: Key, vars: Record<string, string> = {}) => {
  const fill = (s: string) => Object.entries(vars).reduce((x, [k, v]) => x.replaceAll(`{${k}}`, v), s);
  return { subject: fill(dict.en[key]), text: `${fill(dict.en[key])}\n\n${fill(dict.fr[key])}` };
};

/**
 * The daily reminders: suppliers about a deadline coming, the procurement team about bids ready to open and late
 * deliveries, approvers and committee members about what has waited two days. Each one goes once.
 * Returns how many went out. Without email set up, nothing is sent and nothing is marked as sent.
 */
export async function runDailyNotices(db: Db, now = new Date()) {
  if (!mailConfigured() && process.env.NODE_ENV === "production") return { sent: 0, skipped: "mail not configured" };
  let sent = 0;
  const once = async (key: string, to: string | null | undefined, msg: { subject: string; text: string }) => {
    if (!to) return;
    const [done] = await db.select().from(schema.noticeLog).where(eq(schema.noticeLog.key, key));
    if (done) return;
    try {
      const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)).replace(/\n/g, "<br>");
      await sendMail(to, `TAGPILOT: ${msg.subject}`, msg.text, `<p>${esc(msg.text)}</p>`);
      await db.insert(schema.noticeLog).values({ key }).onConflictDoNothing();
      sent++;
    } catch (e) { console.error("Reminder failed", key, e); }
  };
  const emailOf = async (userId: string | null) => {
    if (!userId) return null;
    const [u] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
    return u?.email ?? null;
  };
  const companies = await db.select().from(schema.companies).where(isNull(schema.companies.suspendedAt));
  const active = companies.filter((c) => c.modules.includes("procurement"));
  if (!active.length) return { sent };
  const ids = active.map((c) => c.id);
  const nameOf = (id: string) => active.find((c) => c.id === id)?.name ?? "";

  // Bids: a reminder to invited suppliers that have not bid, in the last two days before the deadline.
  const tenders = await db.select().from(schema.tenders).where(and(inArray(schema.tenders.companyId, ids), eq(schema.tenders.status, "published")));
  for (const t of tenders) {
    if (!t.deadline) continue;
    const left = t.deadline.getTime() - now.getTime();
    if (left > 0 && left <= 2 * DAY) {
      const invited = await db.select({ partnerId: schema.tenderInvites.partnerId }).from(schema.tenderInvites).where(eq(schema.tenderInvites.tenderId, t.id));
      const bids = await db.select({ partnerId: schema.bids.partnerId }).from(schema.bids).where(eq(schema.bids.tenderId, t.id));
      const waiting = invited.map((i) => i.partnerId).filter((p) => !bids.some((b) => b.partnerId === p));
      if (waiting.length) {
        const partners = await db.select().from(schema.partners).where(inArray(schema.partners.id, waiting));
        for (const p of partners) await once(`bid-reminder:${t.id}:${p.id}`, p.email, both("ntc_bid_deadline", { number: t.number, title: t.title, buyer: nameOf(t.companyId), deadline: t.deadline.toISOString().slice(0, 16).replace("T", " ") + " UTC" }));
      }
    }
    if (left <= 0) await once(`ready-open:${t.id}`, await emailOf(t.createdBy), both("ntc_ready_open", { number: t.number, title: t.title }));
  }

  // Requisitions waiting two days for the same approver.
  const pending = await db.select({ s: schema.requisitionSteps, r: schema.requisitions }).from(schema.requisitionSteps)
    .innerJoin(schema.requisitions, eq(schema.requisitions.id, schema.requisitionSteps.requisitionId))
    .where(and(eq(schema.requisitionSteps.status, "pending"), eq(schema.requisitions.status, "submitted"), inArray(schema.requisitions.companyId, ids)));
  for (const { s, r } of pending) {
    const before = await db.select({ at: sql<Date | null>`max(${schema.requisitionSteps.decidedAt})` }).from(schema.requisitionSteps)
      .where(and(eq(schema.requisitionSteps.requisitionId, r.id), lt(schema.requisitionSteps.sortOrder, s.sortOrder)));
    const since = before[0]?.at ? new Date(before[0].at) : r.submittedAt;
    if (since && now.getTime() - since.getTime() >= 2 * DAY) await once(`rq-remind:${s.id}`, await emailOf(s.approverId), both("ntc_requisition", { number: r.number, title: r.title }));
  }

  // Committee members who have not sent scores two days after the opening, and award approvals waiting two days.
  const opened = await db.select({ t: schema.tenders, at: schema.tenderStages.createdAt, stage: schema.tenderStages.stage }).from(schema.tenderStages)
    .innerJoin(schema.tenders, eq(schema.tenders.id, schema.tenderStages.tenderId))
    .where(and(inArray(schema.tenders.companyId, ids), inArray(schema.tenderStages.stage, ["opening", "evaluation"])));
  for (const { t, at, stage } of opened) {
    if (now.getTime() - at.getTime() < 2 * DAY) continue;
    if (stage === "opening" && t.status === "opened") {
      const members = await db.select().from(schema.tenderCommittee).where(and(eq(schema.tenderCommittee.tenderId, t.id), isNull(schema.tenderCommittee.submittedAt)));
      for (const m of members) await once(`cm-remind:${t.id}:${m.userId}`, await emailOf(m.userId), both("ntc_committee", { number: t.number, title: t.title }));
    }
    if (stage === "evaluation" && t.status === "evaluated" && t.awardApproverId && !t.awardApprovedAt) {
      await once(`award-remind:${t.id}`, await emailOf(t.awardApproverId), both("ntc_award", { number: t.number, title: t.title }));
    }
  }

  // Deliveries past their expected date with something still to receive.
  const late = await db.select().from(schema.purchaseOrders)
    .where(and(inArray(schema.purchaseOrders.companyId, ids), eq(schema.purchaseOrders.status, "issued"), lt(schema.purchaseOrders.expectedDate, today())));
  if (late.length) {
    const lines = await db.select().from(schema.purchaseOrderLines).where(inArray(schema.purchaseOrderLines.orderId, late.map((o) => o.id)));
    const got = await receivedByLine(db, late.map((o) => o.id));
    for (const o of late) {
      if (lines.some((l) => l.orderId === o.id && (got.get(l.id)?.accepted ?? 0) < l.quantity - 0.0005)) {
        await once(`po-late:${o.id}`, await emailOf(o.createdBy), both("ntc_po_late", { number: o.number, date: o.expectedDate ?? "" }));
      }
    }
  }
  return { sent };
}
