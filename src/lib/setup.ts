import "server-only";
import { eq } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import { STARTER_ACCOUNTS, STARTER_ASSET_CATEGORIES } from "./template";

/** Adds starter accounts a company does not have yet (by code), leaving its own accounts untouched. */
export async function ensureStarterAccounts(db: Db | Tx, companyId: string, codes?: string[]) {
  const list = codes ? STARTER_ACCOUNTS.filter((a) => codes.includes(a.code)) : STARTER_ACCOUNTS;
  if (!list.length) return;
  await db.insert(schema.accounts).values(list.map((a) => ({
    companyId, code: a.code, nameEn: a.en, nameFr: a.fr, type: a.type, subtype: a.subtype ?? null,
  }))).onConflictDoNothing();
}

/** Gives a company the standard asset classes (and their accounts) the first time it uses fixed assets. */
export async function ensureAssetCategories(db: Db | Tx, companyId: string) {
  const existing = await db.select({ id: schema.assetCategories.id }).from(schema.assetCategories).where(eq(schema.assetCategories.companyId, companyId)).limit(1);
  if (existing.length) return;
  const codes = STARTER_ASSET_CATEGORIES.flatMap((c) => [c.asset, c.accum]).concat(["6200", "6210", "4800", "6800", "3300"]);
  await ensureStarterAccounts(db, companyId, codes);
  await db.insert(schema.assetCategories).values(STARTER_ASSET_CATEGORIES.map((c) => ({
    companyId, name: c.name, method: "straight_line" as const, usefulLifeMonths: c.months,
    assetAccount: c.asset, accumDepAccount: c.accum, depExpenseAccount: "6200",
  })));
}
