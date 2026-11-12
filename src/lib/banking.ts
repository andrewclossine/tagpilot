import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import { audit } from "./audit";
import { round2 } from "./format";
import { accountIdByCode, balances, saveEntry, UserError, type LineInput } from "./ledger";
import { nextNumber } from "./numbering";

export type BankLine = { accountId: string; amount: number; description: string; projectId: string | null };
type Common = { date: string; reference: string; memo: string; partnerId: string | null; payee: string };

const MONEY = ["bank", "cash", "momo"];

export const FX_GAIN_CODE = "4850";
export const FX_LOSS_CODE = "6850";

async function accountsOf(tx: Tx, companyId: string, ids: string[]) {
  const rows = ids.length ? await tx.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), inArray(schema.accounts.id, ids))) : [];
  return new Map(rows.map((a) => [a.id, a]));
}

/** A money account in the company's own currency: foreign currency accounts have their own page. */
async function homeBank(tx: Tx, companyId: string, id: string) {
  const a = (await accountsOf(tx, companyId, [id])).get(id);
  if (!a || !MONEY.includes(a.subtype ?? "")) throw new UserError("err_account");
  if (a.currency) throw new UserError("err_fx_account");
  return a;
}

/** Customers and suppliers are followed through their invoices and bills, so these forms must not post to those accounts directly. */
async function checkLines(tx: Tx, companyId: string, bankId: string, lines: BankLine[], allowMoney: boolean) {
  if (!lines.length) throw new UserError("err_required");
  const found = await accountsOf(tx, companyId, lines.map((l) => l.accountId));
  for (const l of lines) {
    const a = found.get(l.accountId);
    if (!a) throw new UserError("err_account");
    if (a.subtype === "ar" || a.subtype === "ap") throw new UserError("err_use_bills");
    if (l.accountId === bankId) throw new UserError("err_same_account");
    if (!allowMoney && MONEY.includes(a.subtype ?? "")) throw new UserError("err_use_transfer");
  }
}

async function register(tx: Tx, values: typeof schema.bankTransactions.$inferInsert) {
  const [row] = await tx.insert(schema.bankTransactions).values(values).returning({ id: schema.bankTransactions.id });
  return row.id;
}

/** The next cheque number of a bank account. The lock makes two people writing cheques wait for each other. */
export async function nextCheckNumber(tx: Tx, companyId: string, bankId: string): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${companyId}:CHK:${bankId}`}))`);
  const [row] = await tx.select({ n: sql<string>`coalesce(max(case when ${schema.bankTransactions.number} ~ '^[0-9]{1,15}$' then ${schema.bankTransactions.number}::bigint end), 0)` })
    .from(schema.bankTransactions)
    .where(and(eq(schema.bankTransactions.companyId, companyId), eq(schema.bankTransactions.accountId, bankId), eq(schema.bankTransactions.kind, "check")));
  return String(Number(row?.n ?? 0) + 1);
}

/** A cheque: debit each line, credit the bank. A number already used on this bank is refused, even if that cheque was voided. */
export async function writeCheck(tx: Tx, companyId: string, userId: string, bankId: string, c: Common, lines: BankLine[]) {
  await homeBank(tx, companyId, bankId);
  await checkLines(tx, companyId, bankId, lines, false);
  const number = c.reference || await nextCheckNumber(tx, companyId, bankId);
  const [used] = await tx.select({ id: schema.bankTransactions.id }).from(schema.bankTransactions)
    .where(and(eq(schema.bankTransactions.companyId, companyId), eq(schema.bankTransactions.accountId, bankId), eq(schema.bankTransactions.kind, "check"), eq(schema.bankTransactions.number, number)));
  if (used) throw new UserError("err_check_number");
  const amount = round2(lines.reduce((s, l) => s + l.amount, 0));
  const memo = c.memo || `${c.payee}`;
  const entryId = await saveEntry(tx, companyId, userId, {
    date: c.date, reference: number, memo, partnerId: c.partnerId, source: "check",
    lines: [
      ...lines.map((l): LineInput => ({ accountId: l.accountId, debit: l.amount, credit: 0, description: l.description || memo, projectId: l.projectId })),
      { accountId: bankId, debit: 0, credit: amount, description: `${number} ${c.payee}`.trim() },
    ],
  }, true);
  const id = await register(tx, { companyId, kind: "check", number, date: c.date, accountId: bankId, partnerId: c.partnerId, payee: c.payee, memo, amount, entryId, createdBy: userId });
  await audit(tx, companyId, userId, "write_check", "bank_transaction", id, { number, amount });
  return id;
}

