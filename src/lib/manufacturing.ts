import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import type { StockClass } from "@/db/schema";
import { round2 } from "./format";
import { accountIdByCode, reverseEntry, saveEntry, UserError, type LineInput } from "./ledger";
import { ensureStarterAccounts } from "./setup";
import { linkMoves, loadItem, moveStock, reverseDocumentStock } from "./inventory";
import { nextNumber } from "./numbering";
import { audit } from "./audit";

export const WIP_ACCOUNT = "1320";
export const ABSORBED_ACCOUNT = "5190";
/** Where each kind of stock is kept unless the item says otherwise. */
export const CLASS_ACCOUNT: Record<StockClass, string> = { goods: "1300", raw: "1310", finished: "1330" };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Raw materials, work in progress, finished goods and the account that takes labour and overhead into stock. */
export const ensureManufacturingAccounts = (db: Db | Tx, companyId: string) =>
  ensureStarterAccounts(db, companyId, ["1310", WIP_ACCOUNT, "1330", "4110", "5120", "5130", ABSORBED_ACCOUNT]);

export async function bomOf(db: Db | Tx, companyId: string, itemId: string) {
  return db.select({ id: schema.bomLines.id, componentId: schema.bomLines.componentId, quantity: schema.bomLines.quantity, sku: schema.items.sku, name: schema.items.name, unit: schema.items.unit, avgCost: schema.items.avgCost, qtyOnHand: schema.items.qtyOnHand })
    .from(schema.bomLines).innerJoin(schema.items, eq(schema.items.id, schema.bomLines.componentId))
    .where(and(eq(schema.bomLines.companyId, companyId), eq(schema.bomLines.itemId, itemId))).orderBy(asc(schema.bomLines.sortOrder));
}

/** True when `itemId` is used, at any depth, in what `componentId` is made of: a product cannot contain itself. */
async function usesItem(db: Db | Tx, companyId: string, componentId: string, itemId: string, seen = new Set<string>()): Promise<boolean> {
  if (componentId === itemId) return true;
  if (seen.has(componentId)) return false;
  seen.add(componentId);
  const sub = await db.select({ c: schema.bomLines.componentId }).from(schema.bomLines).where(and(eq(schema.bomLines.companyId, companyId), eq(schema.bomLines.itemId, componentId)));
  for (const s of sub) if (await usesItem(db, companyId, s.c, itemId, seen)) return true;
  return false;
}

/** Replaces what one unit of a product is made of, and the labour and overhead each unit absorbs. */
export async function saveBom(tx: Tx, companyId: string, userId: string, itemId: string, lines: { componentId: string; quantity: number }[], conversionCost: number) {
  const it = await loadItem(tx, companyId, itemId);
  if (it.kind !== "stock") throw new UserError("err_not_stock");
  if (conversionCost < 0) throw new UserError("err_amount");
  const clean = new Map<string, number>();
  for (const l of lines) if (l.componentId && l.quantity > 0) clean.set(l.componentId, r4((clean.get(l.componentId) ?? 0) + l.quantity));
  if (clean.size) {
    const comps = await tx.select().from(schema.items).where(and(eq(schema.items.companyId, companyId), inArray(schema.items.id, [...clean.keys()])));
    if (comps.length !== clean.size || comps.some((c) => c.kind !== "stock")) throw new UserError("err_bom_component");
    for (const c of comps) if (await usesItem(tx, companyId, c.id, itemId)) throw new UserError("err_bom_cycle");
  }
  await tx.delete(schema.bomLines).where(and(eq(schema.bomLines.companyId, companyId), eq(schema.bomLines.itemId, itemId)));
  if (clean.size) await tx.insert(schema.bomLines).values([...clean].map(([componentId, quantity], i) => ({ companyId, itemId, componentId, quantity, sortOrder: i })));
  // A product with a recipe is something the company makes.
  await tx.update(schema.items).set({ conversionCost: round2(conversionCost), ...(clean.size && it.stockClass === "goods" ? { stockClass: "finished" as const } : {}) }).where(eq(schema.items.id, itemId));
  await audit(tx, companyId, userId, "update", "bom", it.sku, { lines: clean.size, conversionCost });
}

export async function loadOrder(db: Db | Tx, companyId: string, id: string) {
  const [o] = await db.select().from(schema.productionOrders).where(and(eq(schema.productionOrders.id, id), eq(schema.productionOrders.companyId, companyId)));
  if (!o) throw new UserError("err_not_found");
  return o;
}

