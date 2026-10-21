"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail, withParam } from "@/lib/actions";
import { str } from "@/lib/format";
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
  const ctx = await requireWrite();
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
  const ctx = await requireWrite();
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
  const ctx = await requireWrite();
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
  const ctx = await requireWrite();
  const back = `/banking/${str(fd, "accountId")}`;
  const db = await getDb();
  await db.update(schema.bankLines).set({ status: "ignored" })
    .where(and(eq(schema.bankLines.id, str(fd, "id")), eq(schema.bankLines.companyId, ctx.company.id), eq(schema.bankLines.status, "open")));
  revalidatePath(back);
  redirect(back);
}

/** Asks the AI which account each unexplained line belongs to, and stores the suggestions for review. */
export async function suggestWithAi(fd: FormData) {
  const ctx = await requireWrite();
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
      companyName: ctx.company.name, tin: ctx.company.tin, vatRegistered: ctx.company.vatRegistered, vatRate: ctx.company.vatRate,
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
  const ctx = await requireWrite();
  const back = `/banking/${str(fd, "accountId")}`;
  const db = await getDb();
  const ids = fd.getAll("id").map(String);
  if (ids.length) await db.update(schema.bankLines).set({ status: "open" })
    .where(and(eq(schema.bankLines.companyId, ctx.company.id), inArray(schema.bankLines.id, ids), eq(schema.bankLines.status, "ignored")));
  revalidatePath(back);
  redirect(back);
}
