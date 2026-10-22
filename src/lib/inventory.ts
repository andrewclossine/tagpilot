import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import { round2 } from "./format";
import { accountIdByCode, saveEntry, UserError } from "./ledger";
import { ensureStarterAccounts } from "./setup";
import { audit } from "./audit";

type MoveKind = "opening" | "purchase" | "sale" | "adjustment" | "void";
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Accounts an inventory needs; added to older companies the first time they use it. */
export const ensureInventoryAccounts = (db: Db | Tx, companyId: string) => ensureStarterAccounts(db, companyId, ["1300", "3200", "4100", "5100", "5150", "6900"]);

export async function loadItem(db: Db | Tx, companyId: string, id: string) {
  const [it] = await db.select().from(schema.items).where(and(eq(schema.items.id, id), eq(schema.items.companyId, companyId)));
  if (!it) throw new UserError("err_not_found");
  return it;
}

/**
 * Records one change in quantity and keeps the item's weighted average cost (IAS 2.25-27).
 * Receipts are valued at their own cost; issues leave at the average cost unless a cost is given (used to undo a receipt).
 * Issues may not take stock below zero unless `allowNegative` (voiding a purchase that was already sold).
 */
export async function moveStock(tx: Tx, companyId: string, m: {
  itemId: string; date: string; kind: MoveKind; quantity: number; unitCost?: number;
  sourceType?: "invoice" | "bill" | "adjustment" | "item"; sourceId?: string | null; entryId?: string | null; notes?: string; allowNegative?: boolean;
}) {
  const it = await loadItem(tx, companyId, m.itemId);
  const none = { value: 0, unitCost: 0, moveId: null as string | null };
  if (it.kind !== "stock") return none;
  const q = r3(m.quantity);
  if (!q) return none;
  const onHand = it.qtyOnHand;
  let unitCost: number, newAvg = it.avgCost;
  if (q > 0) {
    unitCost = r4(m.unitCost ?? it.avgCost);
    const after = onHand + q;
    newAvg = after > 0 && onHand >= 0 ? r4((onHand * it.avgCost + q * unitCost) / after) : unitCost;
  } else {
    if (onHand + q < -0.0005 && !m.allowNegative) throw new UserError("err_stock_insufficient");
    unitCost = r4(m.unitCost ?? it.avgCost);
  }
  const qtyAfter = r3(onHand + q), value = round2(q * unitCost);
  const [row] = await tx.insert(schema.stockMoves).values({
    companyId, itemId: it.id, date: m.date, kind: m.kind, quantity: q, unitCost, value, qtyAfter, avgCostAfter: newAvg,
    sourceType: m.sourceType ?? null, sourceId: m.sourceId ?? null, entryId: m.entryId ?? null, notes: m.notes ?? "",
  }).returning({ id: schema.stockMoves.id });
  await tx.update(schema.items).set({ qtyOnHand: qtyAfter, avgCost: newAvg }).where(eq(schema.items.id, it.id));
  return { value, unitCost, moveId: row.id as string | null };
}

/** Links stock movements to the journal entry that booked their value. */
export async function linkMoves(tx: Tx, moveIds: (string | null)[], entryId: string) {
  const ids = moveIds.filter((x): x is string => !!x);
  if (ids.length) await tx.update(schema.stockMoves).set({ entryId }).where(inArray(schema.stockMoves.id, ids));
}

/** Undoes the stock movements of a voided invoice or bill, at the cost they were booked at. */
export async function reverseDocumentStock(tx: Tx, companyId: string, sourceType: "invoice" | "bill", sourceId: string, date: string) {
  const moves = await tx.select().from(schema.stockMoves)
    .where(and(eq(schema.stockMoves.companyId, companyId), eq(schema.stockMoves.sourceType, sourceType), eq(schema.stockMoves.sourceId, sourceId)));
  for (const mv of moves.filter((x) => x.kind !== "void")) {
    await moveStock(tx, companyId, { itemId: mv.itemId, date, kind: "void", quantity: -mv.quantity, unitCost: mv.unitCost, sourceType, sourceId, allowNegative: true, notes: "void" });
  }
}

/** Opening stock for a new item, booked against retained earnings (or the account chosen). */
export async function openingStock(tx: Tx, companyId: string, userId: string, itemId: string, date: string, quantity: number, unitCost: number, creditCode: string, memo: string) {
  const it = await loadItem(tx, companyId, itemId);
  const { value, moveId } = await moveStock(tx, companyId, { itemId, date, kind: "opening", quantity, unitCost, sourceType: "item", sourceId: itemId, notes: memo });
  if (!value) return;
  const entryId = await saveEntry(tx, companyId, userId, {
    date, reference: it.sku, memo: `${memo} - ${it.sku} ${it.name}`,
    lines: [
      { accountId: await accountIdByCode(tx, companyId, it.inventoryAccount), debit: value, credit: 0 },
      { accountId: await accountIdByCode(tx, companyId, creditCode), debit: 0, credit: value },
    ],
  }, true);
  await linkMoves(tx, [moveId], entryId);
}

/**
 * A stock count: sets the quantity on hand to what was counted. A shortfall is a loss at average cost;
 * a surplus comes in at the cost given (or the average cost). Both are booked against stock adjustments.
 */
export async function countStock(tx: Tx, companyId: string, userId: string, itemId: string, date: string, counted: number, unitCost: number | undefined, reason: string) {
  const it = await loadItem(tx, companyId, itemId);
  if (it.kind !== "stock") throw new UserError("err_not_stock");
  const diff = r3(counted - it.qtyOnHand);
  if (!diff) return;
  const { value, moveId } = await moveStock(tx, companyId, { itemId, date, kind: "adjustment", quantity: diff, unitCost: diff > 0 ? unitCost || it.avgCost : undefined, sourceType: "adjustment", notes: reason, allowNegative: false });
  const inv = await accountIdByCode(tx, companyId, it.inventoryAccount), adj = await accountIdByCode(tx, companyId, "5150");
  const v = Math.abs(value);
  if (v) {
    const entryId = await saveEntry(tx, companyId, userId, {
      date, reference: it.sku, memo: `${reason || "Stock count"} - ${it.sku} ${it.name} (${diff > 0 ? "+" : ""}${diff} ${it.unit})`,
      lines: diff > 0
        ? [{ accountId: inv, debit: v, credit: 0 }, { accountId: adj, debit: 0, credit: v }]
        : [{ accountId: adj, debit: v, credit: 0 }, { accountId: inv, debit: 0, credit: v }],
    }, true);
    await linkMoves(tx, [moveId], entryId);
  }
  await audit(tx, companyId, userId, "stock_count", "item", it.sku, { counted, diff, value });
}
