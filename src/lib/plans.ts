// TAGPILOT packages: each app comes in tiers (Free, Starter, Business, Premium) that differ in price, in how many
// people may use the organisation and in what each app holds. Pure data and arithmetic, shared by the server and pages.
import type { ModuleKey } from "@/db/schema";

export type Tier = "free" | "starter" | "business" | "premium";
export const TIER_ORDER: Tier[] = ["free", "starter", "business", "premium"];
const rank = (t: Tier) => TIER_ORDER.indexOf(t);
export const isTier = (s: unknown): s is Tier => typeof s === "string" && (TIER_ORDER as string[]).includes(s);

/** The tiers each app is sold in, cheapest first. */
export const TIERS: Record<ModuleKey, Tier[]> = {
  accounting: ["starter", "business", "premium"],
  projects: ["starter", "business", "premium"],
  procurement: ["starter", "business", "premium"],
  bidding: ["starter"],
  esign: ["free", "starter", "business"],
  qr: ["free", "starter", "business"],
};
/** The tier a new organisation is offered first. */
export const DEFAULT_TIER: Record<ModuleKey, Tier> = { accounting: "starter", projects: "starter", procurement: "starter", bidding: "starter", esign: "free", qr: "free" };

const INF = Number.POSITIVE_INFINITY;
/** How many people may use the organisation with each app and tier; the organisation gets the largest of its apps. */
export const USERS: Record<ModuleKey, Partial<Record<Tier, number>>> = {
  accounting: { starter: 2, business: 5, premium: INF },
  projects: { starter: 5, business: 20, premium: INF },
  procurement: { starter: 5, business: 20, premium: INF },
  bidding: { starter: 3 },
  esign: { free: 1, starter: 3, business: 10 },
  qr: { free: 1, starter: 2, business: 5 },
};

/** What a tier allows, by limit. Infinity = no limit. */
export const LIMITS = {
  projects: { starter: 3, business: 20, premium: INF } as Partial<Record<Tier, number>>,          // projects at a time
  tendersPerMonth: { starter: 5, business: INF, premium: INF } as Partial<Record<Tier, number>>,
  esignPerMonth: { free: 3, starter: 50, business: INF } as Partial<Record<Tier, number>>,        // documents sent
  qrDynamic: { free: 2, starter: 25, business: 250 } as Partial<Record<Tier, number>>,             // dynamic codes kept
  payrollEmployees: { starter: 0, business: 25, premium: INF } as Partial<Record<Tier, number>>,
};

/** My Files is sold by storage: every file the organisation keeps counts (scans, uploads, signed documents). */
export const STORAGE_TIERS: Tier[] = ["free", "starter", "business", "premium"];
export const STORAGE_GB: Record<Tier, number> = { free: 5, starter: 50, business: 500, premium: 2048 };
export const storageBytes = (t: Tier) => STORAGE_GB[t] * 1024 ** 3;

/** Parts of Accounting that need a higher tier. */
export type Feature = "payroll" | "inventory" | "assets" | "budgets" | "financial_statements" | "batch" | "manufacturing" | "qr_logo" | "qr_file";
const FEATURE_TIER: Record<Feature, [ModuleKey, Tier]> = {
  payroll: ["accounting", "business"], inventory: ["accounting", "business"], assets: ["accounting", "business"], budgets: ["accounting", "business"],
  financial_statements: ["accounting", "business"], batch: ["accounting", "business"], manufacturing: ["accounting", "premium"],
  qr_logo: ["qr", "starter"], qr_file: ["qr", "business"],
};
export const featureNeeds = (f: Feature) => FEATURE_TIER[f];

/** List prices a month, in RWF and USD. The platform owner can set others per currency. */
export const LIST_PRICES: Record<"RWF" | "USD", Record<string, number>> = {
  RWF: {
    "accounting:starter": 25000, "accounting:business": 60000, "accounting:premium": 120000,
    "projects:starter": 20000, "projects:business": 60000, "projects:premium": 120000,
    "procurement:starter": 40000, "procurement:business": 120000, "procurement:premium": 250000,
    "bidding:starter": 15000,
    "esign:free": 0, "esign:starter": 15000, "esign:business": 35000,
    "qr:free": 0, "qr:starter": 10000, "qr:business": 25000,
    "files:free": 0, "files:starter": 15000, "files:business": 90000, "files:premium": 350000,
    seat: 5000,
  },
  USD: {
    "accounting:starter": 17, "accounting:business": 40, "accounting:premium": 80,
    "projects:starter": 14, "projects:business": 40, "projects:premium": 80,
    "procurement:starter": 27, "procurement:business": 80, "procurement:premium": 170,
    "bidding:starter": 10,
    "esign:free": 0, "esign:starter": 10, "esign:business": 24,
    "qr:free": 0, "qr:starter": 7, "qr:business": 17,
    "files:free": 0, "files:starter": 10, "files:business": 60, "files:premium": 240,
    seat: 3.5,
  },
};
/** Every priced item: each app's tiers, and an extra user. */
export const PRICE_KEYS: string[] = [...(Object.keys(TIERS) as ModuleKey[]).flatMap((m) => TIERS[m].map((t) => `${m}:${t}`)), ...STORAGE_TIERS.map((t) => `files:${t}`), "seat"];

