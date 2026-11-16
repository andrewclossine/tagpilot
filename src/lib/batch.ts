import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Tx } from "@/db";
import { addDays, isIsoDate, round2 } from "./format";
import { UserError } from "./ledger";
import { postDoc, saveDocDraft } from "./documents";
import { makeDeposit, recordExpense } from "./banking";
import { audit } from "./audit";

/** What can be entered many at a time, as in QuickBooks' Batch Enter Transactions. */
export type BatchKind = "invoice" | "bill" | "bank";

/** One row of the grid, as typed or pasted from Excel. */
export type BatchRow = {
  date: string; dueDate: string; direction: string; partner: string; reference: string;
  account: string; description: string; amount: string; vat: boolean; project: string;
};

export type BatchResult = { saved: number; errors: { row: number; message: string }[] };

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** Dates as people type or paste them: 2026-01-15, 15/01/2026, 15-1-2026, 15 Jan 2026, or an Excel serial number. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (isIsoDate(s)) return s;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) { const v = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; return isIsoDate(v) ? v : null; }
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-,]+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) { const v = `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`; return isIsoDate(v) ? v : null; }
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return d.toISOString().slice(0, 10); }
  return null;
}

/** Amounts with thousands separators or a currency word: "1,250,000", "RWF 5 000", "12.50". */
export function parseMoney(raw: string): number {
  const s = raw.replace(/[^\d.,-]/g, "");
  if (!s) return NaN;
  // "1.250.000,50" (comma decimals) or "1,250,000.50"
  const norm = /,\d{1,2}$/.test(s) && s.includes(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  return Number(norm);
}

const yes = (v: unknown) => v === true || /^(y|yes|1|true|x|oui|vat|tva)$/i.test(String(v ?? "").trim());

type Ctx = {
  companyId: string; userId: string; vatRate: number; settings: typeof schema.companies.$inferSelect["settings"];
};

/**
 * Checks every row, then saves them all in one database transaction: either every row is saved or none is, so a
 * mistake in row 37 never leaves rows 1 to 36 half entered. Errors come back per row for the grid to show.
 */
export async function saveBatch(ctx: Ctx, kind: BatchKind, rawRows: BatchRow[], opts: { post: boolean; bankId: string; createPartners: boolean }): Promise<BatchResult> {
  const rows = rawRows.map((r, i) => ({ r, i })).filter(({ r }) => [r.date, r.partner, r.account, r.description, r.amount, r.reference].some((v) => String(v ?? "").trim()));
  if (!rows.length) return { saved: 0, errors: [{ row: -1, message: "err_batch_empty" }] };
  if (rows.length > 500) return { saved: 0, errors: [{ row: -1, message: "err_batch_too_many" }] };
  const db = await getDb();
  const [accounts, projects, partners] = await Promise.all([
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.companyId), eq(schema.accounts.isActive, true))),
    db.select().from(schema.projects).where(eq(schema.projects.companyId, ctx.companyId)),
    db.select().from(schema.partners).where(eq(schema.partners.companyId, ctx.companyId)),
  ]);
  const accountOf = (v: string) => {
    const s = v.trim(); if (!s) return null;
    const code = /^(\S+)/.exec(s)?.[1] ?? "";
    return accounts.find((a) => a.code === code) ?? accounts.find((a) => a.nameEn.toLowerCase() === s.toLowerCase() || a.nameFr.toLowerCase() === s.toLowerCase()) ?? null;
  };
  const projectOf = (v: string) => { const s = v.trim().toUpperCase(); return s ? projects.find((p) => p.code.toUpperCase() === s || p.name.toUpperCase() === s) ?? null : null; };
  const wantKind = kind === "invoice" ? "customer" : "supplier";
  const partnerOf = (v: string) => { const s = v.trim().toLowerCase(); return s ? partners.find((p) => p.name.trim().toLowerCase() === s && (kind === "bank" || p.kind === wantKind || p.kind === "both")) ?? null : null; };
  const okTypes = kind === "invoice" ? ["income", "liability"] : kind === "bill" ? ["expense", "asset"] : ["expense", "asset", "income", "liability", "equity"];

  // 1. Check every row without writing anything.
  const errors: BatchResult["errors"] = [];
  const toCreate = new Set<string>();
  type Ready = { i: number; date: string; dueDate: string | null; out: boolean; partnerName: string; reference: string; account: typeof accounts[number]; description: string; amount: number; vat: boolean; projectId: string | null };
  const ready: Ready[] = [];
  for (const { r, i } of rows) {
    const date = parseDate(r.date);
    if (!date) { errors.push({ row: i, message: "err_batch_date" }); continue; }
    const due = r.dueDate?.trim() ? parseDate(r.dueDate) : null;
    if (r.dueDate?.trim() && (!due || due < date)) { errors.push({ row: i, message: "err_batch_due" }); continue; }
    const amount = round2(parseMoney(String(r.amount ?? "")));
    if (!(amount > 0)) { errors.push({ row: i, message: "err_batch_amount" }); continue; }
    const account = accountOf(String(r.account ?? ""));
    if (!account || !okTypes.includes(account.type) || ["ar", "ap"].includes(account.subtype ?? "") || account.currency || (kind !== "bank" && ["bank", "cash", "momo"].includes(account.subtype ?? ""))) { errors.push({ row: i, message: "err_batch_account" }); continue; }
    const partnerName = String(r.partner ?? "").trim();
    if (kind !== "bank" && !partnerName) { errors.push({ row: i, message: kind === "invoice" ? "err_batch_customer" : "err_batch_supplier" }); continue; }
    if (kind !== "bank" && !partnerOf(partnerName)) {
      if (!opts.createPartners) { errors.push({ row: i, message: kind === "invoice" ? "err_batch_no_customer" : "err_batch_no_supplier" }); continue; }
      toCreate.add(partnerName);
    }
    const project = projectOf(String(r.project ?? ""));
    if (String(r.project ?? "").trim() && !project) { errors.push({ row: i, message: "err_batch_project" }); continue; }
    const dir = String(r.direction ?? "").trim().toLowerCase();
    const out = !/^(in|deposit|received|receipt|entr|dépôt|depot|\+)/.test(dir);
    ready.push({ i, date, dueDate: due, out, partnerName, reference: String(r.reference ?? "").trim().slice(0, 60), account, description: String(r.description ?? "").trim().slice(0, 300), amount, vat: yes(r.vat), projectId: project?.id ?? null });
  }
  if (kind === "bank" && !opts.bankId) errors.push({ row: -1, message: "err_batch_bank" });
  if (errors.length) return { saved: 0, errors };

  // 2. Save them all, or none.
  const ROLLBACK = new Error("batch rollback");
  const failed: BatchResult["errors"] = [];
  try {
    await db.transaction(async (tx: Tx) => {
      const byName = new Map(partners.map((p) => [p.name.trim().toLowerCase(), p]));
      for (const name of toCreate) {
        const [p] = await tx.insert(schema.partners).values({ companyId: ctx.companyId, name, kind: wantKind as "customer" | "supplier" }).returning();
        byName.set(name.toLowerCase(), p);
        await audit(tx, ctx.companyId, ctx.userId, "create", "partner", name, { from: "batch" });
      }
      for (const x of ready) {
        try {
          const p = x.partnerName ? byName.get(x.partnerName.toLowerCase()) ?? null : null;
          const vatApplies = x.vat && ctx.vatRate > 0 && (!p || p.taxCode === "standard");
          if (kind === "bank") {
            const common = { date: x.date, reference: x.reference, memo: x.description || x.partnerName, partnerId: p?.id ?? null, payee: x.partnerName };
            const line = { accountId: x.account.id, amount: x.amount, description: x.description, projectId: x.projectId };
            if (x.out) await recordExpense(tx, ctx.companyId, ctx.userId, opts.bankId, { ...common, attachmentId: null }, [{ ...line, vatApplies }], { rate: vatApplies ? ctx.vatRate : 0, accountCode: ctx.settings.vatIn });
            else await makeDeposit(tx, ctx.companyId, ctx.userId, opts.bankId, common, [line]);
          } else {
            const due = x.dueDate ?? addDays(x.date, p?.paymentTerms || 30);
            const id = await saveDocDraft(tx, kind, ctx.companyId, ctx.userId, undefined, {
              partnerId: p!.id, date: x.date, dueDate: due, notes: "", projectId: x.projectId, supplierRef: kind === "bill" ? x.reference : undefined, whtRate: 0,
            }, [{ description: x.description || x.account.nameEn, quantity: 1, unitPrice: x.amount, vatApplies, accountId: x.account.id, projectId: x.projectId }], ctx.vatRate);
            if (opts.post) await postDoc(tx, kind, ctx.companyId, ctx.userId, id, ctx.settings);
          }
        } catch (e) {
          if (e instanceof UserError) failed.push({ row: x.i, message: e.message });
          else throw e;
        }
      }
      if (failed.length) throw ROLLBACK;
      await audit(tx, ctx.companyId, ctx.userId, "batch_enter", kind, String(ready.length), { post: opts.post });
    });
  } catch (e) {
    if (e === ROLLBACK) return { saved: 0, errors: failed };
    throw e;
  }
  return { saved: ready.length, errors: [] };
}

/** Names and codes the grid suggests while typing. */
export async function batchLists(companyId: string) {
  const db = await getDb();
  const [accounts, projects, partners] = await Promise.all([
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.isActive, true))).orderBy(schema.accounts.code),
    db.select().from(schema.projects).where(and(eq(schema.projects.companyId, companyId), eq(schema.projects.isActive, true))).orderBy(schema.projects.code),
    db.select().from(schema.partners).where(eq(schema.partners.companyId, companyId)).orderBy(schema.partners.name),
  ]);
  const money = accounts.filter((a) => ["bank", "cash", "momo"].includes(a.subtype ?? "") && !a.currency);
  return { accounts, projects, partners, money };
}

