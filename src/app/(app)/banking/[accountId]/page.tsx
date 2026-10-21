import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { balances } from "@/lib/ledger";
import { daysBetween } from "@/lib/format";
import { Empty, ErrorNote, PageHead, Pill } from "@/components/ui";
import { bookLine, ignoreLine, importStatement, matchLine, suggestWithAi } from "../actions";

export const metadata = { title: "Bank account" };

export default async function BankAccountPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: SearchParams }) {
  const { accountId } = await params;
  const ctx = await getCtx();
  const { t, err, accName, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [acc] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.companyId, ctx.company.id)));
  if (!acc) notFound();
  const [bal, lines, bookLines, allAccounts, projects] = await Promise.all([
    balances(db, ctx.company.id),
    db.select().from(schema.bankLines).where(and(eq(schema.bankLines.companyId, ctx.company.id), eq(schema.bankLines.accountId, accountId)))
      .orderBy(desc(schema.bankLines.date)).limit(400),
    db.select({ l: schema.journalLines, date: schema.journalEntries.date, memo: schema.journalEntries.memo, entryId: schema.journalEntries.id })
      .from(schema.journalLines).innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
      .where(and(eq(schema.journalLines.companyId, ctx.company.id), eq(schema.journalLines.accountId, accountId),
        eq(schema.journalLines.reconciled, false), eq(schema.journalEntries.status, "posted")))
      .orderBy(desc(schema.journalEntries.date)).limit(300),
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), ne(schema.accounts.id, accountId))).orderBy(schema.accounts.code),
    db.select().from(schema.projects).where(eq(schema.projects.companyId, ctx.company.id)).orderBy(schema.projects.code),
  ]);
  const open = lines.filter((l) => l.status === "open");
  const done = lines.filter((l) => l.status !== "open").slice(0, 25);

  // Suggest one ledger line per statement line: same amount on the same side, within ten days.
  const used = new Set<string>();
  const candidate = new Map<string, (typeof bookLines)[number]>();
  for (const l of open) {
    const c = bookLines.find((b) => !used.has(b.l.id) && Math.abs(daysBetween(b.date, l.date)) <= 10
      && (l.amount > 0 ? b.l.debit === l.amount : b.l.credit === -l.amount));
    if (c) { used.add(c.l.id); candidate.set(l.id, c); }
  }
  const matchedIds = lines.filter((l) => l.journalLineId).map((l) => l.journalLineId!);
  const linked = matchedIds.length ? await db.select({ id: schema.journalLines.id, entryId: schema.journalLines.entryId }).from(schema.journalLines).where(inArray(schema.journalLines.id, matchedIds)) : [];
  const entryOf = new Map(linked.map((x) => [x.id, x.entryId]));

  const accountOptions = allAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>);
  return (
    <div className="stack">
      <PageHead title={`${acc.code} · ${accName(acc)}`}>
        <Link className="btn ghost" href="/banking">{t("back")}</Link>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("imported") ? <div className="note ok small">{q("imported")} {t("bank_imported")}</div> : null}
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("bank_books")}</div><div className="v">{money(bal.get(acc.id)?.net ?? 0)}</div></div>
        <div className="panel kpi"><div className="label">{t("bank_open")}</div><div className="v">{open.length}</div></div>
        <div className="panel kpi"><div className="label">{t("bank_unreconciled_book")}</div><div className="v">{bookLines.length}</div></div>
      </div>

      <div className="panel stack">
        <div className="row"><h2 style={{ flex: 1 }}>{t("bank_open")}</h2>
          {ctx.canWrite && open.length ? (
            <form action={suggestWithAi}><input type="hidden" name="accountId" value={acc.id} /><button type="submit" className="btn">{t("bank_suggest_ai")}</button></form>
          ) : null}
        </div>
        {open.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("date")}</th><th>{t("description")}</th><th className="num">{t("money_in")}</th><th className="num">{t("money_out")}</th><th>{t("bank_suggestion")} / {t("bank_counter")}</th></tr></thead>
            <tbody>
              {open.map((l) => {
                const c = candidate.get(l.id);
                return (
                  <tr key={l.id}>
                    <td className="num" style={{ textAlign: "left" }}>{l.date}</td>
                    <td>{l.description}{l.reference ? <div className="small muted">{l.reference}</div> : null}</td>
                    <td className="num">{l.amount > 0 ? money(l.amount, 2) : ""}</td>
                    <td className="num">{l.amount < 0 ? money(-l.amount, 2) : ""}</td>
                    <td style={{ minWidth: 320 }}>
                      {!ctx.canWrite ? null : c ? (
                        <form action={matchLine} className="row" style={{ gap: 6 }}>
                          <input type="hidden" name="accountId" value={acc.id} /><input type="hidden" name="id" value={l.id} /><input type="hidden" name="journalLineId" value={c.l.id} />
                          <span className="small" style={{ flex: 1 }}>{c.date} · {c.memo}</span>
                          <button type="submit" className="btn sm primary">{t("bank_match")}</button>
                        </form>
                      ) : (
                        <div className="row" style={{ gap: 6 }}>
                          <form action={bookLine} className="row" style={{ gap: 6, flex: 1 }}>
                            <input type="hidden" name="accountId" value={acc.id} /><input type="hidden" name="id" value={l.id} />
                            <select name="counterId" id={`ctr-${l.id}`} defaultValue={l.suggestedAccountId ?? ""} style={{ flex: 1, minWidth: 160 }} aria-label={t("bank_counter")}>
                              <option value="">—</option>{accountOptions}
                            </select>
                            <select name="projectId" id={`prj-${l.id}`} defaultValue="" style={{ width: 90 }} aria-label={t("project")}>
                              <option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
                            </select>
                            <button type="submit" className="btn sm primary">{t("bank_book")}</button>
                          </form>
                          <form action={ignoreLine}><input type="hidden" name="accountId" value={acc.id} /><input type="hidden" name="id" value={l.id} />
                            <button type="submit" className="btn sm ghost">{t("bank_ignore")}</button></form>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>

      {ctx.canWrite ? (
        <form action={importStatement} className="panel stack">
          <h2>{t("bank_import")}</h2>
          <input type="hidden" name="accountId" value={acc.id} />
          <div className="small muted">{t("bank_import_help")}</div>
          <textarea id="text" name="text" rows={7} placeholder={"Date,Description,Amount\n15/10/2026,Fuel - station,-59000\n18/10/2026,Payment INV-0007,1180000"} required />
          <div><button type="submit" className="btn primary">{t("bank_import_btn")}</button></div>
        </form>
      ) : null}

      <div className="grid2">
        <div className="panel stack">
          <h2>{t("bank_unreconciled_book")}</h2>
          {bookLines.length ? <table><tbody>
            {bookLines.slice(0, 30).map((b) => (
              <tr key={b.l.id}><td className="num" style={{ textAlign: "left" }}>{b.date}</td><td><Link className="rowlink" href={`/journal/${b.entryId}`}>{b.memo}</Link></td>
                <td className="num">{b.l.debit ? money(b.l.debit) : `-${money(b.l.credit)}`}</td></tr>
            ))}
          </tbody></table> : <Empty>{t("nothing_yet")}</Empty>}
        </div>
        <div className="panel stack">
          <h2>{t("bank_matched")} / {t("bank_booked")}</h2>
          {done.length ? <table><tbody>
            {done.map((l) => (
              <tr key={l.id}><td className="num" style={{ textAlign: "left" }}>{l.date}</td><td>{l.description}</td><td className="num">{money(l.amount)}</td>
                <td><Pill kind={l.status}>{t(l.status === "matched" ? "bank_matched" : l.status === "booked" ? "bank_booked" : "bank_ignored")}</Pill></td>
                <td>{l.journalLineId && entryOf.get(l.journalLineId) ? <Link className="small" href={`/journal/${entryOf.get(l.journalLineId)}`}>→</Link> : null}</td></tr>
            ))}
          </tbody></table> : <Empty>{t("nothing_yet")}</Empty>}
        </div>
      </div>
    </div>
  );
}
