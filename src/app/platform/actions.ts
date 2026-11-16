"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ModuleKey } from "@/db/schema";
import { audit } from "@/lib/audit";
import { isIsoDate, isUuid, parseAmount, str } from "@/lib/format";
import { requirePlatformOwner } from "@/lib/platform";
import { UserError } from "@/lib/ledger";
import { confirmByReference } from "@/lib/billing";
import { cancelRefund, cancelSubscription, confirmReportedPayment, markRefundPaid, rejectReportedPayment, resendRefundLink, tellAccess } from "@/lib/subscriptions";

const back = (id: string, error?: string) => `/platform/companies/${id}${error ? `?error=${error}` : "?saved=1"}`;

async function companyOf(id: string) {
  if (!isUuid(id)) redirect("/platform");
  const db = await getDb();
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
  if (!c) redirect("/platform");
  return c;
}

/** Gives a company more days of free trial, counted from today or from the end of its trial, whichever is later. */
export async function extendTrial(fd: FormData) {
  const owner = await requirePlatformOwner();
  const id = str(fd, "id"), days = Math.round(Number(str(fd, "days")));
  const c = await companyOf(id);
  if (!Number.isFinite(days) || days < 1 || days > 365) redirect(back(id, "err_platform_days"));
  const from = Math.max(Date.now(), c.trialEndsAt.getTime());
  const db = await getDb();
  await db.update(schema.companies).set({ trialEndsAt: new Date(from + days * 86400000) }).where(eq(schema.companies.id, id));
  await audit(db, id, null, "platform_extend_trial", "company", id, { days, by: owner.email });
  revalidatePath(`/platform/companies/${id}`);
  redirect(back(id));
}

/** Stops everyone in a company from using TAGPILOT, with the reason they will see. Nothing is deleted. */
export async function suspendCompany(fd: FormData) {
  const owner = await requirePlatformOwner();
  const id = str(fd, "id"), reason = str(fd, "reason").slice(0, 500);
  await companyOf(id);
  if (!reason) redirect(back(id, "err_reason_required"));
  const db = await getDb();
  await db.update(schema.companies).set({ suspendedAt: new Date(), suspendedReason: reason }).where(eq(schema.companies.id, id));
  await audit(db, id, null, "platform_suspend", "company", id, { reason, by: owner.email });
  await tellAccess(id, true, reason);
  revalidatePath(`/platform/companies/${id}`);
  redirect(back(id));
}

export async function reactivateCompany(fd: FormData) {
  const owner = await requirePlatformOwner();
  const id = str(fd, "id");
  await companyOf(id);
  const db = await getDb();
  await db.update(schema.companies).set({ suspendedAt: null, suspendedReason: "" }).where(eq(schema.companies.id, id));
  await audit(db, id, null, "platform_reactivate", "company", id, { by: owner.email });
  await tellAccess(id, false, "");
  revalidatePath(`/platform/companies/${id}`);
  redirect(back(id));
}

/** Records a payment received outside TAGPILOT (bank transfer, mobile money): the company is paid up to the date given. */
export async function recordPayment(fd: FormData) {
  const owner = await requirePlatformOwner();
  const id = str(fd, "id"), until = str(fd, "until"), amount = parseAmount(fd.get("amount")), currency = str(fd, "currency").toUpperCase().slice(0, 3);
  const c = await companyOf(id);
  if (!isIsoDate(until) || new Date(`${until}T23:59:59Z`).getTime() <= Date.now()) redirect(back(id, "err_platform_until"));
  if (!(amount > 0) || !/^[A-Z]{3}$/.test(currency)) redirect(back(id, "err_amount"));
  const modules = c.modules as ModuleKey[];
  const periodEnd = new Date(`${until}T23:59:59Z`);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.insert(schema.subscriptionPayments).values({
      companyId: id, txRef: `manual-${crypto.randomUUID()}`, method: "manual", period: "monthly", modules, amount, currency, status: "successful",
      providerTransactionId: str(fd, "reference").slice(0, 120) || null, periodStart: new Date(), periodEnd, createdBy: null, paidAt: new Date(),
    });
    await tx.update(schema.companies).set({ paidUntil: periodEnd, paidModules: modules, plan: "active" }).where(eq(schema.companies.id, id));
    await audit(tx, id, null, "platform_payment", "company", id, { amount, currency, until, by: owner.email });
  });
  revalidatePath(`/platform/companies/${id}`);
  redirect(back(id));
}

