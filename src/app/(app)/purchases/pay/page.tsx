import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { balances, moneyAccounts } from "@/lib/ledger";
import { round2, today } from "@/lib/format";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { payBills } from "./actions";

export const metadata = { title: "Pay bill" };

/** All unpaid bills in one place: tick the ones to pay now, from one account. */
export default async function PayBillsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("purchases");
  const { t, err, money, accName } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [rows, accounts, bal] = await Promise.all([
    db.select({ b: schema.bills, vendor: schema.partners.name }).from(schema.bills).innerJoin(schema.partners, eq(schema.partners.id, schema.bills.partnerId))
      .where(and(eq(schema.bills.companyId, ctx.company.id), inArray(schema.bills.status, ["open", "partial"]))).orderBy(asc(schema.bills.dueDate), asc(schema.bills.number)),
    moneyAccounts(db, ctx.company.id), balances(db, ctx.company.id),
  ]);
  const home = accounts.filter((a) => !a.currency);
  const now = today();
  const canPay = ctx.can("purchases", "write");
  const table = (
    <div className="tbl-wrap"><table>
      <thead><tr>{canPay ? <th style={{ width: 32 }} /> : null}<th>{t("supplier")}</th><th>{t("number")}</th><th>{t("due_date")}</th><th className="num">{t("total")}</th><th className="num">{t("balance")}</th>{canPay ? <th className="num">{t("r_pay_now")}</th> : null}</tr></thead>
      <tbody>{rows.map(({ b, vendor }) => {
        const left = round2(b.total - b.amountPaid);
        return (
          <tr key={b.id}>
            {canPay ? <td><input type="checkbox" name="bill" value={b.id} aria-label={`${vendor} ${b.number}`} style={{ width: "auto" }} /></td> : null}
            <td>{vendor}</td>
            <td><Link className="rowlink" href={`/purchases/bills/${b.id}`}>{b.number}</Link></td>
            <td style={{ whiteSpace: "nowrap", color: b.dueDate < now ? "var(--bad)" : undefined }}>{b.dueDate}</td>
            <td className="num">{money(b.total, 2)}</td><td className="num">{money(left, 2)}</td>
            {canPay ? <td style={{ width: 150 }}><input id={`amount-${b.id}`} name={`amount_${b.id}`} className="num" inputMode="decimal" defaultValue={left} aria-label={t("r_pay_now")} /></td> : null}
          </tr>
        );
      })}</tbody>
    </table></div>
  );
  return (
    <div className="stack">
      <PageHead title={t("nav_pay_bill")}><Link className="btn" href="/purchases/bills">{t("nav_bills")}</Link></PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("paid") ? <div className="note ok small">{t("saved")}</div> : null}
      {!rows.length ? <div className="panel"><Empty>{t("r_no_unpaid_bills")}</Empty></div> : canPay ? (
        <form action={payBills} className="panel stack">
          <div className="fields">
            <label className="f">{t("date")}<input id="pay-date" name="date" type="date" required defaultValue={now} /></label>
            <label className="f">{t("paid_from")}
              <select id="pay-account" name="moneyAccountId" required defaultValue="">
                <option value="" disabled>{t("none")}</option>
                {home.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)} ({money(bal.get(a.id)?.net ?? 0)})</option>)}
              </select></label>
            <label className="f">{t("r_pay_reference")}<input id="pay-reference" name="reference" /></label>
          </div>
          {table}
          <div><button type="submit" className="btn primary">{t("nav_pay_bill")}</button></div>
        </form>
      ) : <div className="panel">{table}</div>}
    </div>
  );
}