/**
 * An expense paid on the spot from cash, mobile money or the bank, with no bill: debit each line (and the VAT on
 * the lines that carry it), credit the money account. Numbered EXP-0001 onwards.
 */
export async function recordExpense(tx: Tx, companyId: string, userId: string, moneyId: string, c: Common & { attachmentId: string | null },
  lines: (BankLine & { vatApplies: boolean })[], vat: { rate: number; accountCode: string }) {
  await homeBank(tx, companyId, moneyId);
  await checkLines(tx, companyId, moneyId, lines, false);
  const found = await accountsOf(tx, companyId, lines.map((l) => l.accountId));
  if (lines.some((l) => !["expense", "asset"].includes(found.get(l.accountId)?.type ?? ""))) throw new UserError("err_account");
  const number = await nextNumber(tx, schema.bankTransactions, { number: schema.bankTransactions.number, companyId: schema.bankTransactions.companyId }, companyId, "EXP");
  const net = round2(lines.reduce((s, l) => s + l.amount, 0));
  const vatAmount = vat.rate ? round2(lines.reduce((s, l) => s + (l.vatApplies ? round2((l.amount * vat.rate) / 100) : 0), 0)) : 0;
  const amount = round2(net + vatAmount);
  const memo = c.memo || c.payee;
  const ledger: LineInput[] = lines.map((l) => ({ accountId: l.accountId, debit: l.amount, credit: 0, description: l.description || memo, projectId: l.projectId, partnerId: c.partnerId }));
  if (vatAmount) ledger.push({ accountId: await accountIdByCode(tx, companyId, vat.accountCode), debit: vatAmount, credit: 0, description: "VAT" });
  ledger.push({ accountId: moneyId, debit: 0, credit: amount, description: `${number} ${c.payee}`.trim() });
  const entryId = await saveEntry(tx, companyId, userId, { date: c.date, reference: c.reference || number, memo, partnerId: c.partnerId, source: "expense", attachmentId: c.attachmentId, lines: ledger }, true);
  const id = await register(tx, { companyId, kind: "expense", number, date: c.date, accountId: moneyId, partnerId: c.partnerId, payee: c.payee, memo, amount, entryId, createdBy: userId });
  await audit(tx, companyId, userId, "expense", "bank_transaction", id, { number, amount });
  return id;
}

/** A deposit: debit the bank, credit each line. Cash on hand can be one of the lines. */
export async function makeDeposit(tx: Tx, companyId: string, userId: string, bankId: string, c: Common, lines: BankLine[]) {
  await homeBank(tx, companyId, bankId);
  await checkLines(tx, companyId, bankId, lines, true);
  const amount = round2(lines.reduce((s, l) => s + l.amount, 0));
  const memo = c.memo || c.payee || c.reference;
  const entryId = await saveEntry(tx, companyId, userId, {
    date: c.date, reference: c.reference, memo, partnerId: c.partnerId, source: "deposit",
    lines: [
      { accountId: bankId, debit: amount, credit: 0, description: memo },
      ...lines.map((l): LineInput => ({ accountId: l.accountId, debit: 0, credit: l.amount, description: l.description || memo, projectId: l.projectId })),
    ],
  }, true);
  const id = await register(tx, { companyId, kind: "deposit", number: c.reference, date: c.date, accountId: bankId, partnerId: c.partnerId, payee: c.payee, memo, amount, entryId, createdBy: userId });
  await audit(tx, companyId, userId, "make_deposit", "bank_transaction", id, { amount });
  return id;
}

export async function transferFunds(tx: Tx, companyId: string, userId: string, fromId: string, toId: string, amount: number, c: Pick<Common, "date" | "reference" | "memo">) {
  if (fromId === toId) throw new UserError("err_same_account");
  if (!(amount > 0)) throw new UserError("err_amount");
  const from = await homeBank(tx, companyId, fromId), to = await homeBank(tx, companyId, toId);
  const memo = c.memo || `${from.code} → ${to.code}`;
  const entryId = await saveEntry(tx, companyId, userId, {
    date: c.date, reference: c.reference, memo, source: "transfer",
    lines: [{ accountId: toId, debit: amount, credit: 0, description: memo }, { accountId: fromId, debit: 0, credit: amount, description: memo }],
  }, true);
  const id = await register(tx, { companyId, kind: "transfer", number: c.reference, date: c.date, accountId: fromId, toAccountId: toId, memo, amount, entryId, createdBy: userId });
  await audit(tx, companyId, userId, "transfer", "bank_transaction", id, { amount });
  return id;
}

