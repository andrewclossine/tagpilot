import Link from "next/link";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isIsoDate, today } from "@/lib/format";
import { Empty, PageHead, Pill, Tabs } from "@/components/ui";
import { entryMemo } from "@/lib/financial-reports";
import { txnHref } from "@/lib/txn-links";

export const metadata = { title: "Journal" };

export default async function JournalPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("journal");
  const { t, money } = await getI18n();
  const q = await sp(searchParams);
  const status = q("status") === "draft" ? "draft" : q("status") === "posted" ? "posted" : "";
  const from = isIsoDate(q("from")) ? q("from") : `${today().slice(0, 4)}-01-01`;
  const to = isIsoDate(q("to")) ? q("to") : today();
  const db = await getDb();
  const conds = [eq(schema.journalEntries.companyId, ctx.company.id), gte(schema.journalEntries.date, from), lte(schema.journalEntries.date, to)];
  if (status) conds.push(eq(schema.journalEntries.status, status));
  const rows = await db.select({
    e: schema.journalEntries, partner: schema.partners.name,
    total: sql<string>`(select coalesce(sum(debit),0) from journal_lines l where l.entry_id = ${schema.journalEntries.id})`,
    typed: entryMemo(),
  }).from(schema.journalEntries).leftJoin(schema.partners, eq(schema.partners.id, schema.journalEntries.partnerId))
    .where(and(...conds)).orderBy(desc(schema.journalEntries.date), desc(schema.journalEntries.createdAt)).limit(500);
  const base = `/journal?from=${from}&to=${to}`;
  return (
    <div className="stack">
      <PageHead title={t("jr_title")}>
        <a className="btn" href={`/api/export/journal?from=${from}&to=${to}`}>{t("export_csv")}</a>
        {ctx.can("journal", "write") ? <Link href="/journal/new" className="btn primary">{t("jr_new")}</Link> : null}
      </PageHead>
      <div className="row">
        <Tabs current={status || "all"} items={[
          { key: "all", href: base, label: t("all") },
          { key: "draft", href: `${base}&status=draft`, label: t("st_draft") },
          { key: "posted", href: `${base}&status=posted`, label: t("st_posted") },
        ]} />
        <span className="spacer" />
        <form className="row" style={{ gap: 6 }}>
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <input type="date" name="from" id="from" defaultValue={from} style={{ width: "auto" }} aria-label={t("from")} />
          <input type="date" name="to" id="to" defaultValue={to} style={{ width: "auto" }} aria-label={t("to")} />
          <button type="submit" className="btn sm">{t("show")}</button>
        </form>
      </div>
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t("memo")}</th><th>{t("partner")}</th><th>{t("source")}</th><th className="num">{t("amount")}</th><th>{t("status")}</th></tr></thead>
            <tbody>
              {rows.map(({ e, partner, total, typed }) => {
                // The whole line opens the transaction itself: the invoice, bill or voucher behind it, or its entry.
                const href = e.status === "draft" ? `/journal/${e.id}` : txnHref(e);
                const cell = (v: React.ReactNode, i: number) => <Link className="rowfill" href={href} tabIndex={i ? -1 : 0}>{v || "\u00a0"}</Link>;
                return (
                  <tr key={e.id} className="rowclick">
                    <td className="num" style={{ textAlign: "left" }}>{cell(e.number ?? "—", 0)}</td>
                    <td className="num" style={{ textAlign: "left" }}>{cell(e.date, 1)}</td>
                    <td>{cell(<b>{typed || e.reference || "—"}</b>, 2)}</td>
                    <td>{cell(partner ?? "", 3)}</td><td className="small muted">{cell(t(`src_${e.source}`), 4)}</td>
                    <td className="num">{cell(money(Number(total)), 5)}</td>
                    <td>{cell(<Pill kind={e.status}>{t(e.status === "posted" ? "st_posted" : "st_draft")}</Pill>, 6)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