/** A draft production run; its materials are the bill of materials times the quantity to make. */
export async function createOrder(tx: Tx, companyId: string, userId: string, input: { itemId: string; quantity: number; plannedDate: string; notes: string }) {
  const it = await loadItem(tx, companyId, input.itemId);
  const quantity = r3(input.quantity);
  if (quantity <= 0) throw new UserError("err_amount");
  const bom = await bomOf(tx, companyId, it.id);
  if (!bom.length) throw new UserError("err_no_bom");
  await ensureManufacturingAccounts(tx, companyId);
  const number = await nextNumber(tx, schema.productionOrders, { number: schema.productionOrders.number, companyId: schema.productionOrders.companyId }, companyId, "MO");
  const [o] = await tx.insert(schema.productionOrders).values({ companyId, number, itemId: it.id, quantity, plannedDate: input.plannedDate, notes: input.notes, createdBy: userId })
    .returning({ id: schema.productionOrders.id });
  await tx.insert(schema.productionLines).values(bom.map((b, i) => ({ orderId: o.id, componentId: b.componentId, quantity: r3(b.quantity * quantity), sortOrder: i })));
  await audit(tx, companyId, userId, "create", "production_order", number, { item: it.sku, quantity });
  return o.id as string;
}

/** Before it starts, the quantities to issue can be changed (more waste, a substitute used up, a smaller batch). */
export async function updateOrderDraft(tx: Tx, companyId: string, id: string, input: { quantity: number; plannedDate: string; notes: string; lines: Map<string, number> }) {
  const o = await loadOrder(tx, companyId, id);
  if (o.status !== "draft") throw new UserError("err_voucher_state");
  if (input.quantity <= 0) throw new UserError("err_amount");
  await tx.update(schema.productionOrders).set({ quantity: r3(input.quantity), plannedDate: input.plannedDate, notes: input.notes }).where(eq(schema.productionOrders.id, id));
  for (const [lineId, q] of input.lines) {
    if (q < 0) throw new UserError("err_amount");
    await tx.update(schema.productionLines).set({ quantity: r3(q) }).where(and(eq(schema.productionLines.id, lineId), eq(schema.productionLines.orderId, id)));
  }
}

/**
 * Starts production: each material leaves its store at average cost and the total goes into work in progress
 * (Dr work in progress, Cr raw materials). Not enough of a material stops it.
 */
export async function startOrder(tx: Tx, companyId: string, userId: string, id: string, date: string) {
  const o = await loadOrder(tx, companyId, id);
  if (o.status !== "draft") throw new UserError("err_voucher_state");
  await ensureManufacturingAccounts(tx, companyId);
  const product = await loadItem(tx, companyId, o.itemId);
  const lines = await tx.select().from(schema.productionLines).where(eq(schema.productionLines.orderId, id)).orderBy(asc(schema.productionLines.sortOrder));
  const credits = new Map<string, number>();
  const moveIds: (string | null)[] = [];
  let total = 0;
  for (const l of lines) {
    if (!l.quantity) continue;
    const comp = await loadItem(tx, companyId, l.componentId);
    const m = await moveStock(tx, companyId, { itemId: comp.id, date, kind: "issue", quantity: -l.quantity, sourceType: "production", sourceId: id, notes: o.number });
    const value = Math.abs(m.value);
    await tx.update(schema.productionLines).set({ unitCost: m.unitCost, value }).where(eq(schema.productionLines.id, l.id));
    credits.set(comp.inventoryAccount, round2((credits.get(comp.inventoryAccount) ?? 0) + value));
    moveIds.push(m.moveId);
    total = round2(total + value);
  }
  let entryId: string | null = null;
  if (total) {
    const entryLines: LineInput[] = [{ accountId: await accountIdByCode(tx, companyId, o.wipAccount), debit: total, credit: 0, description: `${o.number} ${product.sku}` }];
    for (const [code, v] of credits) if (v) entryLines.push({ accountId: await accountIdByCode(tx, companyId, code), debit: 0, credit: v });
    entryId = await saveEntry(tx, companyId, userId, { date, reference: o.number, memo: `Materials issued to production - ${product.sku} ${product.name} x ${o.quantity}`, source: "production", sourceId: id, lines: entryLines }, true);
    await linkMoves(tx, moveIds, entryId);
  }
  await tx.update(schema.productionOrders).set({ status: "in_progress", startDate: date, materialsCost: total, startEntryId: entryId }).where(eq(schema.productionOrders.id, id));
  await audit(tx, companyId, userId, "start", "production_order", o.number, { materials: total });
}

/**
 * Finishes production: the product comes into stock at materials plus labour and overhead, divided by what was actually
 * made, so normal waste raises the unit cost (Dr finished goods, Cr work in progress, Cr production costs absorbed).
 */
