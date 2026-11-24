import "server-only";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Tx } from "@/db";
import { audit } from "./audit";
import { appUrl, applyPayment } from "./billing";
import { round2 } from "./format";
import { UserError } from "./ledger";
import { sendMail } from "./mail";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmt = (n: number, cur: string) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

/** Where the administrators of an organisation can be reached. */
async function adminEmails(companyId: string) {
  const db = await getDb();
  const rows = await db.select({ email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.companyId, companyId), eq(schema.memberships.role, "admin")));
  return [...new Set(rows.map((r) => (r.email ?? "").trim()).filter(Boolean))];
}

/**
 * Emails an organisation's administrators in English and French. A message that cannot go out (no SMTP yet, no address)
 * is not an error: the same information is on their subscription page. Returns whether at least one email was sent.
 */
async function tellAdmins(companyId: string, subject: string, en: string[], fr: string[], link?: { url: string; en: string; fr: string }) {
  const to = await adminEmails(companyId);
  let sent = false;
  const text = [...en, ...(link ? [`${link.en}: ${link.url}`] : []), "", "---", "", ...fr, ...(link ? [`${link.fr} : ${link.url}`] : []), "", "TAGPILOT"].join("\n");
  const block = (lines: string[], label?: string) => lines.map((l) => `<p>${esc(l)}</p>`).join("") + (link && label ? `<p><a href="${esc(link.url)}" style="display:inline-block;padding:10px 16px;background:#1f5eff;color:#fff;border-radius:8px;text-decoration:none">${esc(label)}</a></p>` : "");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1b2430">${block(en, link?.en)}<hr style="border:0;border-top:1px solid #dde3ea;margin:20px 0">${block(fr, link?.fr)}<p style="color:#6b7684">TAGPILOT</p></div>`;
  for (const email of to) {
    try { await sendMail(email, `TAGPILOT - ${subject}`, text, html); sent = true; }
    catch (e) { console.error("subscription email not sent", companyId, (e as Error).message); }
  }
  return sent;
}

/** Tells the platform owners that a subscriber did something that waits for them. */
async function tellOwners(subject: string, lines: string[]) {
  const db = await getDb();
  const owners = await db.select({ email: schema.platformAdmins.email }).from(schema.platformAdmins);
  const base = await appUrl();
  for (const o of owners) {
    try { await sendMail(o.email, `TAGPILOT platform - ${subject}`, [...lines, "", `${base}/platform`].join("\n"), `<div style="font-family:system-ui,sans-serif">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}<p><a href="${esc(base)}/platform">${esc(base)}/platform</a></p></div>`); }
    catch (e) { console.error("platform email not sent", (e as Error).message); }
  }
}

async function companyName(dbx: Tx, id: string) {
  const [c] = await dbx.select({ name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, id));
  return c?.name ?? "";
}

// ---------- payments the subscriber reports ----------

/** A subscriber says they paid by bank transfer or mobile money. It waits for the platform owner to confirm it. */
export async function reportTransfer(companyId: string, userId: string, input: { period: "monthly" | "yearly"; amount: number; currency: string; reference: string; note: string; modules: string[]; tiers?: Record<string, string>; seats?: number; storageTier?: string }) {
  if (!(input.amount > 0) || !/^[A-Z]{3}$/.test(input.currency)) throw new UserError("err_amount");
  if (!input.reference) throw new UserError("err_required");
  const db = await getDb();
  const name = await db.transaction(async (tx) => {
    await tx.insert(schema.subscriptionPayments).values({
      companyId, txRef: `transfer-${crypto.randomUUID()}`, period: input.period, modules: input.modules as never, tiers: (input.tiers ?? {}) as never, seats: input.seats ?? 0, storageTier: (input.storageTier ?? "free") as never, amount: round2(input.amount), currency: input.currency,
      status: "pending", method: "transfer", providerTransactionId: input.reference.slice(0, 120), note: input.note.slice(0, 500), createdBy: userId,
    });
    await audit(tx, companyId, userId, "subscription_transfer_reported", "subscription", input.reference.slice(0, 120), { amount: input.amount, currency: input.currency, period: input.period });
    return companyName(tx, companyId);
  });
  await tellOwners("payment to confirm", [`${name} says it paid ${fmt(input.amount, input.currency)} (${input.period}) by transfer.`, `Reference: ${input.reference}`, ...(input.note ? [`Note: ${input.note}`] : [])]);
}

