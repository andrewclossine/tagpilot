"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail, withParam } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, str, today } from "@/lib/format";
import { addLine } from "@/lib/banking-form";
import { finishReconciliation, foreignExchange, foreignMove, makeDeposit, revalue, transferFunds, undoReconciliation, writeCheck } from "@/lib/banking";
import { CURRENCIES } from "@/lib/template";
import { saveEntry, UserError } from "@/lib/ledger";
import { parseStatement } from "@/lib/statement";
import { suggestBankAccounts } from "@/lib/ai";
import { bookOptions } from "@/lib/data";
import { getI18n } from "@/lib/i18n";
import { audit } from "@/lib/audit";

async function moneyAccount(companyId: string, id: string) {
  const db = await getDb();
  const [a] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, companyId)));
  if (!a || !["bank", "cash", "momo"].includes(a.subtype ?? "")) throw new UserError("err_account");
  return a;
}

export async function importStatement(fd: FormData) {
  const ctx = await requireWrite("banking");
  const accountId = str(fd, "accountId"), back = `/banking/${accountId}`;
  let n = 0;
  try {
    await moneyAccount(ctx.company.id, accountId);
    const rows = parseStatement(String(fd.get("text") ?? ""));
    if (!rows.length) throw new UserError("err_required");
    const db = await getDb();
    const batch = new Date().toISOString();
    await db.insert(schema.bankLines).values(rows.map((r) => ({ ...r, companyId: ctx.company.id, accountId, importBatch: batch })));
    await audit(db, ctx.company.id, ctx.user.id, "import", "bank_statement", accountId, { lines: rows.length });
    n = rows.length;
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(withParam(back, "imported", String(n)));
}

async function openLine(companyId: string, id: string) {
  const db = await getDb();
  const [l] = await db.select().from(schema.bankLines).where(and(eq(schema.bankLines.id, id), eq(schema.bankLines.companyId, companyId)));
  if (!l || l.status !== "open") throw new UserError("err_not_found");
  return l;
}

/** Links a statement line to a posted ledger line with the same amount. */
export async function matchLine(fd: FormData) {
  const ctx = await requireWrite("banking");
  const back = `/banking/${str(fd, "accountId")}`;
  try {
    const l = await openLine(ctx.company.id, str(fd, "id"));
    const db = await getDb();
    const [jl] = await db.select().from(schema.journalLines)
      .where(and(eq(schema.journalLines.id, str(fd, "journalLineId")), eq(schema.journalLines.companyId, ctx.company.id), eq(schema.journalLines.accountId, l.accountId)));
    if (!jl || jl.reconciled) throw new UserError("err_not_found");
    await db.transaction(async (tx) => {
      await tx.update(schema.journalLines).set({ reconciled: true }).where(eq(schema.journalLines.id, jl.id));
      await tx.update(schema.bankLines).set({ status: "matched", journalLineId: jl.id }).where(eq(schema.bankLines.id, l.id));
    });
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(back);
}

/** Posts a statement line that is not yet in the books against the chosen account. */
export async function bookLine(fd: FormData) {
  const ctx = await requireWrite("banking");
  const back = `/banking/${str(fd, "accountId")}`;
  try {
    const l = await openLine(ctx.company.id, str(fd, "id"));
    const counter = str(fd, "counterId");
    if (!counter) throw new UserError("err_account");
    const amt = Math.abs(l.amount);
    const db = await getDb();
    await db.transaction(async (tx) => {
      const entryId = await saveEntry(tx, ctx.company.id, ctx.user.id, {
        date: l.date, reference: l.reference, memo: l.description, source: "bank", sourceId: l.id,
        projectId: str(fd, "projectId") || null,
        lines: l.amount > 0
          ? [{ accountId: l.accountId, debit: amt, credit: 0, description: l.description }, { accountId: counter, debit: 0, credit: amt, description: l.description }]
          : [{ accountId: counter, debit: amt, credit: 0, description: l.description }, { accountId: l.accountId, debit: 0, credit: amt, description: l.description }],
      }, true);
      const [bankSide] = await tx.select().from(schema.journalLines)
        .where(and(eq(schema.journalLines.entryId, entryId), eq(schema.journalLines.accountId, l.accountId)));
      await tx.update(schema.journalLines).set({ reconciled: true }).where(eq(schema.journalLines.id, bankSide.id));
      await tx.update(schema.bankLines).set({ status: "booked", journalLineId: bankSide.id }).where(eq(schema.bankLines.id, l.id));
    });
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(back);
}

export async function ignoreLine(fd: FormData) {
  const ctx = await requireWrite("banking");
  const back = `/banking/${str(fd, "accountId")}`;
  const db = await getDb();
  const changed = await db.update(schema.bankLines).set({ status: "ignored" })
    .where(and(eq(schema.bankLines.id, str(fd, "id")), eq(schema.bankLines.companyId, ctx.company.id), eq(schema.bankLines.status, "open")))
    .returning({ id: schema.bankLines.id });
  if (changed.length) await audit(db, ctx.company.id, ctx.user.id, "ignore", "bank_line", changed[0].id);
  revalidatePath(back);
  redirect(back);
}

/** Asks the AI which account each unexplained line belongs to, and stores the suggestions for review. */
export async function suggestWithAi(fd: FormData) {
  const ctx = await requireWrite("banking");
  const accountId = str(fd, "accountId"), back = `/banking/${accountId}`;
  const { lang, accName } = await getI18n();
  try {
    const db = await getDb();
    const open = await db.select().from(schema.bankLines)
      .where(and(eq(schema.bankLines.companyId, ctx.company.id), eq(schema.bankLines.accountId, accountId), eq(schema.bankLines.status, "open")))
      .limit(80);
    if (!open.length) throw new UserError("err_not_found");
    const o = await bookOptions(ctx.company.id, accName);
    const s = ctx.company.settings;
    const picks = await suggestBankAccounts(open.map((l) => ({ id: l.id, date: l.date, description: l.description, amount: l.amount })), {
      companyName: ctx.company.name, tin: ctx.company.tin, country: ctx.company.country, currency: ctx.company.currency, vatRegistered: ctx.company.vatRegistered, vatRate: ctx.company.vatRate,
      vatIn: s.vatIn, vatOut: s.vatOut, policies: ctx.company.policies, language: lang === "fr" ? "French" : "English",
      accounts: o.accounts.filter((a) => a.id !== accountId).map((a) => ({ code: a.code, name: a.nameEn, type: a.type })),
      partners: [], projects: o.projects.map((p) => ({ code: p.code, name: p.name })), recent: [],
    });
    const byCode = new Map(o.accounts.map((a) => [a.code, a.id]));
    await db.transaction(async (tx) => {
      for (const l of open) {
        const acc = byCode.get(picks.get(l.id) ?? "");
        if (acc && acc !== accountId) await tx.update(schema.bankLines).set({ suggestedAccountId: acc }).where(eq(schema.bankLines.id, l.id));
      }
    });
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(back);
}

export async function reopenLines(fd: FormData) {
  const ctx = await requireWrite("banking");
  const back = `/banking/${str(fd, "accountId")}`;
  const db = await getDb();
  const ids = fd.getAll("id").map(String);
  if (ids.length) await db.update(schema.bankLines).set({ status: "open" })
    .where(and(eq(schema.bankLines.companyId, ctx.company.id), inArray(schema.bankLines.id, ids), eq(schema.bankLines.status, "ignored")));
  revalidatePath(back);
  redirect(back);
}

const refreshBank = () => { revalidatePath("/banking", "layout"); revalidatePath("/journal"); };
const dateOf = (fd: FormData) => { const d = str(fd, "date") || today(); if (!isIsoDate(d)) throw new UserError("err_required"); return d; };

/** The partner chosen on a form, if it is this company's, and the name to print. */
async function whoOf(companyId: string, fd: FormData) {
  const db = await getDb();
  const id = str(fd, "partnerId");
  let name = str(fd, "payee");
  if (!isUuid(id)) return { partnerId: null, payee: name };
  const [p] = await db.select().from(schema.partners).where(and(eq(schema.partners.id, id), eq(schema.partners.companyId, companyId)));
  if (!p) throw new UserError("err_not_found");
  name = name || p.name;
  return { partnerId: p.id, payee: name };
}

export async function saveCheck(fd: FormData) {
  const ctx = await requireWrite("banking");
  const back = "/banking/check";
  try {
    const date = dateOf(fd), who = await whoOf(ctx.company.id, fd);
    if (!who.payee) throw new UserError("err_required");
    const lines = addLine(fd);
    const db = await getDb();
    await db.transaction((tx) => writeCheck(tx, ctx.company.id, ctx.user.id, str(fd, "accountId"), { date, reference: str(fd, "reference"), memo: str(fd, "memo"), ...who }, lines));
  } catch (e) { fail(e, back); }
  refreshBank();
  redirect(withParam(back, "saved", "1"));
}

export async function saveDeposit(fd: FormData) {
  const ctx = await requireWrite("banking");
  const back = "/banking/deposit";
  try {
    const date = dateOf(fd), who = await whoOf(ctx.company.id, fd);
    const lines = addLine(fd);
    const db = await getDb();
    await db.transaction((tx) => makeDeposit(tx, ctx.company.id, ctx.user.id, str(fd, "accountId"), { date, reference: str(fd, "reference"), memo: str(fd, "memo"), ...who }, lines));
  } catch (e) { fail(e, back); }
  refreshBank();
  redirect(withParam(back, "saved", "1"));
}

export async function saveTransfer(fd: FormData) {
  const ctx = await requireWrite("banking");
  const back = "/banking/transfer";
  try {
    const date = dateOf(fd);
    const db = await getDb();
    await db.transaction((tx) => transferFunds(tx, ctx.company.id, ctx.user.id, str(fd, "fromId"), str(fd, "toId"), parseAmount(str(fd, "amount")), { date, reference: str(fd, "reference"), memo: str(fd, "memo") }));
  } catch (e) { fail(e, back); }
  refreshBank();
  redirect(withParam(back, "saved", "1"));
}

export async function saveReconciliation(fd: FormData) {
  const ctx = await requireWrite("banking");
  const accountId = str(fd, "accountId"), date = str(fd, "date"), ending = parseAmount(str(fd, "ending"));
  const back = `/banking/reconcile?account=${accountId}&date=${date}&ending=${ending}`;
  try {
    if (!isUuid(accountId) || !isIsoDate(date)) throw new UserError("err_required");
    const ids = fd.getAll("line").map(String);
    if (ids.some((id) => !isUuid(id))) throw new UserError("err_not_found");
    const db = await getDb();
    await db.transaction((tx) => finishReconciliation(tx, ctx.company.id, ctx.user.id, accountId, date, ending, ids));
  } catch (e) { fail(e, back); }
  refreshBank();
  redirect(`/banking/reconcile?account=${accountId}&saved=1`);
}

export async function undoReconcile(fd: FormData) {
  const ctx = await requireWrite("banking");
  const back = "/banking/reconcile";
  try {
    const id = str(fd, "id");
    if (!isUuid(id)) throw new UserError("err_not_found");
    const db = await getDb();
    await db.transaction((tx) => undoReconciliation(tx, ctx.company.id, ctx.user.id, id));
  } catch (e) { fail(e, back); }
  refreshBank();
  redirect(back);
}

const rateOf = (v: string) => { const n = Number(v.replace(/[\s,]/g, "")); return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0; };

/** Opens a bank account held in a foreign currency. */
export async function addForeignAccount(fd: FormData) {
  const ctx = await requireWrite("banking");
  const back = "/banking/foreign";
  try {
    const code = str(fd, "code"), name = str(fd, "name"), currency = str(fd, "currency");
    if (!code || !name) throw new UserError("err_required");
    if (!CURRENCIES.includes(currency) || currency === ctx.company.currency) throw new UserError("err_required");
    const db = await getDb();
    const [used] = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), eq(schema.accounts.code, code)));
    if (used) throw new UserError("err_code_taken");
    await db.transaction(async (tx) => {
      await tx.insert(schema.accounts).values({ companyId: ctx.company.id, code, nameEn: name, nameFr: name, type: "asset", subtype: "bank", currency });
      await audit(tx, ctx.company.id, ctx.user.id, "create", "foreign_account", code, { currency });
    });
  } catch (e) { fail(e, back); }
  refreshBank();
  redirect(withParam(back, "saved", "1"));
}

export async function saveForeignMove(fd: FormData) {
  const ctx = await requireWrite("banking");
  const back = "/banking/foreign";
  try {
    const date = dateOf(fd), who = await whoOf(ctx.company.id, fd);
    const projectId = isUuid(str(fd, "projectId")) ? str(fd, "projectId") : null;
    const db = await getDb();
    await db.transaction((tx) => foreignMove(tx, ctx.company.id, ctx.user.id, {
      date, reference: str(fd, "reference"), memo: str(fd, "memo"), ...who, accountId: str(fd, "accountId"), direction: str(fd, "direction") === "out" ? "out" : "in",
      foreign: parseAmount(str(fd, "foreign")), rate: rateOf(str(fd, "rate")), counterId: str(fd, "counterId"), projectId,
    }));
  } catch (e) { fail(e, back); }
  refreshBank();
  redirect(withParam(back, "saved", "1"));
}

export async function saveForeignExchange(fd: FormData) {
  const ctx = await requireWrite("banking");
  const back = "/banking/foreign";
  try {
    const date = dateOf(fd);
    const db = await getDb();
    await db.transaction((tx) => foreignExchange(tx, ctx.company.id, ctx.user.id, {
      date, reference: str(fd, "reference"), memo: str(fd, "memo"), fromId: str(fd, "fromId"), toId: str(fd, "toId"),
      sent: parseAmount(str(fd, "sent")), received: parseAmount(str(fd, "received")), rate: rateOf(str(fd, "rate")),
    }));
  } catch (e) { fail(e, back); }
  refreshBank();
  redirect(withParam(back, "saved", "1"));
}

export async function saveRevaluation(fd: FormData) {
  const ctx = await requireWrite("banking");
  const back = "/banking/foreign";
  const { t } = await getI18n();
  try {
    const date = dateOf(fd);
    const rates = new Map<string, number>();
    for (const [k, v] of fd.entries()) if (k.startsWith("rate_") && String(v).trim()) rates.set(k.slice(5), rateOf(String(v)));
    if (!rates.size) throw new UserError("err_fx_rate");
    if ([...rates.keys()].some((id) => !isUuid(id))) throw new UserError("err_account");
    const db = await getDb();
    await db.transaction((tx) => revalue(tx, ctx.company.id, ctx.user.id, date, rates, t("bk_fx_revalue")));
  } catch (e) { fail(e, back); }
  refreshBank();
  redirect(withParam(back, "saved", "1"));
}
