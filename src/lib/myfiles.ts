import "server-only";
import { and, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { FileFolder } from "@/db/schema";
import type { Ctx } from "./auth";
import type { Area } from "./roles";
import { lastDayOfMonth } from "./format";

/** The folders of My Files, in order, and the part of the books each belongs to. */
export const FOLDERS: { key: FileFolder; area: Area }[] = [
  { key: "purchases", area: "purchases" }, { key: "sales", area: "sales" }, { key: "banking", area: "banking" },
  { key: "inventory", area: "inventory" }, { key: "assets", area: "assets" }, { key: "employees", area: "payroll" },
  { key: "reports", area: "reports" },
];
export const isFolder = (s: string): s is FileFolder => FOLDERS.some((f) => f.key === s);
export const folderArea = (f: FileFolder) => FOLDERS.find((x) => x.key === f)!.area;
export const myFolders = (ctx: Ctx) => FOLDERS.filter((f) => ctx.can(f.area));

/** Office files people keep with their books, besides scans and photos. */
export const FILE_TYPES = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword",
];

/**
 * One file in a folder. "upload" was put there by hand; "attachment" is a document attached to a record (a bill's
 * scan); "generated" is a PDF the system prints from the record (an invoice), made fresh each time it is opened.
 */
export type FileItem = {
  id: string; kind: "upload" | "attachment" | "generated"; date: string; month: string;
  name: string; href: string; recordHref?: string; label: string; attachmentId?: string; uploadId?: string;
};

const pdfName = (s: string) => `${s.replace(/[\\/:*?"<>|]+/g, "-").trim()}.pdf`;
const monthOf = (date: string) => date.slice(0, 7);