/** Packs of apps sold together for less: the cheapest pack the organisation qualifies for applies, to those apps only. */
export const BUNDLES: { key: string; needs: Partial<Record<ModuleKey, Tier>>; off: number }[] = [
  { key: "business_pack", needs: { accounting: "business", esign: "starter", qr: "starter" }, off: 0.12 },
  { key: "ngo_pack", needs: { accounting: "business", projects: "business", procurement: "starter", esign: "starter" }, off: 0.14 },
];
/** NGOs and cooperatives pay 20% less. */
export const ORG_DISCOUNT: Record<string, number> = { ngo: 0.2, cooperative: 0.2 };

export type Plan = { modules: ModuleKey[]; tiers: Partial<Record<ModuleKey, Tier>>; seats: number; storage: Tier };

/** The tier an app is on. An organisation from before packages keeps everything it had: Premium (or the app's top tier). */
export function tierOf(plan: Pick<Plan, "tiers">, m: ModuleKey): Tier {
  const t = plan.tiers[m];
  const top = TIERS[m].at(-1)!;
  return t && TIERS[m].includes(t) ? t : top;
}
export const atLeast = (have: Tier, need: Tier) => rank(have) >= rank(need);
export const lowerTier = (a: Tier, b: Tier) => (rank(a) <= rank(b) ? a : b);

/** How many people may use the organisation. */
export function userLimit(plan: Plan) {
  const base = Math.max(1, ...plan.modules.map((m) => USERS[m][tierOf(plan, m)] ?? 1));
  return base + Math.max(0, plan.seats);
}
/** A limit of one app's tier; Infinity when the app is not on the plan's tier list. */
export function limitOf(plan: Plan, m: ModuleKey, table: Partial<Record<Tier, number>>) {
  return table[tierOf(plan, m)] ?? INF;
}
export function hasFeature(plan: Plan, f: Feature) {
  const [m, need] = FEATURE_TIER[f];
  return plan.modules.includes(m) && atLeast(tierOf(plan, m), need);
}

/** What the plan costs a month in one currency: each line, the pack discount, the organisation discount and the total. */
export function quote(plan: Plan, prices: Record<string, number>, orgType: string) {
  const lines: { module: ModuleKey | "seat" | "files"; tier: Tier; amount: number }[] = plan.modules.map((m) => ({ module: m, tier: tierOf(plan, m), amount: m === "bidding" && plan.modules.includes("procurement") ? 0 : prices[`${m}:${tierOf(plan, m)}`] ?? 0 })); // bidding is free with Procurement
  if (plan.storage !== "free") lines.push({ module: "files", tier: plan.storage, amount: prices[`files:${plan.storage}`] ?? 0 });
  if (plan.seats > 0) lines.push({ module: "seat", tier: "starter", amount: (prices.seat ?? 0) * plan.seats });
  const qualifies = BUNDLES.filter((b) => Object.entries(b.needs).every(([m, t]) => plan.modules.includes(m as ModuleKey) && atLeast(tierOf(plan, m as ModuleKey), t!)));
  const saving = (b: (typeof BUNDLES)[number]) => lines.filter((l) => l.module in b.needs).reduce((s, l) => s + l.amount, 0) * b.off;
  const bundle = qualifies.sort((a, b) => saving(b) - saving(a))[0];
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const bundleOff = bundle ? round2(saving(bundle)) : 0;
  const orgRate = ORG_DISCOUNT[orgType] ?? 0;
  const orgOff = round2((subtotal - bundleOff) * orgRate);
  const monthly = round2(subtotal - bundleOff - orgOff);
  return { lines, subtotal: round2(subtotal), bundle: bundle?.key ?? null, bundleOff, orgRate, orgOff, monthly, yearly: round2(monthly * 10) };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Reads the tiers and extra users chosen on a form: tier_<module> and seats. */
export function readPlan(fd: FormData, modules: ModuleKey[]): Plan {
  const tiers: Partial<Record<ModuleKey, Tier>> = {};
  for (const m of modules) { const t = fd.get(`tier_${m}`); tiers[m] = isTier(t) && TIERS[m].includes(t) ? t : DEFAULT_TIER[m]; }
  const seats = Math.min(500, Math.max(0, Math.trunc(Number(fd.get("seats") ?? 0) || 0)));
  const st = fd.get("tier_files");
  return { modules, tiers, seats, storage: isTier(st) ? st : "free" };
}

/** The plan an organisation chose (not yet held to what it paid for): what a payment is for. */
export const chosenPlan = (c: { modules: ModuleKey[]; tiers?: Partial<Record<ModuleKey, Tier>> | null; seats?: number | null; storageTier?: string | null }): Plan =>
  ({ modules: c.modules, tiers: c.tiers ?? {}, seats: c.seats ?? 0, storage: isTier(c.storageTier) ? c.storageTier : "free" });
