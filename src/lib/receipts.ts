import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import type { ReceiptChecks } from "@/db/schema";
import type { Ctx } from "./auth";
import { round2 } from "./format";
import { UserError } from "./ledger";
import { nextNumber } from "./numbering";
import { audit } from "./audit";
import { orderProgress, receivedByLine } from "./purchase-orders";

export { receivedByLine };

const EPS = 0.0005;

export type ReceiveInput = {
  date: string; deliveryNote: string; checks: ReceiptChecks; defects: string; attachmentId: string | null;
  lines: { lineId: string; received: number; accepted: number; note: string }[];
};

/**
 * Records a delivery against an issued order. Nothing more than what is still outstanding can be accepted; anything
 * rejected, or any failed check, needs the defects written down.
 */
export async function receiveGoods(tx: Tx, ctx: Ctx, orderId: string, input: ReceiveInput) {
  const [o] = await tx.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, orderId), eq(schema.purchaseOrders.companyId, ctx.company.id))).for("update");
  if (!o) throw new UserError("err_not_found");
  if (o.status !== "issued") throw new UserError("err_po_state");
  const lines = await tx.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.orderId, orderId));
  const had = await receivedByLine(tx, [orderId]);
  const wanted = input.lines.filter((l) => l.received > 0);
  if (!wanted.length) throw new UserError("err_grn_nothing");
  for (const w of wanted) {
    const line = lines.find((l) => l.id === w.lineId);
    if (!line) throw new UserError("err_not_found");
    if (w.accepted < 0 || w.accepted > w.received + EPS) throw new UserError("err_grn_accepted");
    if (w.accepted > round2(line.quantity - (had.get(line.id)?.accepted ?? 0)) + EPS) throw new UserError("err_grn_over");
  }
  const rejected = wanted.some((w) => w.accepted < w.received - EPS);
  const failed = !input.checks.quantity || !input.checks.specification || !input.checks.condition || !input.checks.documents;
  if ((rejected || failed) && !input.defects) throw new UserError("err_grn_defects");
  const number = await nextNumber(tx, schema.orderReceipts, { number: schema.orderReceipts.number, companyId: schema.orderReceipts.companyId }, ctx.company.id, "GR");
  const [r] = await tx.insert(schema.orderReceipts).values({
    companyId: ctx.company.id, orderId, number, date: input.date, deliveryNote: input.deliveryNote.slice(0, 200), checks: input.checks,
    defects: input.defects.slice(0, 2000), attachmentId: input.attachmentId, receivedBy: ctx.user.id,
  }).returning({ id: schema.orderReceipts.id });
  await tx.insert(schema.orderReceiptLines).values(wanted.map((w) => ({ receiptId: r.id, lineId: w.lineId, received: w.received, accepted: w.accepted, note: w.note.slice(0, 300) })));
  await audit(tx, ctx.company.id, ctx.user.id, "receive", "purchase_order", o.number, { receipt: number, rejected, failed });
  return { id: r.id, number };
}

/** Voids a note entered by mistake, unless bills already took what it accepted. */
export async function voidReceipt(tx: Tx, ctx: Ctx, receiptId: string, note: string) {
  if (!note) throw new UserError("err_reason_required");
  const [r] = await tx.select().from(schema.orderReceipts).where(and(eq(schema.orderReceipts.id, receiptId), eq(schema.orderReceipts.companyId, ctx.company.id))).for("update");
  if (!r || r.status !== "received") throw new UserError("err_not_found");
  const [o] = await tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, r.orderId));
  const mine = await tx.select().from(schema.orderReceiptLines).where(eq(schema.orderReceiptLines.receiptId, receiptId));
  const accepted = await receivedByLine(tx, [r.orderId]);
  const billed = (await orderProgress(tx, [r.orderId])).get(r.orderId)?.byLine ?? new Map<string, number>();
  if (o?.requireReceipt && mine.some((l) => (accepted.get(l.lineId)?.accepted ?? 0) - l.accepted < (billed.get(l.lineId) ?? 0) - EPS)) throw new UserError("err_grn_billed");
  await tx.update(schema.orderReceipts).set({ status: "void", voidNote: note }).where(eq(schema.orderReceipts.id, receiptId));
  await audit(tx, ctx.company.id, ctx.user.id, "void_receipt", "purchase_order", o?.number ?? "", { receipt: r.number, note });
}

export type MatchIssue = "qty" | "price" | "total";

/**
 * The three-way match of one bill: purchase order, goods received and the bill. Every line billed so far must be
 * within what was accepted, at no more than the ordered price, and the bill must not add anything beyond those lines.
 */
export async function matchBill(db: Db | Tx, billId: string): Promise<{ applies: boolean; issues: MatchIssue[] }> {
  const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.id, billId));
  if (!bill?.purchaseOrderId) return { applies: false, issues: [] };
  const [o] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, bill.purchaseOrderId));
  if (!o?.requireReceipt) return { applies: false, issues: [] };
  const [lines, mine, accepted] = await Promise.all([
    db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.orderId, o.id)),
    db.select().from(schema.purchaseOrderBillings).where(eq(schema.purchaseOrderBillings.billId, billId)),
    receivedByLine(db, [o.id]),
  ]);
  // Everything billed on each line by bills that count, this one included.
  const all = await db.select({ lineId: schema.purchaseOrderBillings.lineId, quantity: schema.purchaseOrderBillings.quantity })
    .from(schema.purchaseOrderBillings).innerJoin(schema.bills, eq(schema.bills.id, schema.purchaseOrderBillings.billId))
    .where(and(inArray(schema.purchaseOrderBillings.lineId, lines.map((l) => l.id)), ne(schema.bills.status, "void")));
  const billedQty = new Map<string, number>();
  for (const b of all) billedQty.set(b.lineId, round2((billedQty.get(b.lineId) ?? 0) + b.quantity));
  const issues = new Set<MatchIssue>();
  for (const m of mine) {
    const line = lines.find((l) => l.id === m.lineId);
    if (!line) continue;
    if ((billedQty.get(line.id) ?? 0) > (accepted.get(line.id)?.accepted ?? 0) + EPS) issues.add("qty");
    if (m.quantity > 0 && m.amount / m.quantity > line.unitPrice + 0.005) issues.add("price");
  }
  if (bill.subtotal > round2(mine.reduce((s, m) => s + m.amount, 0)) + 0.01) issues.add("total");
  return { applies: true, issues: [...issues] };
}

/** The notes of an order with their lines, newest first. */
export async function receiptsOf(db: Db, orderId: string) {
  const notes = await db.select({ r: schema.orderReceipts, by: schema.users.name }).from(schema.orderReceipts)
    .leftJoin(schema.users, eq(schema.users.id, schema.orderReceipts.receivedBy))
    .where(eq(schema.orderReceipts.orderId, orderId)).orderBy(asc(schema.orderReceipts.createdAt));
  const lines = notes.length ? await db.select().from(schema.orderReceiptLines).where(inArray(schema.orderReceiptLines.receiptId, notes.map((n) => n.r.id))) : [];
  return notes.map((n) => ({ ...n, lines: lines.filter((l) => l.receiptId === n.r.id) }));
}
