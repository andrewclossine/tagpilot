import "server-only";
import { and, eq, lte } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import type { RecurringEvery, RecurringKind, RecurringPayload } from "@/db/schema";
import { addDays, daysBetween, today } from "./format";
import { postDoc, saveDocDraft } from "./documents";
import { saveEntry, UserError } from "./ledger";
import { audit } from "./audit";

export type Template = typeof schema.recurringTemplates.$inferSelect;
export const EVERY: RecurringEvery[] = ["week", "month", "quarter", "year"];

/** The next date after one, keeping the day of the month (31 January, then 28 February, then 31 March). */
export function nextAfter(date: string, every: RecurringEvery, anchorDay = Number(date.slice(8, 10))): string {
  if (every === "week") return addDays(date, 7);
  const months = every === "month" ? 1 : every === "quarter" ? 3 : 12;
  const [y, m] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(anchorDay, last)).padStart(2, "0")}`;
}

/** Makes a schedule from a posted or draft invoice or bill, or from a journal entry. */
export async function templateFrom(tx: Tx, companyId: string, kind: RecurringKind, sourceId: string): Promise<{ name: string; payload: RecurringPayload }> {
  if (kind === "journal") {
    const [e] = await tx.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, sourceId), eq(schema.journalEntries.companyId, companyId)));
    if (!e) throw new UserError("err_not_found");
    const lines = await tx.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, sourceId)).orderBy(schema.journalLines.lineNo);
    return {
      name: e.memo || e.reference || "Journal entry",
      payload: { reference: e.reference, memo: e.memo, partnerId: e.partnerId, projectId: e.projectId, journalLines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description, projectId: l.projectId, partnerId: l.partnerId })) },
    };
  }
  const doc = kind === "invoice" ? schema.invoices : schema.bills;
  const [d] = await tx.select().from(doc).where(and(eq(doc.id, sourceId), eq(doc.companyId, companyId)));
  if (!d || d.status === "void") throw new UserError("err_not_found");
  const lines = kind === "invoice"
    ? await tx.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, sourceId)).orderBy(schema.invoiceLines.lineNo)
    : await tx.select().from(schema.billLines).where(eq(schema.billLines.billId, sourceId)).orderBy(schema.billLines.lineNo);
  const [p] = await tx.select({ name: schema.partners.name }).from(schema.partners).where(eq(schema.partners.id, d.partnerId));
  const bill = kind === "bill" ? (d as typeof schema.bills.$inferSelect) : null;
  return {
    name: `${p?.name ?? ""} - ${lines[0]?.description ?? d.number}`.slice(0, 120),
    payload: {
      partnerId: d.partnerId, projectId: d.projectId, notes: d.notes, termDays: Math.max(0, daysBetween(d.date, d.dueDate)),
      supplierRef: bill?.supplierRef ?? "", whtRate: bill?.whtRate ?? 0,
      docLines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, vatApplies: l.vatApplies, accountId: l.accountId, projectId: l.projectId, itemId: l.itemId })),
    },
  };
}

type Company = typeof schema.companies.$inferSelect;

/** Makes one occurrence of a schedule on its date: the document or entry, posted or left as a draft. */
async function makeOne(tx: Tx, company: Company, userId: string, t: Template, date: string) {
  const p = t.payload;
  if (t.kind === "journal") {
    return saveEntry(tx, company.id, userId, {
      date, reference: p.reference ?? "", memo: `${p.memo || t.name}`, partnerId: p.partnerId ?? null, projectId: p.projectId ?? null, source: "manual",
      lines: (p.journalLines ?? []).map((l) => ({ ...l })),
    }, t.autoPost);
  }
  const vatRate = company.vatRegistered ? company.vatRate : 0;
  const id = await saveDocDraft(tx, t.kind, company.id, userId, undefined, {
    partnerId: p.partnerId!, date, dueDate: addDays(date, p.termDays ?? 30), notes: p.notes ?? "", projectId: p.projectId ?? null,
    supplierRef: p.supplierRef ?? "", whtRate: p.whtRate ?? 0,
  }, (p.docLines ?? []).map((l) => ({ ...l })), vatRate);
  if (t.autoPost) await postDoc(tx, t.kind, company.id, userId, id, company.settings);
  return id;
}

/**
 * Makes everything due up to a date for one company, catching up on missed dates. A schedule that fails (a customer
 * deleted, not enough stock) keeps its date and shows the error, and the others go on.
 */
export async function runRecurring(db: Db, company: Company, userId: string | null, upTo = today()) {
  const due = await db.select().from(schema.recurringTemplates)
    .where(and(eq(schema.recurringTemplates.companyId, company.id), eq(schema.recurringTemplates.status, "active"), lte(schema.recurringTemplates.nextDate, upTo)));
  let made = 0, failed = 0;
  // Someone must be the author: the person who set the schedule up.
  for (const t of due) {
    const author = userId ?? t.createdBy;
    if (!author) continue;
    const anchor = Number(t.nextDate.slice(8, 10));
    let date = t.nextDate;
    for (let guard = 0; guard < 60 && date <= upTo && (!t.endDate || date <= t.endDate); guard++) {
      try {
        await db.transaction(async (tx) => {
          await makeOne(tx, company, author, t, date);
          const next = nextAfter(date, t.every, anchor);
          const ended = !!t.endDate && next > t.endDate;
          await tx.update(schema.recurringTemplates).set({ nextDate: next, lastDate: date, made: t.made + 1, lastError: "", status: ended ? "ended" : "active" })
            .where(eq(schema.recurringTemplates.id, t.id));
          await audit(tx, company.id, author, "recurring", t.kind, t.name, { date });
          t.made++;
          date = next;
        });
        made++;
      } catch (e) {
        await db.update(schema.recurringTemplates).set({ lastError: e instanceof UserError ? e.message : "err_generic" }).where(eq(schema.recurringTemplates.id, t.id));
        failed++;
        break;
      }
    }
  }
  return { made, failed };
}
