import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { isIsoDate, today } from "@/lib/format";

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** The posted journal for a period, one row per line, as a CSV that Excel opens directly. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  const url = new URL(req.url);
  const from = isIsoDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : `${today().slice(0, 4)}-01-01`;
  const to = isIsoDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : today();
  const db = await getDb();
  const rows = await db.select({
    number: schema.journalEntries.number, date: schema.journalEntries.date, reference: schema.journalEntries.reference, memo: schema.journalEntries.memo,
    partner: schema.partners.name, project: schema.projects.code, code: schema.accounts.code, account: schema.accounts.nameEn,
    debit: schema.journalLines.debit, credit: schema.journalLines.credit, description: schema.journalLines.description,
  }).from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
    .leftJoin(schema.partners, eq(schema.partners.id, schema.journalLines.partnerId))
    .leftJoin(schema.projects, eq(schema.projects.id, schema.journalLines.projectId))
    .where(and(eq(schema.journalEntries.companyId, ctx.company.id), eq(schema.journalEntries.status, "posted"),
      gte(schema.journalEntries.date, from), lte(schema.journalEntries.date, to)))
    .orderBy(asc(schema.journalEntries.date), asc(schema.journalEntries.number), asc(schema.journalLines.lineNo));
  const head = ["Entry", "Date", "Reference", "Memo", "Partner", "Project", "Account", "Account name", "Description", "Debit", "Credit"];
  const body = rows.map((r) => [r.number, r.date, r.reference, r.memo, r.partner, r.project, r.code, r.account, r.description, r.debit || "", r.credit || ""]);
  const csv = "﻿" + [head, ...body].map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="journal_${from}_${to}.csv"` },
  });
}
