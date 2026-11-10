import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import { round2 } from "./format";
import { UserError } from "./ledger";

export type TenderItem = typeof schema.tenderItems.$inferSelect;

export const itemsOf = (db: Db | Tx, tenderId: string) =>
  db.select().from(schema.tenderItems).where(eq(schema.tenderItems.tenderId, tenderId)).orderBy(asc(schema.tenderItems.sortOrder));

/**
 * Reads a bidder's unit prices, one field per line (price_<item id>). Every line must be priced; the bid amount is
 * the sum of quantity times price, worked out here so that it always matches the lines.
 */
export function readBidPrices(fd: FormData, items: TenderItem[]) {
  const prices = items.map((it) => {
    const raw = String(fd.get(`price_${it.id}`) ?? "").replace(/[\s,]/g, "");
    const unitPrice = Number(raw);
    if (!raw || !Number.isFinite(unitPrice) || unitPrice < 0) throw new UserError("err_boq_price");
    return { itemId: it.id, unitPrice: round2(unitPrice) };
  });
  const amount = round2(items.reduce((s, it, i) => s + round2(it.quantity * prices[i].unitPrice), 0));
  if (!(amount > 0)) throw new UserError("err_amount");
  return { amount, prices };
}

export async function saveBidPrices(tx: Tx, bidId: string, prices: { itemId: string; unitPrice: number }[]) {
  await tx.delete(schema.bidItems).where(eq(schema.bidItems.bidId, bidId));
  if (prices.length) await tx.insert(schema.bidItems).values(prices.map((p) => ({ bidId, itemId: p.itemId, unitPrice: p.unitPrice })));
}

/** Unit prices by bid and line, for the comparison sheet. Only ever read once the bids are opened. */
export async function pricesOf(db: Db | Tx, bidIds: string[]) {
  if (!bidIds.length) return new Map<string, number>();
  const rows = await db.select().from(schema.bidItems).where(inArray(schema.bidItems.bidId, bidIds));
  return new Map(rows.map((r) => [`${r.bidId}:${r.itemId}`, r.unitPrice]));
}
