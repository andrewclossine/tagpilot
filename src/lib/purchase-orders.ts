import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import { audit } from "./audit";
import { computeTotals, saveDocDraft } from "./documents";
import { round2 } from "./format";
import { UserError } from "./ledger";

export type PoLineInput = { description: string; quantity: number; unitPrice: number; vatApplies: boolean };
export type PoHeader = { partnerId: string; projectId: string; date: string; expectedDate: string | null; notes: string };
export type PoStatus = "draft" | "issued" | "partly_billed" | "billed" | "closed" | "cancelled";

async function lockOrder(tx: Tx, companyId: string, id: string) {
  const [o] = await tx.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.companyId, companyId))).for("update");
  if (!o) throw new UserError("err_not_found");
  return o;
}

async function nextNumber(tx: Tx, companyId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${companyId}:PO`}))`);
  const [row] = await tx.select({ n: sql<string>`coalesce(max(substring(${schema.purchaseOrders.number} from 4)::int), 0)` }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.companyId, companyId));
  return `PO-${String(Number(row?.n ?? 0) + 1).padStart(4, "0")}`;
}

/** Creates or changes a draft purchase order. It must say which project or cost center it is for, and who supplies it. */
export async function savePurchaseOrder(tx: Tx, companyId: string, userId: string, id: string | undefined, h: PoHeader, lines: PoLineInput[], vatRate: number) {
  if (!lines.length) throw new UserError("err_required");
  if (lines.some((l) => !l.description || !(l.quantity > 0) || !(l.unitPrice > 0))) throw new UserError("err_amount");
  const [partner] = await tx.select({ id: schema.partners.id }).from(schema.partners).where(and(eq(schema.partners.id, h.partnerId), eq(schema.partners.companyId, companyId)));
  if (!partner) throw new UserError("err_required");
  const [project] = await tx.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, h.projectId), eq(schema.projects.companyId, companyId)));
  if (!project) throw new UserError("err_po_project");
  const totals = computeTotals(lines.map((l) => ({ ...l, accountId: "", projectId: h.projectId })), vatRate);
  const values = { ...h, subtotal: totals.subtotal, vat: totals.vat, total: totals.total };
  let orderId = id;
  if (orderId) {
    const o = await lockOrder(tx, companyId, orderId);
    if (o.status !== "draft") throw new UserError("err_po_state");
    await tx.update(schema.purchaseOrders).set(values).where(eq(schema.purchaseOrders.id, orderId));
    await tx.delete(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.orderId, orderId));
  } else {
    const number = await nextNumber(tx, companyId);
    const [row] = await tx.insert(schema.purchaseOrders).values({ ...values, companyId, number, createdBy: userId }).returning({ id: schema.purchaseOrders.id });
    orderId = row.id;
    await audit(tx, companyId, userId, "create", "purchase_order", number, { total: totals.total });
  }
  await tx.insert(schema.purchaseOrderLines).values(totals.lines.map((l, i) => ({
    orderId: orderId!, lineNo: i + 1, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, vatApplies: l.vatApplies, amount: l.amount,
  })));
  return orderId;
}

export async function issuePurchaseOrder(tx: Tx, companyId: string, userId: string, id: string) {
  const o = await lockOrder(tx, companyId, id);
  if (o.status !== "draft") throw new UserError("err_po_state");
  await tx.update(schema.purchaseOrders).set({ status: "issued", issuedBy: userId, issuedAt: new Date() }).where(eq(schema.purchaseOrders.id, id));
  await audit(tx, companyId, userId, "issue", "purchase_order", o.number, { total: o.total });
}

export async function deletePurchaseOrder(tx: Tx, companyId: string, userId: string, id: string) {
  const o = await lockOrder(tx, companyId, id);
  if (o.status !== "draft") throw new UserError("err_po_state");
  await tx.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
  await audit(tx, companyId, userId, "delete", "purchase_order", o.number, { amount: o.total });
}

/** Ends an order: cancelled when nothing was billed on it, closed with what was billed when part of it was. */
export async function closePurchaseOrder(tx: Tx, companyId: string, userId: string, id: string, note: string) {
  const o = await lockOrder(tx, companyId, id);
  if (o.status !== "issued") throw new UserError("err_po_state");
  const billed = (await orderProgress(tx, [id])).get(id)?.billed ?? 0;
  const status = billed > 0 ? "closed" : "cancelled";
  await tx.update(schema.purchaseOrders).set({ status, closeNote: note }).where(eq(schema.purchaseOrders.id, id));
  await audit(tx, companyId, userId, status === "closed" ? "close" : "cancel", "purchase_order", o.number, { note, amount: o.total });
}

