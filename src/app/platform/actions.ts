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
      companyId: id, txRef: `manual-${crypto.randomUUID()}`, period: "monthly", modules, amount, currency, status: "successful",
      providerTransactionId: str(fd, "reference").slice(0, 120) || null, periodStart: new Date(), periodEnd, createdBy: null, paidAt: new Date(),
    });
    await tx.update(schema.companies).set({ paidUntil: periodEnd, paidModules: modules, plan: "active" }).where(eq(schema.companies.id, id));
    await audit(tx, id, null, "platform_payment", "company", id, { amount, currency, until, by: owner.email });
  });
  revalidatePath(`/platform/companies/${id}`);
  redirect(back(id));
}
