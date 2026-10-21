import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { T } from "./i18n";

/** Options every editor needs: accounts, projects and partners of the current company. */
export async function bookOptions(companyId: string, accName: (a: { nameEn: string; nameFr: string }) => string) {
  const db = await getDb();
  const [accounts, projects, partners] = await Promise.all([
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.isActive, true))).orderBy(schema.accounts.code),
    db.select().from(schema.projects).where(eq(schema.projects.companyId, companyId)).orderBy(schema.projects.code),
    db.select().from(schema.partners).where(eq(schema.partners.companyId, companyId)).orderBy(schema.partners.name),
  ]);
  return {
    accounts,
    projects,
    partners,
    accountOpts: accounts.map((a) => ({ id: a.id, code: a.code, name: accName(a), type: a.type })),
    projectOpts: projects.map((p) => ({ id: p.id, code: p.code, name: p.name })),
  };
}

export function typeLabels(t: T) {
  return { asset: t("t_asset"), liability: t("t_liability"), equity: t("t_equity"), income: t("t_income"), expense: t("t_expense") };
}

export function journalLabels(t: T) {
  return {
    account: t("account"), debit: t("debit"), credit: t("credit"), description: t("description"), project: t("project"),
    add_line: t("add_line"), balanced: t("balanced"), not_balanced: t("not_balanced"), none: t("none"), delete: t("delete"), types: typeLabels(t),
  };
}

export function docLabels(t: T) {
  return {
    description: t("description"), qty: t("qty"), unit_price: t("unit_price"), vat: t("vat"), account: t("account"), project: t("project"),
    add_line: t("add_line"), subtotal: t("subtotal"), total: t("total"), delete: t("delete"), types: typeLabels(t),
  };
}

/** Recent approved entries written as one line each, so the AI can follow the company's habits. */
export async function recentEntriesForAi(companyId: string): Promise<string[]> {
  const db = await getDb();
  const entries = await db.select().from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.companyId, companyId), eq(schema.journalEntries.status, "posted")))
    .orderBy(desc(schema.journalEntries.postedAt)).limit(15);
  const out: string[] = [];
  for (const e of entries) {
    const lines = await db.select({ code: schema.accounts.code, debit: schema.journalLines.debit, credit: schema.journalLines.credit })
      .from(schema.journalLines).innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
      .where(eq(schema.journalLines.entryId, e.id));
    out.push(`${e.date} | ${e.memo} | ` + lines.map((l) => (l.debit ? `Dr ${l.code} ${l.debit}` : `Cr ${l.code} ${l.credit}`)).join("; "));
  }
  return out;
}
