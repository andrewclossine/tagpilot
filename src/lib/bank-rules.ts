import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import { saveEntry, UserError } from "./ledger";

export type BankRule = typeof schema.bankRules.$inferSelect;
type BankLine = typeof schema.bankLines.$inferSelect;

/** Whether a statement line fits a rule: its text, direction, amounts and bank account. */
export function ruleFits(rule: BankRule, line: Pick<BankLine, "description" | "reference" | "amount" | "accountId">) {
  if (!rule.isActive) return false;
  if (rule.bankAccountId && rule.bankAccountId !== line.accountId) return false;
  const text = `${line.description} ${line.reference}`.toLowerCase();
  if (!text.includes(rule.contains.trim().toLowerCase())) return false;
  if (rule.direction === "in" && line.amount <= 0) return false;
  if (rule.direction === "out" && line.amount >= 0) return false;
  const amt = Math.abs(line.amount);
  if (rule.minAmount > 0 && amt < rule.minAmount) return false;
  if (rule.maxAmount > 0 && amt > rule.maxAmount) return false;
  return true;
}

export const rulesOf = (db: Db | Tx, companyId: string) =>
  db.select().from(schema.bankRules).where(eq(schema.bankRules.companyId, companyId)).orderBy(asc(schema.bankRules.sortOrder), asc(schema.bankRules.createdAt));

/** Books one open statement line against an account: the bank side is reconciled at once. */
export async function bookBankLine(tx: Tx, companyId: string, userId: string, line: BankLine, counterId: string, projectId: string | null, ruleId: string | null = null) {
  if (line.status !== "open") throw new UserError("err_not_found");
  if (counterId === line.accountId) throw new UserError("err_same_account");
  const amt = Math.abs(line.amount);
  const entryId = await saveEntry(tx, companyId, userId, {
    date: line.date, reference: line.reference, memo: line.description, source: "bank", sourceId: line.id, projectId,
    lines: line.amount > 0
      ? [{ accountId: line.accountId, debit: amt, credit: 0, description: line.description }, { accountId: counterId, debit: 0, credit: amt, description: line.description, projectId }]
      : [{ accountId: counterId, debit: amt, credit: 0, description: line.description, projectId }, { accountId: line.accountId, debit: 0, credit: amt, description: line.description }],
  }, true);
  const [bankSide] = await tx.select().from(schema.journalLines).where(and(eq(schema.journalLines.entryId, entryId), eq(schema.journalLines.accountId, line.accountId)));
  await tx.update(schema.journalLines).set({ reconciled: true }).where(eq(schema.journalLines.id, bankSide.id));
  await tx.update(schema.bankLines).set({ status: "booked", journalLineId: bankSide.id, ...(ruleId ? { ruleId } : {}) }).where(eq(schema.bankLines.id, line.id));
  return entryId;
}

/**
 * Runs the rules over open statement lines: the first rule that fits suggests its account, or books the line when it
 * is set to book by itself. Returns how many were suggested and booked.
 */
export async function applyRules(tx: Tx, companyId: string, userId: string, lineIds?: string[]) {
  const rules = (await rulesOf(tx, companyId)).filter((r) => r.isActive);
  if (!rules.length) return { suggested: 0, booked: 0 };
  const conds = [eq(schema.bankLines.companyId, companyId), eq(schema.bankLines.status, "open")];
  if (lineIds) {
    if (!lineIds.length) return { suggested: 0, booked: 0 };
    conds.push(inArray(schema.bankLines.id, lineIds));
  }
  const lines = await tx.select().from(schema.bankLines).where(and(...conds));
  let suggested = 0, booked = 0;
  for (const l of lines) {
    const rule = rules.find((r) => ruleFits(r, l));
    if (!rule) continue;
    if (rule.autoBook) {
      await bookBankLine(tx, companyId, userId, l, rule.accountId, rule.projectId, rule.id);
      booked++;
    } else {
      await tx.update(schema.bankLines).set({ suggestedAccountId: rule.accountId, suggestedProjectId: rule.projectId, ruleId: rule.id }).where(eq(schema.bankLines.id, l.id));
      suggested++;
    }
  }
  return { suggested, booked };
}