export async function finishOrder(tx: Tx, companyId: string, userId: string, id: string, date: string, quantityMade: number) {
  const o = await loadOrder(tx, companyId, id);
  if (o.status !== "in_progress") throw new UserError("err_voucher_state");
  if (o.startDate && date < o.startDate) throw new UserError("err_finish_before_start");
  const made = r3(quantityMade);
  if (made <= 0) throw new UserError("err_amount");
  const product = await loadItem(tx, companyId, o.itemId);
  const conversion = round2(product.conversionCost * made);
  const total = round2(o.materialsCost + conversion);
  const m = await moveStock(tx, companyId, { itemId: product.id, date, kind: "produce", quantity: made, unitCost: total / made, sourceType: "production", sourceId: id, notes: o.number });
  let entryId: string | null = null;
  if (total) {
    entryId = await saveEntry(tx, companyId, userId, {
      date, reference: o.number, memo: `Production finished - ${product.sku} ${product.name} x ${made}`, source: "production", sourceId: id,
      lines: [
        { accountId: await accountIdByCode(tx, companyId, product.inventoryAccount), debit: total, credit: 0, description: `${made} ${product.unit}` },
        { accountId: await accountIdByCode(tx, companyId, o.wipAccount), debit: 0, credit: o.materialsCost },
        { accountId: await accountIdByCode(tx, companyId, ABSORBED_ACCOUNT), debit: 0, credit: conversion, description: "Labour & overhead" },
      ],
    }, true);
    await linkMoves(tx, [m.moveId], entryId);
  }
  await tx.update(schema.productionOrders).set({ status: "done", finishDate: date, quantityMade: made, conversionCost: conversion, finishEntryId: entryId }).where(eq(schema.productionOrders.id, id));
  await audit(tx, companyId, userId, "finish", "production_order", o.number, { made, total });
}

/** Cancels a run. A draft simply stops; one in progress puts its materials back in store and reverses the entry. */
export async function cancelOrder(tx: Tx, companyId: string, userId: string, id: string, date: string) {
  const o = await loadOrder(tx, companyId, id);
  if (o.status === "in_progress") {
    if (o.startDate && date < o.startDate) throw new UserError("err_finish_before_start");
    await reverseDocumentStock(tx, companyId, "production", id, date);
    if (o.startEntryId) await reverseEntry(tx, companyId, userId, o.startEntryId, date, "Cancelled");
  } else if (o.status !== "draft") throw new UserError("err_voucher_state");
  await tx.update(schema.productionOrders).set({ status: "cancelled", finishDate: o.status === "in_progress" ? date : null }).where(eq(schema.productionOrders.id, id));
  await audit(tx, companyId, userId, "cancel", "production_order", o.number);
}

/** Stock on a given date, from the last movement of each item on or before it, and work in progress then. */
export async function valuationAt(db: Db, companyId: string, date: string) {
  const items = await db.select().from(schema.items).where(and(eq(schema.items.companyId, companyId), eq(schema.items.kind, "stock"))).orderBy(schema.items.sku);
  const moves = await db.select({ itemId: schema.stockMoves.itemId, date: schema.stockMoves.date, createdAt: schema.stockMoves.createdAt, qtyAfter: schema.stockMoves.qtyAfter, avgCostAfter: schema.stockMoves.avgCostAfter })
    .from(schema.stockMoves).where(eq(schema.stockMoves.companyId, companyId));
  const last = new Map<string, (typeof moves)[number]>();
  for (const m of moves) {
    if (m.date > date) continue;
    const p = last.get(m.itemId);
    if (!p || m.date > p.date || (m.date === p.date && m.createdAt > p.createdAt)) last.set(m.itemId, m);
  }
  const rows = items.map((it) => {
    const m = last.get(it.id);
    const qty = m?.qtyAfter ?? 0, cost = m?.avgCostAfter ?? 0;
    return { id: it.id, sku: it.sku, name: it.name, unit: it.unit, stockClass: it.stockClass, account: it.inventoryAccount, qty, cost, value: round2(qty * cost) };
  });
  const orders = await db.select({ id: schema.productionOrders.id, number: schema.productionOrders.number, startDate: schema.productionOrders.startDate, finishDate: schema.productionOrders.finishDate, materialsCost: schema.productionOrders.materialsCost, itemId: schema.productionOrders.itemId })
    .from(schema.productionOrders).where(eq(schema.productionOrders.companyId, companyId));
  const wip = orders.filter((o) => o.startDate && o.startDate <= date && (!o.finishDate || o.finishDate > date) && o.materialsCost);
  return { rows, wip };
}
