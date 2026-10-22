import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { paymentsConfigured, planPrices } from "@/lib/billing";
import { money as fmt } from "@/lib/format";
import { Empty, ErrorNote, PageHead, Pill } from "@/components/ui";
import { redirect } from "next/navigation";
import { subscribe } from "./actions";

export const metadata = { title: "Subscription" };

export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getCtx();
  if (!ctx.isAdmin) redirect("/no-access");
  const { t, err, lang } = await getI18n();
  const q = await sp(searchParams);
  const price = planPrices();
  const db = await getDb();
  const history = await db.select().from(schema.subscriptionPayments).where(eq(schema.subscriptionPayments.companyId, ctx.company.id))
    .orderBy(desc(schema.subscriptionPayments.createdAt)).limit(24);
  const paidUntil = ctx.company.paidUntil && ctx.company.paidUntil.getTime() > Date.now() ? ctx.company.paidUntil : null;
  const amount = (n: number) => `${fmt(n, lang, 2)} ${price.currency}`;
  const statusKind = { pending: "draft", successful: "paid", failed: "void" } as const;
  return (
    <div className="stack">
      <PageHead title={t("billing_title")} />
      <ErrorNote message={err(q("error"))} />
      {q("paid") ? <div className="note ok">{t("billing_thanks")}</div> : null}
      {q("pending") ? <div className="note warn">{t("billing_pending")}</div> : null}
      <div className="panel stack">
        <div className="label">{t("billing_status")}</div>
        <div className="hero-num" style={{ fontSize: 24 }}>
          {paidUntil ? `${t("billing_active_until")} ${paidUntil.toISOString().slice(0, 10)}`
            : ctx.locked ? t("billing_expired") : `${t("billing_trial")} · ${ctx.trialDaysLeft} ${t("billing_days_left")}`}
        </div>
        <div className="small muted">{t("billing_plan_help")}</div>
      </div>
      {!paymentsConfigured() ? <div className="note warn">{t("err_payments_off")}</div> : null}
      <div className="grid2">
        {(["monthly", "yearly"] as const).map((period) => (
          <form key={period} action={subscribe} className="panel stack">
            <input type="hidden" name="period" value={period} />
            <h2>{t(period === "monthly" ? "billing_monthly" : "billing_yearly")}</h2>
            <div className="hero-num">{amount(price[period])}</div>
            <div className="small muted">{t(period === "monthly" ? "billing_monthly_help" : "billing_yearly_help")}</div>
            <div><button type="submit" className={period === "yearly" ? "btn primary" : "btn"} disabled={!paymentsConfigured()}>{t("billing_pay")}</button></div>
          </form>
        ))}
      </div>
      <div className="panel stack">
        <h2>{t("billing_history")}</h2>
        {history.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("date")}</th><th>{t("reference")}</th><th>{t("billing_period")}</th><th className="num">{t("amount")}</th><th>{t("status")}</th><th>{t("billing_covers")}</th></tr></thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.id}>
                  <td className="num" style={{ textAlign: "left" }}>{p.createdAt.toISOString().slice(0, 10)}</td>
                  <td><code className="k">{p.txRef}</code></td>
                  <td>{t(p.period === "monthly" ? "billing_monthly" : "billing_yearly")}</td>
                  <td className="num">{fmt(p.amount, lang, 2)} {p.currency}</td>
                  <td><Pill kind={statusKind[p.status]}>{t(`pay_${p.status}`)}</Pill></td>
                  <td className="small">{p.periodStart && p.periodEnd ? `${p.periodStart.toISOString().slice(0, 10)} → ${p.periodEnd.toISOString().slice(0, 10)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