// ---------- payments to confirm, cancellations and refunds ----------

/** Runs one platform step and comes back to the organisation's page with its outcome. A step may add to the address. */
const run = async (id: string, fn: () => Promise<unknown>) => {
  let extra: unknown;
  try { extra = await fn(); } catch (e) {
    if (e instanceof UserError) redirect(back(id, e.message));
    throw e;
  }
  revalidatePath("/platform");
  revalidatePath(`/platform/companies/${id}`);
  redirect(`/platform/companies/${id}?saved=1${typeof extra === "string" ? extra : ""}`);
};

async function paymentCompany(paymentId: string) {
  if (!isUuid(paymentId)) redirect("/platform");
  const db = await getDb();
  const [p] = await db.select({ companyId: schema.subscriptionPayments.companyId, txRef: schema.subscriptionPayments.txRef }).from(schema.subscriptionPayments).where(eq(schema.subscriptionPayments.id, paymentId));
  if (!p) redirect("/platform");
  return p;
}

async function refundCompany(refundId: string) {
  if (!isUuid(refundId)) redirect("/platform");
  const db = await getDb();
  const [r] = await db.select({ companyId: schema.subscriptionRefunds.companyId }).from(schema.subscriptionRefunds).where(eq(schema.subscriptionRefunds.id, refundId));
  if (!r) redirect("/platform");
  return r.companyId;
}

/** The money a subscriber reported has arrived: their subscription is extended. */
export async function confirmTransfer(fd: FormData) {
  const owner = await requirePlatformOwner();
  const id = str(fd, "paymentId"), p = await paymentCompany(id);
  await run(p.companyId, () => confirmReportedPayment(id, owner.email));
}

export async function rejectTransfer(fd: FormData) {
  const owner = await requirePlatformOwner();
  const id = str(fd, "paymentId"), p = await paymentCompany(id);
  await run(p.companyId, () => rejectReportedPayment(id, str(fd, "reason"), owner.email));
}

/** Asks Flutterwave again about a card payment that is still pending. */
export async function checkCardPayment(fd: FormData) {
  await requirePlatformOwner();
  const id = str(fd, "paymentId"), p = await paymentCompany(id);
  await run(p.companyId, async () => { if (!(await confirmByReference(p.txRef)).ok) throw new UserError("err_payment_not_found"); });
}

export async function cancelSubscriptionAction(fd: FormData) {
  const owner = await requirePlatformOwner();
  const id = str(fd, "id");
  await companyOf(id);
  const paymentId = str(fd, "paymentId");
  await run(id, async () => {
    const { sent } = await cancelSubscription(id, owner.email, { reason: str(fd, "reason").slice(0, 500), refund: parseAmount(fd.get("refund")), paymentId: isUuid(paymentId) ? paymentId : null, suspend: str(fd, "suspend") === "1" });
    return sent ? "" : "&nomail=1";
  });
}

export async function refundPaid(fd: FormData) {
  const owner = await requirePlatformOwner();
  const id = str(fd, "refundId"), companyId = await refundCompany(id);
  await run(companyId, () => markRefundPaid(id, str(fd, "reference"), owner.email));
}

export async function refundCancel(fd: FormData) {
  const owner = await requirePlatformOwner();
  const id = str(fd, "refundId"), companyId = await refundCompany(id);
  await run(companyId, () => cancelRefund(id, owner.email));
}

export async function refundResend(fd: FormData) {
  await requirePlatformOwner();
  const id = str(fd, "refundId"), companyId = await refundCompany(id);
  let sent = false;
  try { sent = (await resendRefundLink(id)).sent; } catch (e) { if (e instanceof UserError) redirect(back(companyId, e.message)); throw e; }
  revalidatePath(`/platform/companies/${companyId}`);
  redirect(`/platform/companies/${companyId}?${sent ? "saved=1" : "error=err_mail_not_sent"}`);
}