// ---------- reconciling ----------

/** What has already been agreed with the bank on this account up to a date. */
async function clearedBalance(db: Db | Tx, companyId: string, accountId: string, date: string) {
  const [row] = await db.select({ net: sql<string>`coalesce(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)` }).from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(and(eq(schema.journalLines.companyId, companyId), eq(schema.journalLines.accountId, accountId), eq(schema.journalLines.reconciled, true), eq(schema.journalEntries.status, "posted"), lte(schema.journalEntries.date, date)));
  return round2(Number(row?.net ?? 0));
}

/** The lines still to tick, and what the bank should already agree with. */
export async function reconcileView(db: Db | Tx, companyId: string, accountId: string, date: string) {
  const opening = await clearedBalance(db, companyId, accountId, date);
  const lines = await db.select({ l: schema.journalLines, date: schema.journalEntries.date, number: schema.journalEntries.number, reference: schema.journalEntries.reference, memo: schema.journalEntries.memo })
    .from(schema.journalLines).innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(and(eq(schema.journalLines.companyId, companyId), eq(schema.journalLines.accountId, accountId), eq(schema.journalLines.reconciled, false), eq(schema.journalEntries.status, "posted"), lte(schema.journalEntries.date, date)))
    .orderBy(asc(schema.journalEntries.date), asc(schema.journalEntries.number));
  return { opening, lines };
}

/** Finishes a reconciliation: only when what was ticked brings the books to the statement's ending balance. */
export async function finishReconciliation(tx: Tx, companyId: string, userId: string, accountId: string, date: string, ending: number, lineIds: string[]) {
  await homeBank(tx, companyId, accountId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${companyId}:REC:${accountId}`}))`);
  const [last] = await tx.select().from(schema.bankReconciliations).where(and(eq(schema.bankReconciliations.companyId, companyId), eq(schema.bankReconciliations.accountId, accountId)))
    .orderBy(desc(schema.bankReconciliations.statementDate), desc(schema.bankReconciliations.createdAt)).limit(1);
  if (last && date < last.statementDate) throw new UserError("err_reconcile_date");
  const { opening, lines } = await reconcileView(tx, companyId, accountId, date);
  const open = new Map(lines.map((x) => [x.l.id, x.l]));
  if (lineIds.some((id) => !open.has(id))) throw new UserError("err_not_found");
  const ticked = lineIds.map((id) => open.get(id)!);
  const cleared = round2(opening + ticked.reduce((s, l) => s + l.debit - l.credit, 0));
  if (round2(cleared - ending) !== 0) throw new UserError("err_reconcile_difference");
  const [rec] = await tx.insert(schema.bankReconciliations).values({ companyId, accountId, statementDate: date, openingBalance: opening, endingBalance: ending, clearedCount: ticked.length, createdBy: userId }).returning({ id: schema.bankReconciliations.id });
  if (ticked.length) await tx.update(schema.journalLines).set({ reconciled: true, reconciliationId: rec.id }).where(inArray(schema.journalLines.id, ticked.map((l) => l.id)));
  await audit(tx, companyId, userId, "reconcile", "bank_account", accountId, { date, ending, lines: ticked.length });
  return rec.id;
}

/** Undoes an account's latest reconciliation, so a mistake can be corrected. Earlier ones stay. */
export async function undoReconciliation(tx: Tx, companyId: string, userId: string, id: string) {
  const [rec] = await tx.select().from(schema.bankReconciliations).where(and(eq(schema.bankReconciliations.id, id), eq(schema.bankReconciliations.companyId, companyId)));
  if (!rec) throw new UserError("err_not_found");
  const [last] = await tx.select({ id: schema.bankReconciliations.id }).from(schema.bankReconciliations).where(and(eq(schema.bankReconciliations.companyId, companyId), eq(schema.bankReconciliations.accountId, rec.accountId)))
    .orderBy(desc(schema.bankReconciliations.statementDate), desc(schema.bankReconciliations.createdAt)).limit(1);
  if (last.id !== id) throw new UserError("err_reconcile_last");
  await tx.update(schema.journalLines).set({ reconciled: false, reconciliationId: null }).where(eq(schema.journalLines.reconciliationId, id));
  await tx.delete(schema.bankReconciliations).where(eq(schema.bankReconciliations.id, id));
  await audit(tx, companyId, userId, "undo_reconcile", "bank_account", rec.accountId, { date: rec.statementDate, ending: rec.endingBalance });
}

