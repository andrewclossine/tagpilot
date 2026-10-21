import "server-only";
import { and, count, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { schema } from "@/db";
import { round2 } from "./format";
import { accountIdByCode, reverseEntry, saveEntry, UserError, type LineInput } from "./ledger";
import { audit } from "./audit";

/** Invoices (sales) and bills (purchases) share one engine; `kind` picks the tables and the accounting. */
export type DocKind = "invoice" | "bill";

export type DocLineInput = { description: string; quantity: number; unitPrice: number; vatApplies: boolean; accountId: string; projectId: string | null };
export type DocHeader = {
  partnerId: string; date: string; dueDate: string; notes: string; projectId: string | null;
  supplierRef?: string; whtRate?: number; attachmentId?: string | null;
};

const tables = (kind: DocKind) => kind === "invoice"
  ? { doc: schema.invoices, lines: schema.invoiceLines, fk: "invoiceId" as const, fkCol: schema.invoiceLines.invoiceId, prefix: "INV-" }
  : { doc: schema.bills, lines: schema.billLines, fk: "billId" as const, fkCol: schema.billLines.billId, prefix: "BILL-" };

export function computeTotals(lines: DocLineInput[], vatRate: number) {
  const out = lines.map((l) => ({ ...l, amount: round2(l.quantity * l.unitPrice) }));
  const subtotal = round2(out.reduce((s, l) => s + l.amount, 0));
  const vat = round2(out.reduce((s, l) => s + (l.vatApplies ? round2((l.amount * vatRate) / 100) : 0), 0));
  return { lines: out, subtotal, vat, total: round2(subtotal + vat) };
}

async function nextNumber(tx: Tx, kind: DocKind, companyId: string) {
  const t = tables(kind);
  const [{ n }] = await tx.select({ n: count() }).from(t.doc).where(eq(t.doc.companyId, companyId));
  return `${t.prefix}${String(n + 1).padStart(4, "0")}`;
}

export async function getDoc(tx: Tx, kind: DocKind, companyId: string, id: string) {
  const t = tables(kind);
  const [d] = await tx.select().from(t.doc).where(and(eq(t.doc.id, id), eq(t.doc.companyId, companyId)));
  if (!d) throw new UserError("err_not_found");
  return d as typeof schema.bills.$inferSelect & typeof schema.invoices.$inferSelect;
}

/** Creates or updates a draft document. Returns its id. */
export async function saveDocDraft(tx: Tx, kind: DocKind, companyId: string, userId: string, id: string | undefined, h: DocHeader, lines: DocLineInput[], vatRate: number) {
  const t = tables(kind);
  const totals = computeTotals(lines, vatRate);
  const values = {
    partnerId: h.partnerId, date: h.date, dueDate: h.dueDate, notes: h.notes, projectId: h.projectId,
    subtotal: totals.subtotal, vat: totals.vat, total: totals.total,
    ...(kind === "bill" ? { supplierRef: h.supplierRef ?? "", whtRate: h.whtRate ?? 0, attachmentId: h.attachmentId ?? null } : {}),
  };
  if (id) {
    const d = await getDoc(tx, kind, companyId, id);
    if (d.status !== "draft") throw new UserError("err_posted_locked");
    await tx.update(t.doc).set(values).where(eq(t.doc.id, id));
    await tx.delete(t.lines).where(eq(t.fkCol, id));
  } else {
    const [row] = await tx.insert(t.doc).values({ ...values, companyId, number: await nextNumber(tx, kind, companyId), status: "draft" })
      .returning({ id: t.doc.id });
    id = row.id;
  }
  await tx.insert(t.lines).values(totals.lines.map((l, i) => ({
    [t.fk]: id!, lineNo: i + 1, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice,
    vatApplies: l.vatApplies, accountId: l.accountId, projectId: l.projectId || h.projectId || null, amount: l.amount,
  })) as never);
  await audit(tx, companyId, userId, "save_draft", kind, id);
  return id;
}

/** Issues an invoice or approves a bill: posts it to the ledger and opens it for payment. */
export async function postDoc(tx: Tx, kind: DocKind, companyId: string, userId: string, id: string, settings: typeof schema.companies.$inferSelect["settings"]) {
  const t = tables(kind);
  const d = await getDoc(tx, kind, companyId, id);
  if (d.status !== "draft") throw new UserError("err_posted_locked");
  const docLines = await tx.select().from(t.lines).where(eq(t.fkCol, id));
  if (!docLines.length || d.total <= 0) throw new UserError("err_no_lines");

  // One ledger line per account and project, plus VAT and the partner's balance.
  const grouped = new Map<string, LineInput>();
  for (const l of docLines) {
    const key = `${l.accountId}|${l.projectId ?? ""}`;
    const g = grouped.get(key) ?? { accountId: l.accountId, debit: 0, credit: 0, projectId: l.projectId, partnerId: d.partnerId, description: l.description };
    if (kind === "invoice") g.credit = round2(g.credit + l.amount); else g.debit = round2(g.debit + l.amount);
    grouped.set(key, g);
  }
  const lines = [...grouped.values()];
  const partnerAcc = await accountIdByCode(tx, companyId, kind === "invoice" ? settings.arAccount : settings.apAccount);
  if (d.vat) {
    const vatAcc = await accountIdByCode(tx, companyId, kind === "invoice" ? settings.vatOut : settings.vatIn);
    lines.push(kind === "invoice"
      ? { accountId: vatAcc, debit: 0, credit: d.vat, description: "VAT" }
      : { accountId: vatAcc, debit: d.vat, credit: 0, description: "VAT" });
  }
  lines.unshift(kind === "invoice"
    ? { accountId: partnerAcc, debit: d.total, credit: 0, partnerId: d.partnerId, description: d.number }
    : { accountId: partnerAcc, debit: 0, credit: d.total, partnerId: d.partnerId, description: d.number });

  const [partner] = await tx.select({ name: schema.partners.name }).from(schema.partners).where(eq(schema.partners.id, d.partnerId));
  const entryId = await saveEntry(tx, companyId, userId, {
    date: d.date, reference: kind === "bill" && d.supplierRef ? d.supplierRef : d.number,
    memo: `${d.number} - ${partner?.name ?? ""}`, partnerId: d.partnerId, projectId: d.projectId,
    source: kind, sourceId: d.id, attachmentId: kind === "bill" ? d.attachmentId : null, lines,
  }, true);
  await tx.update(t.doc).set({ status: "open", entryId }).where(eq(t.doc.id, id));
  await audit(tx, companyId, userId, kind === "invoice" ? "issue" : "approve", kind, id, { total: d.total });
}

/** Records money received for an invoice or paid for a bill (withholding tax is kept back on bills). */
export async function payDoc(tx: Tx, kind: DocKind, companyId: string, userId: string, id: string,
  p: { date: string; amount: number; moneyAccountId: string; reference: string }, settings: typeof schema.companies.$inferSelect["settings"]) {
  const t = tables(kind);
  const d = await getDoc(tx, kind, companyId, id);
  if (d.status !== "open" && d.status !== "partial") throw new UserError("err_not_found");
  const amount = round2(p.amount);
  if (amount <= 0) throw new UserError("err_amount");
  if (amount > round2(d.total - d.amountPaid) + 0.005) throw new UserError("err_overpay");
  const [money] = await tx.select().from(schema.accounts).where(and(eq(schema.accounts.id, p.moneyAccountId), eq(schema.accounts.companyId, companyId)));
  if (!money) throw new UserError("err_account");
  const partnerAcc = await accountIdByCode(tx, companyId, kind === "invoice" ? settings.arAccount : settings.apAccount);

  let wht = 0;
  const lines: LineInput[] = [];
  if (kind === "invoice") {
    lines.push({ accountId: money.id, debit: amount, credit: 0 }, { accountId: partnerAcc, debit: 0, credit: amount, partnerId: d.partnerId });
  } else {
    // Withholding tax applies to the amount before VAT, in proportion to what is being settled.
    wht = d.whtRate ? round2((amount * (d.subtotal / d.total) * d.whtRate) / 100) : 0;
    lines.push({ accountId: partnerAcc, debit: amount, credit: 0, partnerId: d.partnerId }, { accountId: money.id, debit: 0, credit: round2(amount - wht) });
    if (wht) lines.push({ accountId: await accountIdByCode(tx, companyId, settings.whtAccount), debit: 0, credit: wht, partnerId: d.partnerId, description: "WHT" });
  }
  const [partner] = await tx.select({ name: schema.partners.name }).from(schema.partners).where(eq(schema.partners.id, d.partnerId));
  const entryId = await saveEntry(tx, companyId, userId, {
    date: p.date, reference: p.reference || d.number, memo: `${kind === "invoice" ? "Receipt" : "Payment"} ${d.number} - ${partner?.name ?? ""}`,
    partnerId: d.partnerId, projectId: d.projectId, source: kind === "invoice" ? "invoice_payment" : "bill_payment", sourceId: d.id, lines,
  }, true);
  await tx.insert(schema.payments).values({
    companyId, kind: kind === "invoice" ? "receipt" : "payment", invoiceId: kind === "invoice" ? id : null, billId: kind === "bill" ? id : null,
    date: p.date, amount, wht, moneyAccountId: money.id, reference: p.reference, entryId,
  });
  const paid = round2(d.amountPaid + amount);
  await tx.update(t.doc).set({ amountPaid: paid, status: paid >= d.total - 0.005 ? "paid" : "partial" }).where(eq(t.doc.id, id));
  await audit(tx, companyId, userId, "payment", kind, id, { amount, wht });
}

/** Voids an unpaid document: drafts are simply marked void, posted ones are reversed in the ledger. */
export async function voidDoc(tx: Tx, kind: DocKind, companyId: string, userId: string, id: string, date: string, memoPrefix: string) {
  const t = tables(kind);
  const d = await getDoc(tx, kind, companyId, id);
  if (d.amountPaid > 0 || d.status === "void") throw new UserError("err_posted_locked");
  if (d.entryId) await reverseEntry(tx, companyId, userId, d.entryId, date, memoPrefix);
  await tx.update(t.doc).set({ status: "void" }).where(eq(t.doc.id, id));
  await audit(tx, companyId, userId, "void", kind, id);
}
