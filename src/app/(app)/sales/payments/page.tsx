import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { round2, today } from "@/lib/format";
import { moneyAccounts } from "@/lib/ledger";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { payDocAction } from "../../doc-actions";

export const metadata = { title: "Receive payments" };

/** Money coming in: what customers still owe, and what they have paid. */
export default async function ReceivePaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("sales");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [open, recent, accounts] = await Promise.all([
    db.select({ d: schema.invoices, customer: schema.partners.name }).from(schema.invoices).innerJoin(schema.partners, eq(schema.partners.id, schema.invoices.partnerId))
      .where(and(eq(schema.invoices.companyId, ctx.company.id), inArray(schema.invoices.status, ["open", "partial"]))).orderBy(schema.invoices.dueDate),
    db.select({ p: schema.payments, number: schema.invoices.number, invoiceId: schema.invoices.id, customer: schema.partners.name }).from(schema.payments)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.payments.invoiceId)).innerJoin(schema.partners, eq(schema.partners.id, schema.invoices.partnerId))
      .where(eq(schema.payments.companyId, ctx.company.id)).orderBy(desc(schema.payments.date), desc(schema.payments.createdAt)).limit(50),
    moneyAccounts(db, ctx.company.id),
  ]);
  const owed = round2(open.reduce((s, r) => s + r.d.total - r.d.amountPaid, 0));
  const write = ctx.can("sales", "write");
  return (
    <div className="stack">
      <PageHead title={t("nav_receive_payments")} />
      <ErrorNote message={err(q("error"))} />
      <div className="panel stack">
        <h2>{t("pay_outstanding")} <span className="small muted">· {money(owed, 2)} {ctx.company.currency}</span></h2>
        {open.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("customer")}</th><th>{t("due_date")}</th><th className="num">{t("balance_due")}</th>{write ? <th>{t("record_payment")}</th> : null}</tr></thead>
            <tbody>{open.map(({ d, customer }) => {
              const balance = round2(d.total - d.amountPaid);
              return (
                <tr key={d.id}>
                  <td><Link className="rowlink" href={`/sales/invoices/${d.id}`}>{d.number}</Link></td>
                  <td>{customer}</td>
                  <td style={{ color: d.dueDate < today() ? "var(--bad)" : undefined }}>{d.dueDate}</td>
                  <td className="num">{money(balance, 2)}</td>
                  {write ? (
                    <td>
                      <form action={payDocAction} className="row" style={{ gap: 6 }}>
                        <input type="hidden" name="kind" value="invoice" /><input type="hidden" name="id" value={d.id} />
                        <input id={`pd-${d.id}`} type="date" name="date" defaultValue={today()} required aria-label={t("date")} style={{ width: "auto" }} />
                        <input id={`pa-${d.id}`} name="amount" className="num" inputMode="decimal" defaultValue={balance} required aria-label={t("amount")} style={{ width: 110 }} />
                        <select id={`pm-${d.id}`} name="moneyAccountId" required aria-label={t("paid_into")} style={{ width: "auto" }}>
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.nameEn}</option>)}
                        </select>
                        <input id={`pr-${d.id}`} name="reference" placeholder={t("reference")} aria-label={t("reference")} style={{ width: 110 }} />
                        <button type="submit" className="btn primary sm">{t("record_payment")}</button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Empty>{t("pay_none_owed")}</Empty>}
      </div>
      <div className="panel stack">
        <h2>{t("pay_received")}</h2>
        {recent.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("date")}</th><th>{t("number")}</th><th>{t("customer")}</th><th>{t("reference")}</th><th className="num">{t("amount")}</th></tr></thead>
            <tbody>{recent.map(({ p, number, invoiceId, customer }) => (
              <tr key={p.id}><td>{p.date}</td><td><Link href={`/sales/invoices/${invoiceId}`}>{number}</Link></td><td>{customer}</td><td>{p.reference}</td><td className="num">{money(p.amount, 2)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