// ---------- foreign currency (IAS 21) ----------

/** Each foreign currency account's balance in its own currency, up to a date. A reversed transaction no longer counts. */
export async function foreignBalances(db: Db | Tx, companyId: string, to?: string) {
  const bt = schema.bankTransactions, je = schema.journalEntries;
  const rows = await db.select({ accountId: bt.accountId, toAccountId: bt.toAccountId, foreign: bt.foreignAmount, toForeign: bt.toForeignAmount })
    .from(bt).innerJoin(je, eq(je.id, bt.entryId))
    .where(and(eq(bt.companyId, companyId), isNull(je.reversedById), ...(to ? [lte(bt.date, to)] : [])));
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.foreign) m.set(r.accountId, round2((m.get(r.accountId) ?? 0) + r.foreign));
    if (r.toAccountId && r.toForeign) m.set(r.toAccountId, round2((m.get(r.toAccountId) ?? 0) + r.toForeign));
  }
  return m;
}

/** Foreign money comes in or goes out: recorded at that day's rate (IAS 21.21), in both currencies. */
export async function foreignMove(tx: Tx, companyId: string, userId: string, input: Common & { accountId: string; direction: "in" | "out"; foreign: number; rate: number; counterId: string; projectId: string | null }) {
  const found = await accountsOf(tx, companyId, [input.accountId, input.counterId]);
  const bank = found.get(input.accountId), counter = found.get(input.counterId);
  if (!bank?.currency) throw new UserError("err_account");
  if (!counter) throw new UserError("err_account");
  if (counter.subtype === "ar" || counter.subtype === "ap") throw new UserError("err_use_bills");
  if (counter.id === bank.id) throw new UserError("err_same_account");
  if (MONEY.includes(counter.subtype ?? "")) throw new UserError("err_use_transfer");
  if (!(input.foreign > 0)) throw new UserError("err_amount");
  if (!(input.rate > 0)) throw new UserError("err_fx_rate");
  const home = round2(input.foreign * input.rate);
  if (!(home > 0)) throw new UserError("err_amount");
  const memo = input.memo || `${input.payee || bank.currency} ${input.foreign} @ ${input.rate}`;
  const bankSide: LineInput = input.direction === "in" ? { accountId: bank.id, debit: home, credit: 0, description: memo } : { accountId: bank.id, debit: 0, credit: home, description: memo };
  const other: LineInput = input.direction === "in" ? { accountId: counter.id, debit: 0, credit: home, description: memo, projectId: input.projectId } : { accountId: counter.id, debit: home, credit: 0, description: memo, projectId: input.projectId };
  const entryId = await saveEntry(tx, companyId, userId, {
    date: input.date, reference: input.reference, memo, partnerId: input.partnerId, source: "fx", lines: input.direction === "in" ? [bankSide, other] : [other, bankSide],
  }, true);
  const id = await register(tx, {
    companyId, kind: input.direction === "in" ? "fx_in" : "fx_out", number: input.reference, date: input.date, accountId: bank.id, partnerId: input.partnerId, payee: input.payee, memo,
    amount: home, currency: bank.currency, foreignAmount: input.direction === "in" ? input.foreign : -input.foreign, rate: input.rate, entryId, createdBy: userId,
  });
  await audit(tx, companyId, userId, input.direction === "in" ? "fx_receive" : "fx_pay", "bank_transaction", id, { foreign: input.foreign, rate: input.rate, home });
  return id;
}

/**
 * Buying or selling currency between two accounts: what was really paid or received in the home currency is what is booked.
 * When neither side is the home currency, the rate of the money sent gives the value. Any difference on the foreign account is settled by revaluing it.
 */
