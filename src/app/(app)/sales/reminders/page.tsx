import Link from "next/link";
import { getDb } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { mailConfigured } from "@/lib/mail";
import { overdueInvoices } from "@/lib/reminders";
import { LocalTime } from "@/components/datetime";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { remindAll, remindOne, setReminderDays } from "./actions";

export const metadata = { title: "Payment reminders" };

/** Overdue invoices, with a reminder to send to each customer, by hand or every so many days. */
export default async function RemindersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("sales");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const list = await overdueInvoices(db, ctx.company.id);
  const write = ctx.can("sales", "write");
  const days = ctx.company.settings.reminderDays ?? 0;
  const total = list.reduce((s, o) => s + o.balance, 0);
  return (
    <div className="stack">
      <PageHead title={t("rem_title")}>
        {write && list.some((o) => o.customer.email) ? <form action={remindAll}><button type="submit" className="btn primary">{t("rem_send_all")}</button></form> : null}
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("sent") ? <div className="note ok small">{t("pdf_sent_to")} {q("sent")}</div> : null}
      {q("count") ? <div className="note ok small">{t("rem_sent_n").replace("{n}", q("count"))}</div> : null}
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {!mailConfigured() && process.env.NODE_ENV === "production" ? <div className="note warn small">{t("err_mail_off")}</div> : null}
      <div className="panel stack">
        <h2>{t("rem_overdue")} <span className="small muted">· {money(total, 2)} {ctx.company.currency}</span></h2>
        {list.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("customer")}</th><th>{t("due_date")}</th><th className="num">{t("rem_days_late")}</th><th className="num">{t("balance_due")}</th><th>{t("rem_last")}</th>{write ? <th /> : null}</tr></thead>
            <tbody>{list.map((o) => (
              <tr key={o.d.id}>
                <td><Link className="rowlink" href={`/sales/invoices/${o.d.id}`}>{o.d.number}</Link></td>
                <td>{o.customer.name}<div className="small muted">{o.customer.email || t("rem_no_email")}</div></td>
                <td>{o.d.dueDate}</td>
                <td className="num" style={{ color: o.late > 30 ? "var(--bad)" : undefined }}>{o.late}</td>
                <td className="num">{money(o.balance, 2)}</td>
                <td className="small">{o.d.remindedAt ? <><LocalTime value={o.d.remindedAt.toISOString()} /> · {o.d.reminders}×</> : "-"}</td>
                {write ? <td>{o.customer.email ? <form action={remindOne}><input type="hidden" name="id" value={o.d.id} /><button type="submit" className="btn sm">{t("rem_send")}</button></form> : <Link className="btn sm ghost" href={`/sales/customers?edit=${o.customer.id}#form`}>{t("rem_add_email")}</Link>}</td> : null}
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("rem_none")}</Empty>}
      </div>
      {write ? (
        <form action={setReminderDays} className="panel stack">
          <h2>{t("rem_auto_title")}</h2>
          <div className="small muted">{t("rem_auto_help")}</div>
          <div className="row" style={{ gap: 8 }}>
            <select name="days" defaultValue={String(days)} aria-label={t("rem_auto_title")} style={{ width: "auto" }}>
              {[0, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d ? t("rem_every_days").replace("{n}", String(d)) : t("rem_off")}</option>)}
            </select>
            <button type="submit" className="btn">{t("save")}</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
