import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { schema } from "@/db";
import { addDays, round2 } from "./format";
import { saveDocDraft } from "./documents";
import { accountIdByCode, reverseEntry, saveEntry, UserError, type LineInput } from "./ledger";
import { linkMoves, loadItem, moveStock, reverseDocumentStock } from "./inventory";
import { nextNumber } from "./numbering";
import { ensureStarterAccounts } from "./setup";
import { audit } from "./audit";

/** Credited when goods arrive before their bill, and debited by that bill, so the supplier is owed once. */
export const GRNI_ACCOUNT = "2150";

export type ReceiptLine = { itemId: string; quantity: number; unitCost: number | null };

/** Receives a delivery: the goods enter inventory at their cost, against goods received not yet invoiced. */
export async function receiveGoods(tx: Tx, companyId: string, userId: string, input: {
  partnerId: string; date: string; deliveryNote: string; notes: string; attachmentId: string | null; lines: ReceiptLine[];
}): Promise<string> {
  if (!input.lines.length) throw new UserError("err_no_lines");
  await ensureStarterAccounts(tx, companyId, [GRNI_ACCOUNT]);
  const number = await nextNumber(tx, schema.goodsReceipts, { number: schema.goodsReceipts.number, companyId: schema.goodsReceipts.companyId }, companyId, "GRN");
  const [receipt] = await tx.insert(schema.goodsReceipts).values({
    companyId, number, partnerId: input.partnerId, date: input.date, deliveryNote: input.deliveryNote, notes: input.notes, attachmentId: input.attachmentId, createdBy: userId,
  }).returning({ id: schema.goodsReceipts.id });

  const moveIds: (string | null)[] = [];
  const debits = new Map<string, number>();
  let total = 0, no = 0;
  for (const l of input.lines) {
    const item = await loadItem(tx, companyId, l.itemId);
    if (item.kind !== "stock") throw new UserError("err_not_stock");
    if (!(l.quantity > 0)) throw new UserError("err_amount");
    const unitCost = l.unitCost ?? item.purchaseCost;
    if (!(unitCost > 0)) throw new UserError("err_receipt_cost");
    const move = await moveStock(tx, companyId, { itemId: item.id, date: input.date, kind: "purchase", quantity: l.quantity, unitCost, sourceType: "receipt", sourceId: receipt.id, notes: number });
    moveIds.push(move.moveId);
    const amount = round2(l.quantity * unitCost);
    await tx.insert(schema.goodsReceiptLines).values({ receiptId: receipt.id, lineNo: ++no, itemId: item.id, quantity: l.quantity, unitCost, amount });
    debits.set(item.inventoryAccount, round2((debits.get(item.inventoryAccount) ?? 0) + amount));
    total = round2(total + amount);
  }
  const lines: LineInput[] = [];
  for (const [code, debit] of debits) lines.push({ accountId: await accountIdByCode(tx, companyId, code), debit, credit: 0, partnerId: input.partnerId });
  lines.push({ accountId: await accountIdByCode(tx, companyId, GRNI_ACCOUNT), debit: 0, credit: total, partnerId: input.partnerId, description: input.deliveryNote || number });
  const entryId = await saveEntry(tx, companyId, userId, {
    date: input.date, reference: input.deliveryNote || number, memo: `${number} · ${input.deliveryNote}`.trim(), partnerId: input.partnerId,
    source: "receipt", sourceId: receipt.id, attachmentId: input.attachmentId, lines,
  }, true);
  await linkMoves(tx, moveIds, entryId);
  await tx.update(schema.goodsReceipts).set({ value: total, entryId }).where(eq(schema.goodsReceipts.id, receipt.id));
  await audit(tx, companyId, userId, "receive", "goods_receipt", number, { value: total });
  return receipt.id;
}

async function lockReceipt(tx: Tx, companyId: string, id: string) {
  const [r] = await tx.select().from(schema.goodsReceipts).where(and(eq(schema.goodsReceipts.id, id), eq(schema.goodsReceipts.companyId, companyId))).for("update");
  if (!r) throw new UserError("err_not_found");
  return r;
}

/** Undoes a delivery that has no bill yet. */
export async function voidReceipt(tx: Tx, companyId: string, userId: string, id: string, date: string, memoPrefix: string) {
  const r = await lockReceipt(tx, companyId, id);
  if (r.status !== "received" || r.billId) throw new UserError("err_receipt_billed");
  if (r.entryId) await reverseEntry(tx, companyId, userId, r.entryId, date, memoPrefix);
  await reverseDocumentStock(tx, companyId, "receipt", id, date);
  await tx.update(schema.goodsReceipts).set({ status: "void" }).where(eq(schema.goodsReceipts.id, id));
  await audit(tx, companyId, userId, "void", "goods_receipt", r.number);
}

