import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isIsoDate, isUuid, today } from "@/lib/format";
import { customerStatement } from "@/lib/statements";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { sendStatementEmail } from "../../send-actions";

export const metadata = { title: "Customer statements" };

/** A customer's statement on screen, with the PDF and a way to email it. */
export default async function StatementsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("sales");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const customers = await db.select().from(schema.partners).where(and(eq(schema.partners.companyId, ctx.company.id), inArray(schema.partners.kind, ["customer", "both"]))).orderBy(schema.partners.name);
  const to = isIsoDate(q("to")) ? q("to") : today();
  const from = isIsoDate(q("from")) ? q("from") : `${to.slice(0, 4)}-01-01`;
  const id = q("customer");
  const s = isUuid(id) && customers.some((c) => c.id === id) && from <= to ? await customerStatement(ctx.company.id, id, from, to) : null;
  const qs = `from=${from}&to=${to}`;
  const typeLabel = { invoice: t("inv_invoice"), receipt: t("sr_receipt"), payment: t("r_payment"), credit_note: t("cn_note") };
  const buckets = ["aging_current", "aging_30", "aging_60", "aging_90", "aging_over"] as const;
  return (
    <div className="stack">
      <PageHead title={t("stm_page_title")} />
      <ErrorNote message={err(q("error"))} />
      {q("sent") ? <div className="note ok small">{t("pdf_sent_to")} {q("sent")}</div> : null}
      <form className="panel row" method="get" style={{ gap: 10, alignItems: "end" }}>
        <label className="f" style={{ minWidth: 240 }}>{t("customer")}
          <select name="customer" defaultValue={id} required>
            <option value="" disabled>{t("choose")}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label className="f">{t("from")}<input type="date" name="from" defaultValue={from} /></label>
        <label className="f">{t("to")}<input type="date" name="to" defaultValue={to} /></label>
        <button type="submit" className="btn primary">{t("show")}</button>
      </form>

      {s ? <>
        <div className="kpis">
          <div className="panel kpi"><div className="label">{t("stm_opening")}</div><div className="v">{money(s.opening, 2)}</div></div>
          <div className="panel kpi"><div className="label">{t("stm_charges")}</div><div className="v">{money(s.charges, 2)}</div></div>
          <div className="panel kpi"><div className="label">{t("stm_credits")}</div><div className="v">{money(s.credits, 2)}</div></div>
          <div className="panel kpi"><div className="label">{t("stm_balance_due")} ({ctx.company.currency})</div><div className="v">{money(s.closing, 2)}</div></div>
        </div>
        <div className="panel stack">
          <div className="row">
            <h2 style={{ flex: 1 }}>{s.customer.name}</h2>
            <a className="btn sm" href={`/api/pdf/statement/${s.customer.id}?${qs}`} target="_blank" rel="noopener">{t("pdf_download")}</a>
          </div>
          {s.rows.length || s.opening ? (
            <div className="tbl-wrap"><table>
              <thead><tr><th>{t("date")}</th><th>{t("r_txn_type")}</th><th>{t("number")}</th><th>{t("description")}</th><th className="num">{t("stm_charges")}</th><th className="num">{t("stm_credits")}</th><th className="num">{t("balance")}</th></tr></thead>
              <tbody>
                <tr><td colSpan={6}><b>{t("stm_opening")}</b></td><td className="num"><b>{money(s.opening, 2)}</b></td></tr>
                {s.rows.map((r, i) => (
                  <tr key={i}><td style={{ whiteSpace: "nowrap" }}>{r.date}</td><td>{typeLabel[r.type]}</td><td><Link href={`/sales/invoices/${r.invoiceId}`}>{r.number}</Link></td><td className="small">{r.details}</td>
                    <td className="num">{r.charge ? money(r.charge, 2) : ""}</td><td className="num">{r.credit ? money(r.credit, 2) : ""}</td><td className="num">{money(r.balance, 2)}</td></tr>
                ))}
                <tr className="total"><td colSpan={4}>{t("stm_closing")}</td><td className="num">{money(s.charges, 2)}</td><td className="num">{money(s.credits, 2)}</td><td className="num">{money(s.closing, 2)}</td></tr>
              </tbody>
            </table></div>
          ) : <Empty>{t("nothing_yet")}</Empty>}
          <div className="tbl-wrap"><table>
            <thead><tr>{buckets.map((b) => <th key={b} className="num">{t(b)}</th>)}</tr></thead>
            <tbody><tr>{s.aging.map((v, i) => <td key={i} className="num">{money(v, 2)}</td>)}</tr></tbody>
          </table></div>
        </div>
        {ctx.can("sales", "write") ? (
          <form action={sendStatementEmail} className="panel stack">
            <h2>{t("stm_send")}</h2>
            <input type="hidden" name="customer" value={s.customer.id} /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
            <div className="fields">
              <label className="f">{t("email")}<input id="stm-to" name="email" type="email" defaultValue={s.customer.email} required /></label>
            </div>
            <label className="f">{t("pdf_message")}<textarea id="stm-msg" name="message" rows={3} placeholder={t("stm_message_default")} /></label>
            <div><button type="submit" className="btn">{t("pdf_send")}</button></div>
          </form>
        ) : null}
      </> : <div className="panel"><Empty>{t("stm_choose")}</Empty></div>}
    </div>
  );
}
