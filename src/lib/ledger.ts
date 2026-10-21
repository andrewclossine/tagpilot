import "server-only";
import { and, eq, gte, inArray, isNull, lte, max, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import type { AiInfo, EntrySource } from "@/db/schema";
import { round2 } from "./format";
import { audit } from "./audit";

/** An error whose message is an i18n key the page can show to the user. */
export class UserError extends Error {}

export type LineInput = {
  accountId: string; debit: number; credit: number; description?: string;
  projectId?: string | null; partnerId?: string | null;
};

export type EntryInput = {
  id?: string;
  date: string; reference?: string; memo?: string;
  partnerId?: string | null; projectId?: string | null;
  lines: LineInput[];
  source?: EntrySource; sourceId?: string | null;
  attachmentId?: string | null;
  ai?: AiInfo | null;
  reversesId?: string | null;
};

export function cleanLines(lines: LineInput[]): LineInput[] {
  return lines
    .map((l) => ({ ...l, debit: round2(l.debit), credit: round2(l.credit) }))
    .filter((l) => l.accountId && (l.debit || l.credit));
}

/** Returns an i18n key describing what is wrong, or null when the lines can be posted. */
export function checkLines(lines: LineInput[]): string | null {
  if (lines.length < 2) return "err_lines";
  if (lines.some((l) => l.debit < 0 || l.credit < 0 || (l.debit && l.credit))) return "err_line_side";
  const d = round2(lines.reduce((s, l) => s + l.debit, 0)), c = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (d !== c) return "err_unbalanced";
  return null;
}

async function assertAccounts(tx: Tx, companyId: string, lines: LineInput[]) {
  const ids = [...new Set(lines.map((l) => l.accountId))];
  if (!ids.length) return;
  const found = await tx.select({ id: schema.accounts.id }).from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, companyId), inArray(schema.accounts.id, ids)));
  if (found.length !== ids.length) throw new UserError("err_account");
}

/** Creates or replaces an entry. With `post`, it is validated, numbered and locked. */
export async function saveEntry(tx: Tx, companyId: string, userId: string, input: EntryInput, post: boolean): Promise<string> {
  const lines = cleanLines(input.lines);
  if (post) { const err = checkLines(lines); if (err) throw new UserError(err); }
  await assertAccounts(tx, companyId, lines);

  let id = input.id;
  const values = {
    date: input.date, reference: input.reference ?? "", memo: input.memo ?? "",
    partnerId: input.partnerId || null, projectId: input.projectId || null,
    source: input.source ?? "manual", sourceId: input.sourceId ?? null,
    attachmentId: input.attachmentId ?? null, ai: input.ai ?? null, reversesId: input.reversesId ?? null,
  };
  if (id) {
    const [old] = await tx.select().from(schema.journalEntries)
      .where(and(eq(schema.journalEntries.id, id), eq(schema.journalEntries.companyId, companyId)));
    if (!old) throw new UserError("err_not_found");
    if (old.status === "posted") throw new UserError("err_posted_locked");
    await tx.update(schema.journalEntries).set({ ...values, attachmentId: input.attachmentId ?? old.attachmentId, ai: input.ai ?? old.ai })
      .where(eq(schema.journalEntries.id, id));
    await tx.delete(schema.journalLines).where(eq(schema.journalLines.entryId, id));
  } else {
    const [row] = await tx.insert(schema.journalEntries).values({ ...values, companyId, status: "draft", createdBy: userId })
      .returning({ id: schema.journalEntries.id });
    id = row.id;
  }
  if (lines.length) {
    await tx.insert(schema.journalLines).values(lines.map((l, i) => ({
      entryId: id!, companyId, lineNo: i + 1, accountId: l.accountId, debit: l.debit, credit: l.credit,
      description: l.description ?? "", projectId: l.projectId || input.projectId || null, partnerId: l.partnerId || input.partnerId || null,
    })));
  }
  if (post) await markPosted(tx, companyId, userId, id);
  await audit(tx, companyId, userId, post ? "post" : "save_draft", "journal_entry", id, { memo: values.memo });
  return id;
}

