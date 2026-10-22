import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import { lastDayOfMonth, round2 } from "./format";
import { accountIdByCode, saveEntry, UserError, type LineInput } from "./ledger";
import { audit } from "./audit";

type Asset = typeof schema.fixedAssets.$inferSelect;
type Category = typeof schema.assetCategories.$inferSelect;

/** Gross cost and accumulated depreciation (including impairment) of each asset, up to a date. */
export async function assetBalances(db: Db | Tx, companyId: string, to?: string) {
  const conds = [eq(schema.assetMovements.companyId, companyId)];
  if (to) conds.push(lte(schema.assetMovements.date, to));
  const rows = await db.select({
    assetId: schema.assetMovements.assetId,
    cost: sql<string>`coalesce(sum(${schema.assetMovements.cost}), 0)`,
    dep: sql<string>`coalesce(sum(${schema.assetMovements.depreciation}), 0)`,
  }).from(schema.assetMovements).where(and(...conds)).groupBy(schema.assetMovements.assetId);
  return new Map(rows.map((r) => [r.assetId, { cost: Number(r.cost), accum: Number(r.dep), carrying: round2(Number(r.cost) - Number(r.dep)) }]));
}

const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

/**
 * One month's depreciation. Straight line spreads what is left to depreciate over the months of useful life
 * left, so impairments and revaluations change the charge from then on (IAS 16.50-51, IAS 36.63).
 */
function monthCharge(a: Asset, carrying: number, month: number): number {
  const depreciable = round2(carrying - a.residualValue);
  if (depreciable <= 0) return 0;
  if (a.method === "reducing_balance") return Math.min(depreciable, round2((carrying * a.rate) / 100 / 12));
  const left = a.usefulLifeMonths - (month - monthIndex(a.availableDate));
  return left <= 1 ? depreciable : round2(depreciable / left);
}

/** Books depreciation for every active asset up to the end of `month`, catching up months not yet booked. */
export async function runDepreciation(tx: Tx, companyId: string, userId: string, month: string, memo: string) {
  const end = lastDayOfMonth(month), target = monthIndex(end);
  const assets = await tx.select().from(schema.fixedAssets).where(and(eq(schema.fixedAssets.companyId, companyId), eq(schema.fixedAssets.status, "active")));
  if (!assets.length) return { entryId: null, total: 0 };
  const cats = await tx.select().from(schema.assetCategories).where(eq(schema.assetCategories.companyId, companyId));
  const bal = await assetBalances(tx, companyId);
  const perAsset: { a: Asset; amount: number }[] = [];
  for (const a of assets) {
    let carrying = bal.get(a.id)?.carrying ?? 0, amount = 0;
    const first = Math.max(monthIndex(a.availableDate), a.depreciatedTo ? monthIndex(a.depreciatedTo) + 1 : 0);
    for (let m = first; m <= target; m++) { const c = monthCharge(a, carrying, m); amount = round2(amount + c); carrying = round2(carrying - c); }
    if (first <= target) perAsset.push({ a, amount });
  }
  const charged = perAsset.filter((p) => p.amount > 0);
  const grouped = new Map<string, LineInput>();
  for (const { a, amount } of charged) {
    const cat = cats.find((c) => c.id === a.categoryId)!;
    const dr = `${cat.depExpenseAccount}|${a.projectId ?? ""}`, cr = `${cat.accumDepAccount}|${a.projectId ?? ""}`;
    const drLine = grouped.get(dr) ?? { accountId: await accountIdByCode(tx, companyId, cat.depExpenseAccount), debit: 0, credit: 0, projectId: a.projectId, description: memo };
    const crLine = grouped.get(cr) ?? { accountId: await accountIdByCode(tx, companyId, cat.accumDepAccount), debit: 0, credit: 0, projectId: a.projectId, description: memo };
    drLine.debit = round2(drLine.debit + amount); crLine.credit = round2(crLine.credit + amount);
    grouped.set(dr, drLine); grouped.set(cr, crLine);
  }
  const total = round2(charged.reduce((s, p) => s + p.amount, 0));
  let entryId: string | null = null;
  if (total > 0) {
    entryId = await saveEntry(tx, companyId, userId, { date: end, reference: `DEP-${month}`, memo, lines: [...grouped.values()] }, true);
    await tx.insert(schema.assetMovements).values(charged.map(({ a, amount }) => ({
      companyId, assetId: a.id, date: end, type: "depreciation" as const, depreciation: amount, entryId, notes: memo,
    })));
  }
  if (perAsset.length) await tx.update(schema.fixedAssets).set({ depreciatedTo: end }).where(inArray(schema.fixedAssets.id, perAsset.map((p) => p.a.id)));
  await audit(tx, companyId, userId, "depreciation", "fixed_assets", month, { total, assets: charged.length });
  return { entryId, total };
}