/** How much of each line, and of each order, has been billed. A voided bill no longer counts. */
export async function orderProgress(db: Db | Tx, orderIds: string[]) {
  const out = new Map<string, { billed: number; byLine: Map<string, number> }>();
  if (!orderIds.length) return out;
  const rows = await db.select({ orderId: schema.purchaseOrderLines.orderId, lineId: schema.purchaseOrderBillings.lineId, quantity: schema.purchaseOrderBillings.quantity, amount: schema.purchaseOrderBillings.amount })
    .from(schema.purchaseOrderBillings)
    .innerJoin(schema.purchaseOrderLines, eq(schema.purchaseOrderLines.id, schema.purchaseOrderBillings.lineId))
    .innerJoin(schema.bills, eq(schema.bills.id, schema.purchaseOrderBillings.billId))
    .where(and(inArray(schema.purchaseOrderLines.orderId, orderIds), ne(schema.bills.status, "void")));
  for (const r of rows) {
    const p = out.get(r.orderId) ?? { billed: 0, byLine: new Map<string, number>() };
    p.billed = round2(p.billed + r.amount);
    p.byLine.set(r.lineId, (p.byLine.get(r.lineId) ?? 0) + r.quantity);
    out.set(r.orderId, p);
  }
  return out;
}

export function statusOf(o: { status: string; subtotal: number }, billed: number): PoStatus {
  if (o.status !== "issued") return o.status as PoStatus;
  if (billed <= 0) return "issued";
  return billed >= o.subtotal - 0.005 ? "billed" : "partly_billed";
}

/** Turns what the supplier billed into a draft bill, carrying the project or cost center. It cannot go beyond what was ordered. */
export async function billFromOrder(tx: Tx, companyId: string, userId: string, id: string, input: {
  supplierRef: string; date: string; dueDate: string; vatRate: number;
  lines: { lineId: string; quantity: number; unitPrice: number; accountId: string }[];
}) {
  const o = await lockOrder(tx, companyId, id);
  if (o.status !== "issued") throw new UserError("err_po_state");
  const lines = await tx.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.orderId, id)).orderBy(asc(schema.purchaseOrderLines.lineNo));
  const done = (await orderProgress(tx, [id])).get(id)?.byLine ?? new Map<string, number>();
  const wanted = input.lines.filter((l) => l.quantity > 0);
  if (!wanted.length) throw new UserError("err_required");
  const accounts = await tx.select({ id: schema.accounts.id, type: schema.accounts.type, subtype: schema.accounts.subtype }).from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, companyId), inArray(schema.accounts.id, wanted.map((l) => l.accountId).filter(Boolean))));
  const docLines = wanted.map((w) => {
    const line = lines.find((l) => l.id === w.lineId);
    if (!line) throw new UserError("err_not_found");
    if (w.quantity > round2(line.quantity - (done.get(line.id) ?? 0)) + 0.0005) throw new UserError("err_po_over");
    if (!(w.unitPrice > 0)) throw new UserError("err_amount");
    const a = accounts.find((x) => x.id === w.accountId);
    if (!a || (a.type !== "expense" && a.type !== "asset") || ["bank", "cash", "momo", "ar", "ap"].includes(a.subtype ?? "")) throw new UserError("err_account");
    return { line, description: line.description, quantity: w.quantity, unitPrice: w.unitPrice, vatApplies: line.vatApplies && input.vatRate > 0, accountId: w.accountId, projectId: o.projectId };
  });
  const billId = await saveDocDraft(tx, "bill", companyId, userId, undefined, {
    partnerId: o.partnerId, date: input.date, dueDate: input.dueDate, notes: o.number, projectId: o.projectId, supplierRef: input.supplierRef,
  }, docLines.map(({ line: _line, ...l }) => l), input.vatRate);
  await tx.update(schema.bills).set({ purchaseOrderId: id }).where(eq(schema.bills.id, billId));
  await tx.insert(schema.purchaseOrderBillings).values(docLines.map((l) => ({ billId, lineId: l.line.id, quantity: l.quantity, amount: round2(l.quantity * l.unitPrice) })));
  await audit(tx, companyId, userId, "bill_from_order", "purchase_order", o.number, { billId });
  return billId;
}