/** Every file of a folder dated within the given months (YYYY-MM, inclusive), newest first. */
export async function folderFiles(ctx: Ctx, folder: FileFolder, fromMonth: string, toMonth: string): Promise<FileItem[]> {
  const db = await getDb();
  const c = ctx.company.id;
  const from = `${fromMonth}-01`, to = lastDayOfMonth(toMonth); // the real last day: February has no 31st
  const items: FileItem[] = [];
  const att = async (ids: string[]) => {
    const rows = ids.length ? await db.select().from(schema.attachments).where(and(eq(schema.attachments.companyId, c), inArray(schema.attachments.id, ids))) : [];
    return new Map(rows.map((a) => [a.id, a]));
  };
  const partnersOf = async (ids: string[]) => {
    const rows = ids.length ? await db.select({ id: schema.partners.id, name: schema.partners.name }).from(schema.partners).where(inArray(schema.partners.id, [...new Set(ids)])) : [];
    return new Map(rows.map((p) => [p.id, p.name]));
  };
  /** Supporting documents of journal entries of some sources, as attachments. */
  const entryFiles = async (sources: (typeof schema.journalEntries.$inferSelect.source)[], label: string) => {
    const rows = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.companyId, c), inArray(schema.journalEntries.source, sources),
      isNotNull(schema.journalEntries.attachmentId), gte(schema.journalEntries.date, from), lte(schema.journalEntries.date, to)));
    const a = await att(rows.map((r) => r.attachmentId!));
    for (const r of rows) {
      const f = a.get(r.attachmentId!);
      if (f) items.push({ id: `je-${r.id}`, kind: "attachment", date: r.date, month: monthOf(r.date), name: `${r.date} ${r.reference || r.number} - ${f.fileName}`, href: `/api/files/${f.id}`, recordHref: `/journal/${r.id}`, label, attachmentId: f.id });
    }
  };

  if (folder === "sales") {
    const inv = await db.select().from(schema.invoices).where(and(eq(schema.invoices.companyId, c), ne(schema.invoices.status, "draft"), gte(schema.invoices.date, from), lte(schema.invoices.date, to)));
    const pro = await db.select().from(schema.proformas).where(and(eq(schema.proformas.companyId, c), gte(schema.proformas.date, from), lte(schema.proformas.date, to)));
    const cn = await db.select().from(schema.creditNotes).where(and(eq(schema.creditNotes.companyId, c), eq(schema.creditNotes.kind, "invoice"), gte(schema.creditNotes.date, from), lte(schema.creditNotes.date, to)));
    const names = await partnersOf([...inv, ...pro, ...cn].map((x) => x.partnerId));
    for (const x of inv) {
      const receipt = x.docType === "receipt";
      items.push({ id: `inv-${x.id}`, kind: "generated", date: x.date, month: monthOf(x.date), name: pdfName(`${x.number} ${names.get(x.partnerId) ?? ""}`), href: `/api/pdf/invoice/${x.id}`, recordHref: `${receipt ? "/sales/receipts" : "/sales/invoices"}/${x.id}`, label: receipt ? "mf_k_receipt" : "mf_k_invoice" });
    }
    for (const x of pro) items.push({ id: `pro-${x.id}`, kind: "generated", date: x.date, month: monthOf(x.date), name: pdfName(`${x.number} ${names.get(x.partnerId) ?? ""}`), href: `/api/pdf/proforma/${x.id}`, recordHref: `/sales/proformas/${x.id}`, label: "mf_k_proforma" });
    for (const x of cn) items.push({ id: `cn-${x.id}`, kind: "generated", date: x.date, month: monthOf(x.date), name: pdfName(`${x.number} ${names.get(x.partnerId) ?? ""}`), href: `/api/pdf/credit-note/${x.id}`, label: "mf_k_credit_note" });
  }

  if (folder === "purchases") {
    const bills = await db.select().from(schema.bills).where(and(eq(schema.bills.companyId, c), isNotNull(schema.bills.attachmentId), gte(schema.bills.date, from), lte(schema.bills.date, to)));
    const grs = await db.select().from(schema.goodsReceipts).where(and(eq(schema.goodsReceipts.companyId, c), isNotNull(schema.goodsReceipts.attachmentId), gte(schema.goodsReceipts.date, from), lte(schema.goodsReceipts.date, to)));
    const sbs = await db.select().from(schema.supplierBills).where(and(eq(schema.supplierBills.companyId, c), isNotNull(schema.supplierBills.attachmentId), gte(schema.supplierBills.date, from), lte(schema.supplierBills.date, to)));
    const pos = await db.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.companyId, c), ne(schema.purchaseOrders.status, "draft"), gte(schema.purchaseOrders.date, from), lte(schema.purchaseOrders.date, to)));
    const a = await att([...bills, ...grs, ...sbs].map((x) => x.attachmentId!));
    const names = await partnersOf([...bills, ...grs, ...sbs, ...pos].map((x) => x.partnerId));
    for (const x of bills) { const f = a.get(x.attachmentId!); if (f) items.push({ id: `bill-${x.id}`, kind: "attachment", date: x.date, month: monthOf(x.date), name: `${x.number} ${names.get(x.partnerId) ?? ""} - ${f.fileName}`, href: `/api/files/${f.id}`, recordHref: `/purchases/bills/${x.id}`, label: "mf_k_bill", attachmentId: f.id }); }
    for (const x of grs) { const f = a.get(x.attachmentId!); if (f) items.push({ id: `gr-${x.id}`, kind: "attachment", date: x.date, month: monthOf(x.date), name: `${x.number} ${names.get(x.partnerId) ?? ""} - ${f.fileName}`, href: `/api/files/${f.id}`, label: "mf_k_delivery", attachmentId: f.id }); }
    for (const x of sbs) { const f = a.get(x.attachmentId!); if (f) items.push({ id: `sb-${x.id}`, kind: "attachment", date: x.date, month: monthOf(x.date), name: `${x.reference} ${names.get(x.partnerId) ?? ""} - ${f.fileName}`, href: `/api/files/${f.id}`, label: "mf_k_supplier_bill", attachmentId: f.id }); }
    for (const x of pos) items.push({ id: `po-${x.id}`, kind: "generated", date: x.date, month: monthOf(x.date), name: pdfName(`${x.number} ${names.get(x.partnerId) ?? ""}`), href: `/api/pdf/po/${x.id}`, recordHref: `/procurement/orders/${x.id}`, label: "mf_k_po" });
    await entryFiles(["expense", "bill_payment"], "mf_k_expense");
  }

  if (folder === "banking") {
    const checks = await db.select().from(schema.bankTransactions).where(and(eq(schema.bankTransactions.companyId, c), eq(schema.bankTransactions.kind, "check"), gte(schema.bankTransactions.date, from), lte(schema.bankTransactions.date, to)));
    for (const x of checks) items.push({ id: `chk-${x.id}`, kind: "generated", date: x.date, month: monthOf(x.date), name: pdfName(`Cheque ${x.number} ${x.payee}`), href: `/api/pdf/check/${x.id}`, recordHref: `/journal/${x.entryId}`, label: "mf_k_check" });
    await entryFiles(["bank", "deposit", "transfer", "check", "fx", "invoice_payment"], "mf_k_bank_doc");
  }

  if (folder === "employees") {
    const runs = await db.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.companyId, c), gte(schema.payrollRuns.month, fromMonth), lte(schema.payrollRuns.month, toMonth)));
    for (const r of runs) {
      r.rows.forEach((row, i) => {
        const name = (row as { name?: string }).name ?? `#${i + 1}`;
        items.push({ id: `ps-${r.id}-${i}`, kind: "generated", date: `${r.month}-28`, month: r.month, name: pdfName(`Payslip ${r.month} ${name}`), href: `/api/pdf/payslip?run=${r.id}&row=${i}`, recordHref: "/payroll", label: "mf_k_payslip" });
      });
    }
  }

  if (folder === "reports") {
    const sets = await db.select().from(schema.fsDrafts).where(and(eq(schema.fsDrafts.companyId, c), gte(schema.fsDrafts.periodTo, from), lte(schema.fsDrafts.periodTo, to)));
    for (const s of sets) items.push({ id: `fs-${s.id}`, kind: "generated", date: s.periodTo, month: monthOf(s.periodTo), name: pdfName(s.title), href: `/api/pdf/fs/${s.id}`, recordHref: `/financial-statements/${s.id}`, label: "mf_k_fs" });
  }

  // Files put in by hand, in every folder.
  const ups = await db.select({ u: schema.fileUploads, a: schema.attachments }).from(schema.fileUploads)
    .innerJoin(schema.attachments, eq(schema.attachments.id, schema.fileUploads.attachmentId))
    .where(and(eq(schema.fileUploads.companyId, c), eq(schema.fileUploads.folder, folder), gte(schema.fileUploads.month, fromMonth), lte(schema.fileUploads.month, toMonth)));
  for (const { u, a } of ups) items.push({ id: `up-${u.id}`, kind: "upload", date: u.createdAt.toISOString().slice(0, 10), month: u.month, name: a.fileName, href: `/api/files/${a.id}`, label: "mf_k_upload", attachmentId: a.id, uploadId: u.id });

  return items.sort((x, y) => (x.date === y.date ? x.name.localeCompare(y.name) : y.date.localeCompare(x.date)));
}

/** Names inside a zip must be unique and safe. */
export function uniqueNames(items: FileItem[]) {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const clean = it.name.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 150);
    const n = seen.get(clean) ?? 0;
    seen.set(clean, n + 1);
    if (!n) return clean;
    const dot = clean.lastIndexOf(".");
    return dot > 0 ? `${clean.slice(0, dot)} (${n + 1})${clean.slice(dot)}` : `${clean} (${n + 1})`;
  });
}
