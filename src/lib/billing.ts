import "server-only";
import crypto from "node:crypto";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import { round2 } from "./format";
import { UserError } from "./ledger";

const FLW = "https://api.flutterwave.com/v3";

export type Period = "monthly" | "yearly";

/** The single plan's prices, set in the environment so they can change without a new release. */
export function planPrices() {
  return {
    currency: (process.env.SUBSCRIPTION_CURRENCY || "USD").toUpperCase(),
    monthly: Number(process.env.SUBSCRIPTION_PRICE_MONTHLY || 30),
    yearly: Number(process.env.SUBSCRIPTION_PRICE_YEARLY || 300),
  };
}

export const paymentsConfigured = () => Boolean(process.env.FLW_SECRET_KEY);

/** The site's public address, for links in emails and payment redirects. */
export async function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
}

async function flw<T>(path: string, init?: RequestInit): Promise<T> {
  if (!process.env.FLW_SECRET_KEY) throw new UserError("err_payments_off");
  const res = await fetch(`${FLW}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) { console.error("Flutterwave error", res.status, body); throw new UserError("err_payment_provider"); }
  return body as T;
}

/** Opens a Flutterwave hosted checkout for one subscription period and returns its address. */
export async function startCheckout(company: { id: string; name: string }, user: { id: string; name: string; email: string | null }, period: Period) {
  const price = planPrices();
  const amount = price[period];
  const txRef = `TP-${company.id.slice(0, 8)}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const db = await getDb();
  await db.insert(schema.subscriptionPayments).values({ companyId: company.id, txRef, period, amount, currency: price.currency, createdBy: user.id });
  const base = await appUrl();
  const res = await flw<{ status: string; data?: { link?: string } }>("/payments", {
    method: "POST",
    body: JSON.stringify({
      tx_ref: txRef, amount: String(amount), currency: price.currency, redirect_url: `${base}/billing/callback`,
      customer: { email: user.email || `billing+${company.id.slice(0, 8)}@tagpilot.invalid`, name: user.name },
      customizations: { title: "TAGPILOT", description: `TAGPILOT subscription (${period}) - ${company.name}` },
      meta: { company_id: company.id, period },
    }),
  });
  if (!res.data?.link) throw new UserError("err_payment_provider");
  return res.data.link;
}

type FlwTransaction = { id: number; tx_ref: string; status: string; amount: number; currency: string };

/**
 * Asks Flutterwave for the transaction, checks it against the pending payment we recorded, and extends the
 * subscription once. Safe to call from both the browser redirect and the webhook.
 */
export async function confirmPayment(transactionId: string): Promise<{ ok: boolean; companyId?: string }> {
  if (!/^\d+$/.test(transactionId)) return { ok: false };
  const res = await flw<{ status: string; data?: FlwTransaction }>(`/transactions/${transactionId}/verify`);
  const tx = res.data;
  if (!tx) return { ok: false };
  const db = await getDb();
  return db.transaction(async (dbx) => {
    const [p] = await dbx.select().from(schema.subscriptionPayments).where(eq(schema.subscriptionPayments.txRef, tx.tx_ref));
    if (!p) return { ok: false };
    if (p.status === "successful") return { ok: true, companyId: p.companyId };
    const valid = tx.status === "successful" && tx.currency.toUpperCase() === p.currency && round2(Number(tx.amount)) >= round2(p.amount);
    if (!valid) {
      if (tx.status === "failed") await dbx.update(schema.subscriptionPayments).set({ status: "failed", providerTransactionId: String(tx.id) }).where(eq(schema.subscriptionPayments.id, p.id));
      return { ok: false, companyId: p.companyId };
    }
    const [c] = await dbx.select().from(schema.companies).where(eq(schema.companies.id, p.companyId));
    // A new period starts when the current one ends, or today if it has lapsed.
    const start = c.paidUntil && c.paidUntil.getTime() > Date.now() ? c.paidUntil : new Date();
    const end = new Date(start);
    if (p.period === "yearly") end.setFullYear(end.getFullYear() + 1); else end.setMonth(end.getMonth() + 1);
    await dbx.update(schema.subscriptionPayments).set({ status: "successful", providerTransactionId: String(tx.id), periodStart: start, periodEnd: end, paidAt: new Date() })
      .where(eq(schema.subscriptionPayments.id, p.id));
    await dbx.update(schema.companies).set({ paidUntil: end, plan: "active" }).where(eq(schema.companies.id, p.companyId));
    await audit(dbx, p.companyId, p.createdBy, "subscription_paid", "subscription", p.txRef, { period: p.period, amount: p.amount, until: end.toISOString().slice(0, 10) });
    return { ok: true, companyId: p.companyId };
  });
}
