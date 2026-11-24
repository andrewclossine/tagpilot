import "server-only";
import crypto from "node:crypto";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ModuleKey } from "@/db/schema";
import type { Tx } from "@/db";
import { audit } from "./audit";
import { round2 } from "./format";
import { UserError } from "./ledger";
import { LIST_PRICES, PRICE_KEYS, quote, type Plan } from "./plans";

const FLW = "https://api.flutterwave.com/v3";

export type Period = "monthly" | "yearly";

/** Monthly prices in one currency, keyed "<app>:<tier>" (lib/plans), and "seat" for an extra user. */
export type Prices = Record<string, number>;

/** The currency prices are shown in when nobody chose another one. */
export const defaultCurrency = () => (process.env.SUBSCRIPTION_CURRENCY || "USD").toUpperCase();

/** Built-in list prices: in RWF and USD (lib/plans), until the platform owner sets others. */
const builtIn = (currency: string): Prices | null => (currency === "RWF" || currency === "USD" ? { ...LIST_PRICES[currency] } : null);

/**
 * Every currency subscribers can pay in, default first, with each package's monthly price in it. A currency the owner
 * priced takes the owner's prices, filling any package not priced yet from the built-in list where there is one.
 */
export async function priceList(): Promise<{ currency: string; prices: Prices }[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.platformPrices);
  const byCurrency = new Map<string, Prices>();
  for (const cur of ["RWF", "USD", defaultCurrency()]) { const b = builtIn(cur); if (b) byCurrency.set(cur, b); }
  for (const r of rows) {
    if (!PRICE_KEYS.includes(r.module)) continue; // a price from before packages, per app only
    const p = byCurrency.get(r.currency) ?? Object.fromEntries(PRICE_KEYS.map((k) => [k, 0]));
    p[r.module] = r.monthly;
    byCurrency.set(r.currency, p);
  }
  const def = defaultCurrency();
  if (!byCurrency.has(def)) byCurrency.set(def, { ...LIST_PRICES.USD });
  return [...byCurrency].map(([currency, prices]) => ({ currency, prices })).sort((a, b) => (a.currency === def ? -1 : b.currency === def ? 1 : a.currency.localeCompare(b.currency)));
}

/** The currency to use: the one asked for if it is offered, else the organisation's own if offered, else the default. */
export async function pickCurrency(...wanted: (string | null | undefined)[]) {
  const list = await priceList();
  const offered = wanted.map((w) => (w ?? "").toUpperCase()).find((w) => list.some((l) => l.currency === w));
  const chosen = list.find((l) => l.currency === offered) ?? list[0];
  return { ...chosen, currencies: list.map((l) => l.currency) };
}

/** What a plan costs in one currency: its lines, pack and organisation discounts, a month and a year (ten months). */
export async function planPrices(plan: Plan, currency: string | null | undefined, orgType: string) {
  const { currency: cur, prices } = await pickCurrency(currency);
  return { currency: cur, prices, ...quote(plan, prices, orgType) };
}

/** The platform owner sets the monthly price of packages in one currency. Packages not given keep their price. */
export async function savePrices(currency: string, prices: Record<string, number | undefined>) {
  if (!/^[A-Z]{3}$/.test(currency)) throw new UserError("err_amount");
  const given = PRICE_KEYS.filter((k) => prices[k] !== undefined);
  if (given.some((k) => !(prices[k]! >= 0) || !Number.isFinite(prices[k]))) throw new UserError("err_amount");
  if (given.every((k) => !prices[k])) throw new UserError("err_amount");
  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const k of given) {
      await tx.insert(schema.platformPrices).values({ currency, module: k as ModuleKey, monthly: round2(prices[k]!) })
        .onConflictDoUpdate({ target: [schema.platformPrices.currency, schema.platformPrices.module], set: { monthly: round2(prices[k]!), updatedAt: new Date() } });
    }
  });
}

/** Stops offering a currency. The default currency stays, at the server's prices. */
export async function removeCurrency(currency: string) {
  const db = await getDb();
  await db.delete(schema.platformPrices).where(eq(schema.platformPrices.currency, currency));
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
export async function startCheckout(company: { id: string; name: string; orgType: string }, plan: Plan, user: { id: string; name: string; email: string | null }, period: Period, currency: string) {
  const price = await planPrices(plan, currency, company.orgType);
  const amount = price[period];
  if (!(amount > 0)) throw new UserError("err_payment_provider");
  const txRef = `TP-${company.id.slice(0, 8)}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const db = await getDb();
  await db.insert(schema.subscriptionPayments).values({ companyId: company.id, txRef, period, modules: plan.modules, tiers: plan.tiers, seats: plan.seats, storageTier: plan.storage, amount, currency: price.currency, createdBy: user.id });
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
  return settle(res.data);
}

/** Asks Flutterwave about a checkout by our own reference, for payments whose redirect and webhook never arrived. */
export async function confirmByReference(txRef: string): Promise<{ ok: boolean; companyId?: string }> {
  const res = await flw<{ status: string; data?: FlwTransaction }>(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`);
  return settle(res.data);
}

async function settle(tx: FlwTransaction | undefined): Promise<{ ok: boolean; companyId?: string }> {
  if (!tx) return { ok: false };
  const db = await getDb();
  return db.transaction(async (dbx) => {
    const [p] = await dbx.select().from(schema.subscriptionPayments).where(eq(schema.subscriptionPayments.txRef, tx.tx_ref));
    if (!p) return { ok: false };
    if (p.status === "successful") return { ok: true, companyId: p.companyId };
    if (p.status !== "pending") return { ok: false, companyId: p.companyId }; // refunded or refused: never extended again
    const valid = tx.status === "successful" && tx.currency.toUpperCase() === p.currency && round2(Number(tx.amount)) >= round2(p.amount);
    if (!valid) {
      if (tx.status === "failed") await dbx.update(schema.subscriptionPayments).set({ status: "failed", providerTransactionId: String(tx.id) }).where(eq(schema.subscriptionPayments.id, p.id));
      return { ok: false, companyId: p.companyId };
    }
    await applyPayment(dbx, p, String(tx.id));
    return { ok: true, companyId: p.companyId };
  });
}

/** Marks a payment received and extends the subscription by its period, from when the current one ends (or today if it lapsed). */
export async function applyPayment(dbx: Tx, p: typeof schema.subscriptionPayments.$inferSelect, providerTransactionId: string | null) {
  const [c] = await dbx.select().from(schema.companies).where(eq(schema.companies.id, p.companyId));
  const start = c.paidUntil && c.paidUntil.getTime() > Date.now() ? c.paidUntil : new Date();
  const end = new Date(start);
  if (p.period === "yearly") end.setFullYear(end.getFullYear() + 1); else end.setMonth(end.getMonth() + 1);
  await dbx.update(schema.subscriptionPayments).set({ status: "successful", providerTransactionId: providerTransactionId ?? p.providerTransactionId, periodStart: start, periodEnd: end, paidAt: new Date() })
    .where(eq(schema.subscriptionPayments.id, p.id));
  await dbx.update(schema.companies).set({ paidUntil: end, plan: "active", ...(p.modules.length ? { paidModules: p.modules, paidTiers: p.tiers ?? {}, paidSeats: p.seats ?? 0, paidStorageTier: p.storageTier ?? "free" } : {}) }).where(eq(schema.companies.id, p.companyId));
  await audit(dbx, p.companyId, p.createdBy, "subscription_paid", "subscription", p.txRef, { period: p.period, amount: p.amount, until: end.toISOString().slice(0, 10) });
  return end;
}