/** Starts the supplier's bill for a delivery. When it is approved it clears goods received, not inventory. */
export async function billFromReceipt(tx: Tx, companyId: string, userId: string, id: string, vatRate: number): Promise<string> {
  const r = await lockReceipt(tx, companyId, id);
  if (r.status !== "received" || r.billId) throw new UserError("err_receipt_billed");
  const grni = await accountIdByCode(tx, companyId, GRNI_ACCOUNT);
  const rows = await tx.select({ l: schema.goodsReceiptLines, item: schema.items }).from(schema.goodsReceiptLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.goodsReceiptLines.itemId)).where(eq(schema.goodsReceiptLines.receiptId, id)).orderBy(schema.goodsReceiptLines.lineNo);
  const billId = await saveDocDraft(tx, "bill", companyId, userId, undefined, {
    partnerId: r.partnerId, date: r.date, dueDate: addDays(r.date, 30), notes: `${r.number}${r.deliveryNote ? ` · ${r.deliveryNote}` : ""}`, projectId: null, supplierRef: r.deliveryNote, whtRate: 0, attachmentId: r.attachmentId,
  }, rows.map(({ l, item }) => ({
    description: `${item.sku} ${item.name}`, quantity: l.quantity, unitPrice: l.unitCost, vatApplies: vatRate > 0, accountId: grni, projectId: null, itemId: item.id,
  })), vatRate);
  await tx.update(schema.bills).set({ goodsReceiptId: id }).where(eq(schema.bills.id, billId));
  await tx.update(schema.goodsReceipts).set({ billId }).where(eq(schema.goodsReceipts.id, id));
  return billId;
}

/** A supplier sends its bill against its own contract. */
export async function submitSupplierBill(tx: Tx, contract: { id: string; companyId: string; partnerId: string; number: string; status: string }, userId: string, input: {
  reference: string; date: string; dueDate: string; amount: number; description: string; attachmentId: string | null;
}) {
  if (!input.reference || !input.description) throw new UserError("err_required");
  if (!(input.amount > 0)) throw new UserError("err_amount");
  if (input.dueDate < input.date) throw new UserError("err_contract_dates");
  await tx.insert(schema.supplierBills).values({ companyId: contract.companyId, contractId: contract.id, partnerId: contract.partnerId, submittedBy: userId, ...input });
  await audit(tx, contract.companyId, null, "submit", "supplier_bill", contract.number, { reference: input.reference, amount: input.amount });
}

/** The buyer accepts a supplier's bill: it becomes a draft bill to check and approve like any other. */
export async function acceptSupplierBill(tx: Tx, companyId: string, userId: string, id: string, accountId: string, vatApplies: boolean, vatRate: number): Promise<string> {
  const [s] = await tx.select().from(schema.supplierBills).where(and(eq(schema.supplierBills.id, id), eq(schema.supplierBills.companyId, companyId))).for("update");
  if (!s) throw new UserError("err_not_found");
  if (s.status !== "received") throw new UserError("err_voucher_state");
  const [contract] = await tx.select().from(schema.contracts).where(eq(schema.contracts.id, s.contractId));
  const billId = await saveDocDraft(tx, "bill", companyId, userId, undefined, {
    partnerId: s.partnerId, date: s.date, dueDate: s.dueDate, notes: `${contract?.number ?? ""} · ${s.description}`, projectId: contract?.projectId ?? null, supplierRef: s.reference, whtRate: 0, attachmentId: s.attachmentId,
  }, [{ description: s.description, quantity: 1, unitPrice: s.amount, vatApplies, accountId, projectId: contract?.projectId ?? null }], vatRate);
  await tx.update(schema.supplierBills).set({ status: "accepted", billId }).where(eq(schema.supplierBills.id, id));
  await audit(tx, companyId, userId, "accept", "supplier_bill", s.reference, { billId });
  return billId;
}

export async function rejectSupplierBill(tx: Tx, companyId: string, userId: string, id: string, note: string) {
  const [s] = await tx.select().from(schema.supplierBills).where(and(eq(schema.supplierBills.id, id), eq(schema.supplierBills.companyId, companyId))).for("update");
  if (!s) throw new UserError("err_not_found");
  if (s.status !== "received") throw new UserError("err_voucher_state");
  await tx.update(schema.supplierBills).set({ status: "rejected", decisionNote: note }).where(eq(schema.supplierBills.id, id));
  await audit(tx, companyId, userId, "reject", "supplier_bill", s.reference, { note });
}