async function pendingPayment(tx: Tx, id: string) {
  const [p] = await tx.select().from(schema.subscriptionPayments).where(eq(schema.subscriptionPayments.id, id));
  if (!p) throw new UserError("err_not_found");
  if (p.status !== "pending") throw new UserError("err_voucher_state");
  return p;
}

/** The platform owner has seen the money arrive: the subscription is extended by the period paid for. */
export async function confirmReportedPayment(id: string, ownerEmail: string) {
  const db = await getDb();
  const { p, end } = await db.transaction(async (tx) => {
    const p = await pendingPayment(tx, id);
    const end = await applyPayment(tx, p, null);
    await audit(tx, p.companyId, null, "platform_confirm_payment", "subscription", p.txRef, { amount: p.amount, by: ownerEmail });
    return { p, end };
  });
  const until = end.toISOString().slice(0, 10);
  await tellAdmins(p.companyId, "payment confirmed / paiement confirmé",
    [`We have received your payment of ${fmt(p.amount, p.currency)}. Your TAGPILOT subscription is paid until ${until}. Thank you.`],
    [`Nous avons reçu votre paiement de ${fmt(p.amount, p.currency)}. Votre abonnement TAGPILOT est payé jusqu'au ${until}. Merci.`]);
  return p.companyId;
}

/** The money never arrived, or the amount is wrong: the payment is refused and the subscriber is told why. */
export async function rejectReportedPayment(id: string, reason: string, ownerEmail: string) {
  if (!reason) throw new UserError("err_reason_required");
  const db = await getDb();
  const p = await db.transaction(async (tx) => {
    const p = await pendingPayment(tx, id);
    await tx.update(schema.subscriptionPayments).set({ status: "failed", note: reason.slice(0, 500) }).where(eq(schema.subscriptionPayments.id, id));
    await audit(tx, p.companyId, null, "platform_reject_payment", "subscription", p.txRef, { reason, by: ownerEmail });
    return p;
  });
  await tellAdmins(p.companyId, "payment not confirmed / paiement non confirmé",
    [`We could not confirm your payment of ${fmt(p.amount, p.currency)} (reference ${p.providerTransactionId ?? "-"}).`, `Reason: ${reason}`, "Reply to this email or report the payment again from your subscription page."],
    [`Nous n'avons pas pu confirmer votre paiement de ${fmt(p.amount, p.currency)} (référence ${p.providerTransactionId ?? "-"}).`, `Motif : ${reason}`, "Répondez à cet email ou déclarez à nouveau le paiement depuis votre page d'abonnement."]);
  return p.companyId;
}

// ---------- cancelling and refunding ----------

/**
 * Ends a subscription today. With an amount, a refund is opened and the administrators are emailed a private link where
 * they say which bank account or mobile money number to send it to. Suspending as well stops everyone using it.
 */
