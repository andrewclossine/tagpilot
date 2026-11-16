import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { paymentsConfigured, pickCurrency, planPrices } from "@/lib/billing";
import { ModulePicker } from "@/components/ModulePicker";
import { money as fmt } from "@/lib/format";
import { Empty, ErrorNote, PageHead, Pill } from "@/components/ui";
import { redirect } from "next/navigation";
import { changeModules, reportTransferAction, subscribe } from "./actions";
import { openRefunds } from "@/lib/subscriptions";
import Link from "next/link";

export const metadata = { title: "Subscription" };

export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getCtx();
  if (!ctx.isAdmin) redirect("/no-access");
  const { t, err, lang } = await getI18n();
  const q = await sp(searchParams);
  // Pay in any currency the platform offers; the organisation's own currency comes first when it is offered.
  const { currency, currencies } = await pickCurrency(q("cur"), ctx.company.currency);
  const price = await planPrices(ctx.company.modules, currency);
  const unpaid = ctx.company.modules.filter((m) => !ctx.has(m));
  const db = await getDb();
  const history = await db.select().from(schema.subscriptionPayments).where(eq(schema.subscriptionPayments.companyId, ctx.company.id))
    .orderBy(desc(schema.subscriptionPayments.createdAt)).limit(24);
  const paidUntil = ctx.company.paidUntil && ctx.company.paidUntil.getTime() > Date.now() ? ctx.company.paidUntil : null;
  const amount = (n: number) => `${fmt(n, lang, 2)} ${price.currency}`;
  const statusKind = { pending: "draft", successful: "paid", failed: "void", refunded: "cancelled" } as const;
  const refunds = await openRefunds([ctx.company.id]);
  // How to pay TAGPILOT outside the card checkout: set on the server, so it can change without a release.
  const instructions = (process.env.PAYMENT_INSTRUCTIONS ?? "").replaceAll("\\n", "\n").trim(); // "\n" written in the setting starts a new line
  return (
    <div className="stack">
      <PageHead title={t("billing_title")} />
      <ErrorNote message={err(q("error"))} />
      {q("paid") ? <div className="note ok">{t("billing_thanks")}</div> : null}
      {q("pending") ? <div className="note warn">{t("billing_pending")}</div> : null}
      {q("reported") ? <div className="note ok">{t("tr_reported")}</div> : null}
      {refunds.map((r) => (
        <div key={r.id} className="note warn row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <span>{t(r.status === "awaiting_details" ? "rf_banner_waiting" : "rf_banner_received").replace("{amount}", `${fmt(r.amount, lang, 2)} ${r.currency}`)}</span>
          <Link className="btn sm" href={`/refund/${r.token}`}>{t(r.status === "awaiting_details" ? "rf_give_details" : "rf_change_details")}</Link>
        </div>
      ))}
      <div className="panel stack">
        <div className="label">{t("billing_status")}</div>
        <div className="hero-num" style={{ fontSize: 24 }}>
          {paidUntil ? `${t("billing_active_until")} ${paidUntil.toISOString().slice(0, 10)}`
            : ctx.locked ? t("billing_expired") : `${t("billing_trial")} · ${ctx.trialDaysLeft} ${t("billing_days_left")}`}
        </div>
        <div className="small muted">{t("billing_plan_help")}</div>
      </div>
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      <form action={changeModules} className="panel stack">
        <h2>{t("modules_title")}</h2>
        <div className="small muted">{t("modules_change_help")}</div>
        <ModulePicker t={t} lang={lang} prices={price.prices} currency={price.currency} selected={ctx.company.modules} />
        {unpaid.length ? <div className="note warn small">{t("modules_unpaid")}: {unpaid.map((m) => t(`module_${m}`)).join(", ")}</div> : null}
        <div><button type="submit" className="btn">{t("save")}</button></div>
      </form>
      {!paymentsConfigured() ? <div className="note warn">{t("err_payments_off")}</div> : null}
      {currencies.length > 1 ? (
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="small muted">{t("billing_pay_in")}</span>
          {currencies.map((c) => <Link key={c} className={c === price.currency ? "btn sm primary" : "btn sm"} href={`/billing?cur=${c}`} aria-pressed={c === price.currency}>{c}</Link>)}
        </div>
      ) : null}
      <div className="grid2">
        {(["monthly", "yearly"] as const).map((period) => (
          <form key={period} action={subscribe} className="panel stack">
            <input type="hidden" name="period" value={period} />
            <input type="hidden" name="currency" value={price.currency} />
            <h2>{t(period === "monthly" ? "billing_monthly" : "billing_yearly")}</h2>
            <div className="hero-num">{amount(price[period])}</div>
            <div className="small muted">{t(period === "monthly" ? "billing_monthly_help" : "billing_yearly_help")}</div>
            <div><button type="submit" className={period === "yearly" ? "btn primary" : "btn"} disabled={!paymentsConfigured()}>{t("billing_pay")}</button></div>
          </form>
        ))}
      </div>
      <form action={reportTransferAction} className="panel stack">
        <h2>{t("tr_title")}</h2>
        <div className="small muted">{t("tr_help")}</div>
        {instructions ? <div className="note small" style={{ whiteSpace: "pre-line" }}>{instructions}</div> : null}
        <div className="fields">
          <label className="f">{t("billing_period")}<select id="tr-period" name="period" defaultValue="monthly"><option value="monthly">{t("billing_monthly")}</option><option value="yearly">{t("billing_yearly")}</option></select></label>
          <label className="f">{t("amount")}<input id="tr-amount" name="amount" className="num" inputMode="decimal" defaultValue={price.monthly || ""} required /></label>
          <label className="f">{t("currency")}<select id="tr-currency" name="currency" defaultValue={price.currency}>{currencies.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label className="f">{t("tr_reference")}<input id="tr-ref" name="reference" required /></label>
          <label className="f">{t("notes")}<input id="tr-note" name="note" /></label>
        </div>
        <div><button type="submit" className="btn">{t("tr_btn")}</button></div>
      </form>
      <div className="panel stack">
        <h2>{t("billing_history")}</h2>
        {history.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("date")}</th><th>{t("reference")}</th><th>{t("billing_period")}</th><th className="num">{t("amount")}</th><th>{t("status")}</th><th>{t("billing_covers")}</th></tr></thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.id}>
                  <td className="num" style={{ textAlign: "left" }}>{p.createdAt.toISOString().slice(0, 10)}</td>
                  <td><code className="k">{p.method === "transfer" ? p.providerTransactionId : p.txRef}</code>{p.status === "failed" && p.note ? <div className="small muted">{p.note}</div> : null}</td>
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
