import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { balances, moneyAccounts } from "@/lib/ledger";
import { isIsoDate, parseAmount, today } from "@/lib/format";
import { reconcileView } from "@/lib/banking";
import { ConfirmButton } from "@/components/editors";
import { ReconcileForm } from "@/components/ReconcileForm";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { saveReconciliation, undoReconcile } from "../actions";

export const metadata = { title: "Reconcile" };

export default async function ReconcilePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("banking");
  const { t, err, money, accName, lang } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const accounts = (await moneyAccounts(db, ctx.company.id)).filter((a) => !a.currency);
  const account = accounts.find((a) => a.id === q("account"));
  const date = isIsoDate(q("date")) ? q("date") : today();
  const started = !!account && q("ending") !== "";
  const ending = parseAmount(q("ending"));
  const view = started ? await reconcileView(db, ctx.company.id, account.id, date) : null;
  const [bal, history] = await Promise.all([
    balances(db, ctx.company.id),
    db.select({ r: schema.bankReconciliations, who: schema.users.name }).from(schema.bankReconciliations)
      .leftJoin(schema.users, eq(schema.users.id, schema.bankReconciliations.createdBy))
      .where(and(eq(schema.bankReconciliations.companyId, ctx.company.id), ...(account ? [eq(schema.bankReconciliations.accountId, account.id)] : [])))
      .orderBy(desc(schema.bankReconciliations.statementDate), desc(schema.bankReconciliations.createdAt)).limit(50),
  ]);
  const name = (id: string) => { const a = accounts.find((x) => x.id === id); return a ? `${a.code} ${accName(a)}` : ""; };
  const latest = new Map<string, string>();
  for (const { r } of history) if (!latest.has(r.accountId)) latest.set(r.accountId, r.id);
  return (
    <div className="stack">
      <PageHead title={t("nav_reconcile")} />
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("bk_reconciled")}</div> : null}
      {accounts.length ? (
        <form method="get" className="panel stack">
          <div className="small muted">{t("bk_reconcile_help")}</div>
          <div className="fields">
            <label className="f">{t("account")}
              <select id="r-account" name="account" required defaultValue={account?.id ?? ""}>
                <option value="" disabled>{t("choose_account")}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)} ({money(bal.get(a.id)?.net ?? 0)})</option>)}
              </select></label>
            <label className="f">{t("bk_statement_date")}<input id="r-date" name="date" type="date" required defaultValue={date} /></label>
            <label className="f">{t("bk_statement_ending")}<input id="r-ending" name="ending" className="num" inputMode="decimal" required defaultValue={q("ending")} /></label>
          </div>
          <div><button type="submit" className="btn">{t("bk_start_reconcile")}</button></div>
        </form>
      ) : <div className="panel"><Empty>{t("bank_no_accounts")}</Empty></div>}
      {view && account ? (
        <div className="panel stack">
          <h2>{account.code} · {accName(account)} · {date}</h2>
          <ReconcileForm action={saveReconciliation} accountId={account.id} date={date} ending={ending} opening={view.opening} canWrite={ctx.can("banking", "write")} lang={lang}
            lines={view.lines.map((x) => ({ id: x.l.id, date: x.date, reference: x.reference || String(x.number ?? ""), memo: x.memo, amount: x.l.debit - x.l.credit }))}
            labels={{ date: t("date"), reference: t("reference"), memo: t("memo"), moneyIn: t("money_in"), moneyOut: t("money_out"), opening: t("bk_last_cleared"), cleared: t("bk_cleared"), ending: t("bk_statement_ending"), difference: t("not_balanced"), finish: t("bk_finish_reconcile"), all: t("all") }} />
          {!view.lines.length ? <Empty>{t("bk_nothing_to_tick")}</Empty> : null}
        </div>
      ) : null}
      <div className="panel stack">
        <h2>{t("bk_reconciliations")}</h2>
        {history.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("bk_statement_date")}</th><th>{t("account")}</th><th className="num">{t("bk_last_cleared")}</th><th className="num">{t("bk_statement_ending")}</th><th className="num">{t("bk_lines_cleared")}</th><th>{t("audit_who")}</th><th /></tr></thead>
            <tbody>{history.map(({ r, who }) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{r.statementDate}</td>
                <td><Link className="rowlink" href={`/banking/${r.accountId}`}>{name(r.accountId)}</Link></td>
                <td className="num">{money(r.openingBalance, 2)}</td><td className="num">{money(r.endingBalance, 2)}</td><td className="num">{r.clearedCount}</td><td>{who}</td>
                <td>{latest.get(r.accountId) === r.id && ctx.can("banking", "write") ? (
                  <form action={undoReconcile}><input type="hidden" name="id" value={r.id} /><ConfirmButton className="btn sm ghost" confirmLabel={t("confirm")}>{t("bk_undo")}</ConfirmButton></form>
                ) : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
