import "server-only";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import type { DocKind } from "./documents";
import { round2 } from "./format";
import { accountIdByCode, reverseEntry, saveEntry, UserError, type LineInput } from "./ledger";
import { nextNumber } from "./numbering";
import { audit } from "./audit";

type Settings = typeof schema.companies.$inferSelect["settings"];
const docTable = (kind: DocKind) => (kind === "invoice" ? schema.invoices : schema.bills);

/** The lines of a posted invoice or bill that a credit note may take back. Stock items go back through inventory, not here. */
export async function creditableLines(db: Db | Tx, kind: DocKind, docId: string) {
  const lines = kind === "invoice"
    ? await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, docId)).orderBy(schema.invoiceLines.lineNo)
    : await db.select().from(schema.billLines).where(eq(schema.billLines.billId, docId)).orderBy(schema.billLines.lineNo);
  const itemIds = lines.flatMap((l) => (l.itemId ? [l.itemId] : []));
  const stock = itemIds.length ? await db.select({ id: schema.items.id }).from(schema.items).where(and(inArray(schema.items.id, itemIds), eq(schema.items.kind, "stock"))) : [];
  const already = await db.select({ desc: schema.creditNoteLines.description, amount: schema.creditNoteLines.amount, lineNo: schema.creditNoteLines.lineNo })
    .from(schema.creditNoteLines).innerJoin(schema.creditNotes, eq(schema.creditNotes.id, schema.creditNoteLines.creditNoteId))
    .where(and(kind === "invoice" ? eq(schema.creditNotes.invoiceId, docId) : eq(schema.creditNotes.billId, docId), eq(schema.creditNotes.status, "posted")));
  return lines.map((l) => {
    const credited = round2(already.filter((a) => a.lineNo === l.lineNo).reduce((s, a) => s + a.amount, 0));
    return { ...l, isStock: stock.some((s) => s.id === l.itemId), credited, left: round2(l.amount - credited) };
  });
}

/**
 * Posts a credit note against an open invoice or bill. Each amount is at most what is left of its line, and the note
 * (with VAT) at most what is still owed: money already paid goes back by a refund, not by a credit note.
 */