export async function loadAsset(db: Db | Tx, companyId: string, id: string): Promise<{ a: Asset; cat: Category }> {
  const [row] = await db.select({ a: schema.fixedAssets, cat: schema.assetCategories }).from(schema.fixedAssets)
    .innerJoin(schema.assetCategories, eq(schema.assetCategories.id, schema.fixedAssets.categoryId))
    .where(and(eq(schema.fixedAssets.id, id), eq(schema.fixedAssets.companyId, companyId)));
  if (!row) throw new UserError("err_not_found");
  return row;
}

type MovementInput = { date: string; amount: number; moneyAccountId?: string; notes: string };

/** Impairment, revaluation to fair value, or disposal, each with its journal entry. */
export async function recordMovement(tx: Tx, companyId: string, userId: string, id: string, kind: "impairment" | "revaluation" | "disposal" | "addition", m: MovementInput) {
  const { a, cat } = await loadAsset(tx, companyId, id);
  if (a.status !== "active") throw new UserError("err_asset_disposed");
  const b = (await assetBalances(tx, companyId)).get(id) ?? { cost: 0, accum: 0, carrying: 0 };
  const acc = (code: string) => accountIdByCode(tx, companyId, code);
  const assetAcc = await acc(cat.assetAccount), accumAcc = await acc(cat.accumDepAccount);
  const amount = round2(m.amount);
  const lines: LineInput[] = [];
  let move: { cost: number; depreciation: number; proceeds?: number; gainLoss?: number };

  if (kind === "addition") {
    if (amount <= 0 || !m.moneyAccountId) throw new UserError("err_amount");
    lines.push({ accountId: assetAcc, debit: amount, credit: 0 }, { accountId: m.moneyAccountId, debit: 0, credit: amount });
    move = { cost: amount, depreciation: 0 };
  } else if (kind === "impairment") {
    if (amount <= 0 || amount > b.carrying) throw new UserError("err_amount");
    lines.push({ accountId: await acc("6210"), debit: amount, credit: 0 }, { accountId: accumAcc, debit: 0, credit: amount });
    move = { cost: 0, depreciation: amount };
  } else if (kind === "revaluation") {
    // Elimination method: accumulated depreciation is closed against cost, then cost is restated to fair value.
    if (amount < 0) throw new UserError("err_amount");
    const diff = round2(amount - b.carrying), costChange = round2(amount - b.cost);
    if (b.accum) lines.push({ accountId: accumAcc, debit: b.accum, credit: 0 });
    if (costChange) lines.push(costChange > 0 ? { accountId: assetAcc, debit: costChange, credit: 0 } : { accountId: assetAcc, debit: 0, credit: -costChange });
    if (diff > 0) lines.push({ accountId: await acc("3300"), debit: 0, credit: diff });
    if (diff < 0) lines.push({ accountId: await acc("6210"), debit: -diff, credit: 0 });
    move = { cost: costChange, depreciation: -b.accum, gainLoss: diff };
  } else {
    if (amount < 0 || (amount > 0 && !m.moneyAccountId)) throw new UserError("err_amount");
    const gain = round2(amount - b.carrying);
    if (amount) lines.push({ accountId: m.moneyAccountId!, debit: amount, credit: 0 });
    if (b.accum) lines.push({ accountId: accumAcc, debit: b.accum, credit: 0 });
    lines.push({ accountId: assetAcc, debit: 0, credit: b.cost });
    if (gain > 0) lines.push({ accountId: await acc("4800"), debit: 0, credit: gain });
    if (gain < 0) lines.push({ accountId: await acc("6800"), debit: -gain, credit: 0 });
    move = { cost: -b.cost, depreciation: -b.accum, proceeds: amount, gainLoss: gain };
  }
  const entryId = await saveEntry(tx, companyId, userId, {
    date: m.date, reference: a.code, memo: `${kind} - ${a.code} ${a.name}${m.notes ? ` - ${m.notes}` : ""}`, projectId: a.projectId,
    lines: lines.map((l) => ({ ...l, projectId: a.projectId })),
  }, true);
  await tx.insert(schema.assetMovements).values({ companyId, assetId: id, date: m.date, type: kind, ...move, entryId, notes: m.notes });
  if (kind === "disposal") await tx.update(schema.fixedAssets).set({ status: "disposed" }).where(eq(schema.fixedAssets.id, id));
  await audit(tx, companyId, userId, kind, "fixed_asset", a.code, { amount });
}