export async function foreignExchange(tx: Tx, companyId: string, userId: string, input: Pick<Common, "date" | "reference" | "memo"> & { fromId: string; toId: string; sent: number; received: number; rate: number }) {
  if (input.fromId === input.toId) throw new UserError("err_same_account");
  if (!(input.sent > 0) || !(input.received > 0)) throw new UserError("err_amount");
  const found = await accountsOf(tx, companyId, [input.fromId, input.toId]);
  const from = found.get(input.fromId), to = found.get(input.toId);
  if (!from || !to || !MONEY.includes(from.subtype ?? "") || !MONEY.includes(to.subtype ?? "")) throw new UserError("err_account");
  if (!from.currency && !to.currency) throw new UserError("err_use_transfer");
  if (from.currency && to.currency && !(input.rate > 0)) throw new UserError("err_fx_rate");
  const home = !from.currency ? input.sent : !to.currency ? input.received : round2(input.sent * input.rate);
  const memo = input.memo || `${from.code} → ${to.code}`;
  const entryId = await saveEntry(tx, companyId, userId, {
    date: input.date, reference: input.reference, memo, source: "fx",
    lines: [{ accountId: to.id, debit: home, credit: 0, description: memo }, { accountId: from.id, debit: 0, credit: home, description: memo }],
  }, true);
  const foreignSide = from.currency ?? to.currency!;
  const rate = !from.currency ? round6(input.sent / input.received) : !to.currency ? round6(input.received / input.sent) : input.rate;
  const id = await register(tx, {
    companyId, kind: "fx_exchange", number: input.reference, date: input.date, accountId: from.id, toAccountId: to.id, memo, amount: home, currency: foreignSide,
    foreignAmount: from.currency ? -input.sent : 0, toForeignAmount: to.currency ? input.received : 0, rate, entryId, createdBy: userId,
  });
  await audit(tx, companyId, userId, "fx_exchange", "bank_transaction", id, { sent: input.sent, received: input.received, home });
  return id;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

async function ensureAccount(tx: Tx, companyId: string, code: string, type: "income" | "expense", en: string, fr: string) {
  const [a] = await tx.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.code, code)));
  if (a) return a.id;
  const [row] = await tx.insert(schema.accounts).values({ companyId, code, type, nameEn: en, nameFr: fr }).returning({ id: schema.accounts.id });
  return row.id;
}

/**
 * Restates foreign currency accounts at the closing rate (IAS 21.23, .28): the difference from what the books carry
 * goes to exchange gains or losses. It moves no foreign money, and is marked as an adjusting entry.
 */
export async function revalue(tx: Tx, companyId: string, userId: string, date: string, rates: Map<string, number>, memo: string) {
  const ids = [...rates.keys()];
  const found = await accountsOf(tx, companyId, ids);
  const carrying = await balances(tx, companyId, { to: date });
  const foreign = await foreignBalances(tx, companyId, date);
  let done = 0;
  for (const [accountId, rate] of rates) {
    const a = found.get(accountId);
    if (!a?.currency) throw new UserError("err_account");
    if (!(rate > 0)) throw new UserError("err_fx_rate");
    const target = round2((foreign.get(accountId) ?? 0) * rate);
    const diff = round2(target - (carrying.get(accountId)?.net ?? 0));
    if (!diff) continue;
    const counter = diff > 0
      ? await ensureAccount(tx, companyId, FX_GAIN_CODE, "income", "Foreign exchange gains", "Gains de change")
      : await ensureAccount(tx, companyId, FX_LOSS_CODE, "expense", "Foreign exchange losses", "Pertes de change");
    const text = `${memo} ${a.currency} @ ${rate}`;
    const amount = Math.abs(diff);
    const entryId = await saveEntry(tx, companyId, userId, {
      date, reference: `FX-${date}`, memo: text, source: "fx", isAdjusting: true,
      lines: diff > 0
        ? [{ accountId, debit: amount, credit: 0, description: text }, { accountId: counter, debit: 0, credit: amount, description: text }]
        : [{ accountId: counter, debit: amount, credit: 0, description: text }, { accountId, debit: 0, credit: amount, description: text }],
    }, true);
    await register(tx, { companyId, kind: "fx_revaluation", number: `FX-${date}`, date, accountId, memo: text, amount: diff, currency: a.currency, rate, entryId, createdBy: userId });
    done++;
  }
  await audit(tx, companyId, userId, "fx_revalue", "bank_accounts", date, { accounts: done });
  return done;
}