export async function postCreditNote(tx: Tx, kind: DocKind, companyId: string, userId: string, docId: string,
  input: { date: string; reason: string; supplierRef: string; amounts: Map<number, number> }, settings: Settings) {
  const t = docTable(kind);
  const [d] = await tx.select().from(t).where(and(eq(t.id, docId), eq(t.companyId, companyId))).for("update");
  if (!d) throw new UserError("err_not_found");
  if (d.status !== "open" && d.status !== "partial") throw new UserError("err_cn_state");
  if (input.date < d.date) throw new UserError("err_cn_date");
  if (!input.reason) throw new UserError("err_reason_required");
  const lines = await creditableLines(tx, kind, docId);
  const chosen = lines.flatMap((l) => {
    const amount = round2(input.amounts.get(l.lineNo) ?? 0);
    if (!amount) return [];
    if (amount < 0 || l.isStock || amount > l.left + 0.005) throw new UserError("err_cn_line");
    return [{ l, amount }];
  });
  if (!chosen.length) throw new UserError("err_cn_nothing");
  const subtotal = round2(chosen.reduce((s, c) => s + c.amount, 0));
  // VAT follows the document: its own VAT, in proportion to the VAT-bearing amount taken back.
  const vatBase = round2(lines.filter((l) => l.vatApplies).reduce((s, l) => s + l.amount, 0));
  const docRate = vatBase > 0 && d.vat > 0 ? d.vat / vatBase : 0;
  const vat = round2(chosen.reduce((s, c) => s + (c.l.vatApplies ? c.amount * docRate : 0), 0));
  const total = round2(subtotal + vat);
  const owed = round2(d.total - d.amountPaid);
  if (total > owed + 0.005) throw new UserError("err_cn_over");

  const number = await nextNumber(tx, schema.creditNotes, { number: schema.creditNotes.number, companyId: schema.creditNotes.companyId }, companyId, kind === "invoice" ? "CN" : "SCN");
  const partnerAcc = await accountIdByCode(tx, companyId, kind === "invoice" ? settings.arAccount : settings.apAccount);
  const grouped = new Map<string, LineInput>();
  for (const { l, amount } of chosen) {
    const key = `${l.accountId}|${l.projectId ?? ""}`;
    const g = grouped.get(key) ?? { accountId: l.accountId, debit: 0, credit: 0, projectId: l.projectId, partnerId: d.partnerId, description: l.description };
    if (kind === "invoice") g.debit = round2(g.debit + amount); else g.credit = round2(g.credit + amount);
    grouped.set(key, g);
  }
  const ledger: LineInput[] = [...grouped.values()];
  if (vat) {
    const vatAcc = await accountIdByCode(tx, companyId, kind === "invoice" ? settings.vatOut : settings.vatIn);
    ledger.push(kind === "invoice" ? { accountId: vatAcc, debit: vat, credit: 0, description: "VAT" } : { accountId: vatAcc, debit: 0, credit: vat, description: "VAT" });
  }
  ledger.unshift(kind === "invoice"
    ? { accountId: partnerAcc, debit: 0, credit: total, partnerId: d.partnerId, description: number }
    : { accountId: partnerAcc, debit: total, credit: 0, partnerId: d.partnerId, description: number });
  const [partner] = await tx.select({ name: schema.partners.name }).from(schema.partners).where(eq(schema.partners.id, d.partnerId));
  const [row] = await tx.insert(schema.creditNotes).values({
    companyId, kind, number, invoiceId: kind === "invoice" ? docId : null, billId: kind === "bill" ? docId : null, partnerId: d.partnerId,
    date: input.date, reason: input.reason.slice(0, 500), supplierRef: input.supplierRef.slice(0, 80), subtotal, vat, total, createdBy: userId,
  }).returning({ id: schema.creditNotes.id });
  const entryId = await saveEntry(tx, companyId, userId, {
    date: input.date, reference: input.supplierRef || number, memo: `${number} - ${d.number} - ${partner?.name ?? ""}`,
    partnerId: d.partnerId, projectId: d.projectId, source: "credit_note", sourceId: row.id, lines: ledger,
  }, true);
  await tx.update(schema.creditNotes).set({ entryId }).where(eq(schema.creditNotes.id, row.id));
  await tx.insert(schema.creditNoteLines).values(chosen.map(({ l, amount }) => ({
    creditNoteId: row.id, lineNo: l.lineNo, description: l.description, accountId: l.accountId, projectId: l.projectId, vatApplies: l.vatApplies && !!docRate, amount,
  })));
  const paid = round2(d.amountPaid + total);
  await tx.update(t).set({ amountPaid: paid, status: paid >= d.total - 0.005 ? "paid" : "partial" }).where(eq(t.id, docId));
  await audit(tx, companyId, userId, "credit_note", kind, d.number, { number, total });
  return row.id;
}

/** Voids a credit note: its entry is reversed and the invoice or bill owes that amount again. */
export async function voidCreditNote(tx: Tx, companyId: string, userId: string, id: string, date: string, memoPrefix: string) {
  const [c] = await tx.select().from(schema.creditNotes).where(and(eq(schema.creditNotes.id, id), eq(schema.creditNotes.companyId, companyId))).for("update");
  if (!c || c.status !== "posted") throw new UserError("err_not_found");
  const t = docTable(c.kind);
  const docId = (c.kind === "invoice" ? c.invoiceId : c.billId)!;
  const [d] = await tx.select().from(t).where(eq(t.id, docId)).for("update");
  if (c.entryId) await reverseEntry(tx, companyId, userId, c.entryId, date, memoPrefix);
  await tx.update(schema.creditNotes).set({ status: "void" }).where(eq(schema.creditNotes.id, id));
  if (d && d.status !== "void") {
    const paid = round2(Math.max(0, d.amountPaid - c.total));
    await tx.update(t).set({ amountPaid: paid, status: paid <= 0.005 ? "open" : paid >= d.total - 0.005 ? "paid" : "partial" }).where(eq(t.id, docId));
  }
  await audit(tx, companyId, userId, "void_credit_note", c.kind, c.number, { total: c.total });
  return c;
}

/** What credit notes took off each document up to a date, for balances "as at". */
export async function creditedAsAt(db: Db | Tx, kind: DocKind, docIds: string[], on: string) {
  const out = new Map<string, number>();
  if (!docIds.length) return out;
  const col = kind === "invoice" ? schema.creditNotes.invoiceId : schema.creditNotes.billId;
  const rows = await db.select({ docId: col, total: schema.creditNotes.total }).from(schema.creditNotes)
    .where(and(inArray(col, docIds), eq(schema.creditNotes.status, "posted"), lte(schema.creditNotes.date, on)));
  for (const r of rows) if (r.docId) out.set(r.docId, round2((out.get(r.docId) ?? 0) + r.total));
  return out;
}
