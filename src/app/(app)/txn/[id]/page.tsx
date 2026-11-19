import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { isUuid } from "@/lib/format";
import { txnHref } from "@/lib/txn-links";

/** A transaction clicked in a report: opens its document, or its journal entry when it has none. */
export default async function TxnPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  // Anyone who sees a part of the books with transactions in it; the page it leads to checks its own access.
  if (ctx.role === "supplier" || !(["reports", "journal", "banking", "sales", "purchases"] as const).some((a) => ctx.can(a))) redirect("/no-access");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = await getDb();
  const [e] = await db.select({ id: schema.journalEntries.id, source: schema.journalEntries.source, sourceId: schema.journalEntries.sourceId })
    .from(schema.journalEntries).where(and(eq(schema.journalEntries.id, id), eq(schema.journalEntries.companyId, ctx.company.id)));
  if (!e) notFound();
  redirect(txnHref(e));
}