export async function cancelSubscription(companyId: string, ownerEmail: string, input: { reason: string; refund: number; paymentId: string | null; suspend: boolean }) {
  if (!input.reason) throw new UserError("err_reason_required");
  if (input.refund < 0) throw new UserError("err_amount");
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(schema.companies).where(eq(schema.companies.id, companyId));
    if (!c) throw new UserError("err_not_found");
    const now = new Date();
    await tx.update(schema.companies).set({
      paidUntil: now, plan: "expired", trialEndsAt: c.trialEndsAt.getTime() > now.getTime() ? now : c.trialEndsAt,
      ...(input.suspend ? { suspendedAt: now, suspendedReason: input.reason.slice(0, 500) } : {}),
    }).where(eq(schema.companies.id, companyId));
    let refund: { id: string; token: string; amount: number; currency: string } | null = null;
    if (input.refund > 0) {
      let currency = (process.env.SUBSCRIPTION_CURRENCY || "USD").toUpperCase();
      if (input.paymentId) {
        const [p] = await tx.select().from(schema.subscriptionPayments).where(and(eq(schema.subscriptionPayments.id, input.paymentId), eq(schema.subscriptionPayments.companyId, companyId)));
        if (!p || p.status !== "successful") throw new UserError("err_refund_payment");
        if (round2(input.refund) > round2(p.amount)) throw new UserError("err_refund_too_much");
        currency = p.currency;
      }
      const token = crypto.randomBytes(24).toString("base64url");
      const [r] = await tx.insert(schema.subscriptionRefunds).values({ companyId, paymentId: input.paymentId, amount: round2(input.refund), currency, reason: input.reason.slice(0, 500), token, createdBy: ownerEmail })
        .returning({ id: schema.subscriptionRefunds.id });
      refund = { id: r.id, token, amount: round2(input.refund), currency };
    }
    await audit(tx, companyId, null, "platform_cancel_subscription", "company", companyId, { reason: input.reason, refund: input.refund, suspend: input.suspend, by: ownerEmail });
    return { name: c.name, refund };
  });
  const base = await appUrl();
  const sent = await tellAdmins(companyId, "subscription cancelled / abonnement annulé",
    [`Your TAGPILOT subscription for ${result.name} has been cancelled.`, `Reason: ${input.reason}`,
      ...(result.refund ? [`We will refund ${fmt(result.refund.amount, result.refund.currency)}. Please tell us the bank account or mobile money number where we should send it.`] : []),
      ...(input.suspend ? ["Access to the organisation is suspended."] : [])],
    [`Votre abonnement TAGPILOT pour ${result.name} a été annulé.`, `Motif : ${input.reason}`,
      ...(result.refund ? [`Nous vous rembourserons ${fmt(result.refund.amount, result.refund.currency)}. Indiquez-nous le compte bancaire ou le numéro mobile money où l'envoyer.`] : []),
      ...(input.suspend ? ["L'accès à l'organisation est suspendu."] : [])],
    result.refund ? { url: `${base}/refund/${result.refund.token}`, en: "Give your account details", fr: "Indiquer vos coordonnées" } : undefined);
  if (result.refund && sent) await db.update(schema.subscriptionRefunds).set({ emailedAt: new Date() }).where(eq(schema.subscriptionRefunds.id, result.refund.id));
  return { sent };
}

/** Sends the refund link again, for example once email works or after the administrator changed address. */
export async function resendRefundLink(id: string) {
  const db = await getDb();
  const [r] = await db.select().from(schema.subscriptionRefunds).where(eq(schema.subscriptionRefunds.id, id));
  if (!r || r.status === "paid" || r.status === "cancelled") throw new UserError("err_voucher_state");
  const base = await appUrl();
  const sent = await tellAdmins(r.companyId, "refund / remboursement",
    [`We will refund ${fmt(r.amount, r.currency)}. Please tell us the bank account or mobile money number where we should send it.`],
    [`Nous vous rembourserons ${fmt(r.amount, r.currency)}. Indiquez-nous le compte bancaire ou le numéro mobile money où l'envoyer.`],
    { url: `${base}/refund/${r.token}`, en: "Give your account details", fr: "Indiquer vos coordonnées" });
  if (sent) await db.update(schema.subscriptionRefunds).set({ emailedAt: new Date() }).where(eq(schema.subscriptionRefunds.id, id));
  return { companyId: r.companyId, sent };
}

export async function refundByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const db = await getDb();
  const [row] = await db.select({ r: schema.subscriptionRefunds, company: schema.companies.name }).from(schema.subscriptionRefunds)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.subscriptionRefunds.companyId)).where(eq(schema.subscriptionRefunds.token, token));
  return row ?? null;
}

/** Refunds still waiting for the subscriber, for their subscription and suspended pages. */
export async function openRefunds(companyIds: string[]) {
  if (!companyIds.length) return [];
  const db = await getDb();
  return db.select().from(schema.subscriptionRefunds)
    .where(and(inArray(schema.subscriptionRefunds.companyId, companyIds), inArray(schema.subscriptionRefunds.status, ["awaiting_details", "details_received"])));
}

export type PayoutDetails = { payTo: "bank" | "momo"; accountName: string; bankName: string; accountNumber: string; bankCode: string; phone: string };

