import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { isUuid, money as fmtMoney } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { letterPdf } from "@/lib/pdf";
import { printedCompany } from "@/lib/pdf-data";

/** The cheque voucher: which cheque, to whom, and the accounts it was charged to. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireView("banking");
  const { id } = await params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const { t, lang, accName } = await getI18n();
  const db = await getDb();
  const [b] = await db.select().from(schema.bankTransactions)
    .where(and(eq(schema.bankTransactions.id, id), eq(schema.bankTransactions.companyId, ctx.company.id), eq(schema.bankTransactions.kind, "check")));
  if (!b) return new Response("Not found", { status: 404 });
  const lines = await db.select({ l: schema.journalLines, a: schema.accounts }).from(schema.journalLines)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
    .where(eq(schema.journalLines.entryId, b.entryId)).orderBy(schema.journalLines.lineNo);
  const [bank] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, b.accountId));
  const amount = (n: number) => fmtMoney(n, lang, 2).replace(/[  ]/g, " ");
  const pdf = await letterPdf({
    company: await printedCompany(ctx), title: t("bk_check_voucher"), footer: t("pdf_footer"),
    subject: `${t("pv_payee")}: ${b.payee}`,
    lines: [[t("bk_check_no"), b.number], [t("date"), b.date], [t("bk_from_bank"), bank ? accName(bank) : ""], [t("amount"), `${amount(b.amount)} ${ctx.company.currency}`]],
    body: b.memo,
    columns: [{ label: t("account"), width: 200 }, { label: t("description"), width: 195 }, { label: t("amount"), width: 100, align: "right" }],
    rows: lines.filter((x) => x.l.debit > 0).map((x) => [`${x.a.code} ${accName(x.a)}`, x.l.description, amount(x.l.debit)]),
  });
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="cheque-${b.number.replace(/[^A-Za-z0-9-]/g, "-")}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