async function markPosted(tx: Tx, companyId: string, userId: string, id: string) {
  const [{ n }] = await tx.select({ n: max(schema.journalEntries.number) }).from(schema.journalEntries)
    .where(eq(schema.journalEntries.companyId, companyId));
  await tx.update(schema.journalEntries)
    .set({ status: "posted", number: (n ?? 0) + 1, postedBy: userId, postedAt: new Date() })
    .where(eq(schema.journalEntries.id, id));
}

/** Posts an existing draft after checking its lines. */
export async function postDraft(tx: Tx, companyId: string, userId: string, id: string) {
  const [e] = await tx.select().from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.id, id), eq(schema.journalEntries.companyId, companyId)));
  if (!e) throw new UserError("err_not_found");
  if (e.status === "posted") return;
  const lines = await tx.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, id));
  const err = checkLines(lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })));
  if (err) throw new UserError(err);
  await markPosted(tx, companyId, userId, id);
  await audit(tx, companyId, userId, "post", "journal_entry", id);
}

/** Posts the mirror image of a posted entry and links both. Posted entries are never edited or deleted. */
export async function reverseEntry(tx: Tx, companyId: string, userId: string, id: string, date: string, memoPrefix: string): Promise<string> {
  const [e] = await tx.select().from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.id, id), eq(schema.journalEntries.companyId, companyId)));
  if (!e || e.status !== "posted") throw new UserError("err_not_found");
  if (e.reversedById) throw new UserError("err_already_reversed");
  const lines = await tx.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, id)).orderBy(schema.journalLines.lineNo);
  const newId = await saveEntry(tx, companyId, userId, {
    date, reference: e.reference, memo: `${memoPrefix} #${e.number}: ${e.memo}`, partnerId: e.partnerId, projectId: e.projectId,
    source: "reversal", sourceId: e.id, reversesId: e.id, attachmentId: e.attachmentId,
    lines: lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description, projectId: l.projectId, partnerId: l.partnerId })),
  }, true);
  await tx.update(schema.journalEntries).set({ reversedById: newId }).where(eq(schema.journalEntries.id, id));
  return newId;
}

export async function deleteDraft(tx: Tx, companyId: string, userId: string, id: string) {
  const [e] = await tx.select().from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.id, id), eq(schema.journalEntries.companyId, companyId)));
  if (!e) return;
  if (e.status === "posted") throw new UserError("err_posted_locked");
  await tx.delete(schema.journalEntries).where(eq(schema.journalEntries.id, id));
  await audit(tx, companyId, userId, "delete_draft", "journal_entry", id, { memo: e.memo });
}

export async function accountIdByCode(db: Db | Tx, companyId: string, code: string): Promise<string> {
  const [a] = await db.select({ id: schema.accounts.id }).from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.code, code)));
  if (!a) throw new UserError("err_settings_account");
  return a.id;
}

/** Net movement (debit minus credit) per account over posted entries in a date range. */
export async function balances(db: Db | Tx, companyId: string, opts: { from?: string; to?: string; projectId?: string | null } = {}) {
  const conds = [eq(schema.journalEntries.companyId, companyId), eq(schema.journalEntries.status, "posted")];
  if (opts.from) conds.push(gte(schema.journalEntries.date, opts.from));
  if (opts.to) conds.push(lte(schema.journalEntries.date, opts.to));
  if (opts.projectId === null) conds.push(isNull(schema.journalLines.projectId));
  else if (opts.projectId) conds.push(eq(schema.journalLines.projectId, opts.projectId));
  const rows = await db.select({
    accountId: schema.journalLines.accountId,
    debit: sql<string>`coalesce(sum(${schema.journalLines.debit}), 0)`,
    credit: sql<string>`coalesce(sum(${schema.journalLines.credit}), 0)`,
  }).from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(and(...conds)).groupBy(schema.journalLines.accountId);
  return new Map(rows.map((r) => [r.accountId, { debit: Number(r.debit), credit: Number(r.credit), net: round2(Number(r.debit) - Number(r.credit)) }]));
}

export async function listAccounts(db: Db | Tx, companyId: string) {
  return db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId)).orderBy(schema.accounts.code);
}

export async function moneyAccounts(db: Db | Tx, companyId: string) {
  return db.select().from(schema.accounts).where(and(
    eq(schema.accounts.companyId, companyId),
    or(eq(schema.accounts.subtype, "bank"), eq(schema.accounts.subtype, "cash"), eq(schema.accounts.subtype, "momo")),
  )).orderBy(schema.accounts.code);
}