/** The subscriber says where the refund goes. They can correct it until it has been paid. */
export async function savePayoutDetails(token: string, d: PayoutDetails) {
  const row = await refundByToken(token);
  if (!row) throw new UserError("err_not_found");
  if (row.r.status !== "awaiting_details" && row.r.status !== "details_received") throw new UserError("err_voucher_state");
  const clip = (s: string, n = 120) => s.trim().slice(0, n);
  const v = { payTo: d.payTo, accountName: clip(d.accountName), bankName: d.payTo === "bank" ? clip(d.bankName) : "", accountNumber: d.payTo === "bank" ? clip(d.accountNumber, 64) : "", bankCode: d.payTo === "bank" ? clip(d.bankCode, 64) : "", phone: d.payTo === "momo" ? clip(d.phone, 32) : "" };
  if (!v.accountName || (v.payTo === "bank" ? !v.bankName || !v.accountNumber : !/^\+?[\d\s-]{7,20}$/.test(v.phone))) throw new UserError("err_required");
  const db = await getDb();
  await db.update(schema.subscriptionRefunds).set({ ...v, status: "details_received", detailsAt: new Date() }).where(eq(schema.subscriptionRefunds.id, row.r.id));
  await audit(db, row.r.companyId, null, "refund_details", "refund", row.r.id, { payTo: v.payTo });
  await tellOwners("refund details received", [`${row.company} gave the account for its refund of ${fmt(row.r.amount, row.r.currency)}.`, "Open the organisation in the platform to see the details and record the payment."]);
}

/** The platform owner sent the money: the refund is closed and the subscriber is told. */
export async function markRefundPaid(id: string, reference: string, ownerEmail: string) {
  if (!reference) throw new UserError("err_required");
  const db = await getDb();
  const r = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(schema.subscriptionRefunds).where(eq(schema.subscriptionRefunds.id, id));
    if (!r) throw new UserError("err_not_found");
    if (r.status !== "details_received") throw new UserError("err_voucher_state");
    await tx.update(schema.subscriptionRefunds).set({ status: "paid", paidAt: new Date(), paidReference: reference.slice(0, 120) }).where(eq(schema.subscriptionRefunds.id, id));
    if (r.paymentId) await tx.update(schema.subscriptionPayments).set({ status: "refunded" }).where(eq(schema.subscriptionPayments.id, r.paymentId));
    await audit(tx, r.companyId, null, "platform_refund_paid", "refund", id, { amount: r.amount, reference, by: ownerEmail });
    return r;
  });
  const to = r.payTo === "momo" ? r.phone : `${r.bankName} ${"•".repeat(4)}${r.accountNumber.slice(-4)}`;
  await tellAdmins(r.companyId, "refund sent / remboursement envoyé",
    [`We have sent your refund of ${fmt(r.amount, r.currency)} to ${to}.`, `Reference: ${reference}`],
    [`Nous avons envoyé votre remboursement de ${fmt(r.amount, r.currency)} vers ${to}.`, `Référence : ${reference}`]);
  return r.companyId;
}

export async function cancelRefund(id: string, ownerEmail: string) {
  const db = await getDb();
  const [r] = await db.select().from(schema.subscriptionRefunds).where(eq(schema.subscriptionRefunds.id, id));
  if (!r || r.status === "paid" || r.status === "cancelled") throw new UserError("err_voucher_state");
  await db.update(schema.subscriptionRefunds).set({ status: "cancelled" }).where(eq(schema.subscriptionRefunds.id, id));
  await audit(db, r.companyId, null, "platform_refund_cancelled", "refund", id, { by: ownerEmail });
  return r.companyId;
}

/** Tells the administrators their organisation was suspended or reactivated. */
export async function tellAccess(companyId: string, suspended: boolean, reason: string) {
  return suspended
    ? tellAdmins(companyId, "account suspended / compte suspendu", ["Access to your organisation on TAGPILOT has been suspended. Nothing has been deleted.", `Reason: ${reason}`], ["L'accès à votre organisation sur TAGPILOT a été suspendu. Rien n'a été supprimé.", `Motif : ${reason}`])
    : tellAdmins(companyId, "account reactivated / compte réactivé", ["Your organisation can use TAGPILOT again."], ["Votre organisation peut de nouveau utiliser TAGPILOT."]);
}
