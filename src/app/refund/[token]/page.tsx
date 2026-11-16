import { notFound } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { money } from "@/lib/format";
import { refundByToken } from "@/lib/subscriptions";
import { ErrorNote } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { savePayoutAction } from "./actions";

export const metadata = { title: "Refund", robots: { index: false, follow: false } };

/**
 * Opened from the refund email: the subscriber says which bank account or mobile money number gets the money.
 * It works without signing in, since a cancelled or suspended organisation may no longer reach its own pages.
 */
export default async function RefundPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SearchParams }) {
  const { token } = await params;
  const row = await refundByToken(token);
  if (!row) notFound();
  const { t, err, lang } = await getI18n();
  const q = await sp(searchParams);
  const r = row.r;
  const amount = `${money(r.amount, lang, 2)} ${r.currency}`;
  const open = r.status === "awaiting_details" || r.status === "details_received";
  return (
    <div className="auth">
      <div className="panel stack" style={{ maxWidth: 620 }}>
        <Logo size={34} />
        <h1>{t("rf_title")}</h1>
        <p className="muted" style={{ margin: 0 }}>{t("rf_intro").replace("{org}", row.company).replace("{amount}", amount)}</p>
        {r.reason ? <div className="small"><b>{t("plt_reason")}:</b> {r.reason}</div> : null}
        <ErrorNote message={err(q("error"))} />
        {q("saved") ? <div className="note ok">{t("rf_saved")}</div> : null}
        {r.status === "paid" ? <div className="note ok">{t("rf_paid").replace("{amount}", amount).replace("{ref}", r.paidReference)}</div> : null}
        {r.status === "cancelled" ? <div className="note warn">{t("rf_cancelled")}</div> : null}
        {open ? (
          <form action={savePayoutAction} className="stack">
            <input type="hidden" name="token" value={token} />
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">{t("rf_pay_to")}</legend>
              <label className="row small" style={{ gap: 8 }}><input type="radio" name="payTo" value="bank" defaultChecked={r.payTo !== "momo"} style={{ width: "auto" }} /> {t("rf_bank")}</label>
              <label className="row small" style={{ gap: 8 }}><input type="radio" name="payTo" value="momo" defaultChecked={r.payTo === "momo"} style={{ width: "auto" }} /> {t("rf_momo")}</label>
            </fieldset>
            <label className="f">{t("rf_account_name")}<input id="rf-name" name="accountName" defaultValue={r.accountName} required autoComplete="name" /></label>
            <h2>{t("rf_bank")}</h2>
            <div className="fields">
              <label className="f">{t("rf_bank_name")}<input id="rf-bank" name="bankName" defaultValue={r.bankName} /></label>
              <label className="f">{t("rf_account_number")}<input id="rf-number" name="accountNumber" defaultValue={r.accountNumber} inputMode="text" autoComplete="off" /></label>
              <label className="f">{t("rf_bank_code")}<input id="rf-code" name="bankCode" defaultValue={r.bankCode} autoComplete="off" /></label>
            </div>
            <h2>{t("rf_momo")}</h2>
            <label className="f">{t("rf_phone")}<input id="rf-phone" name="phone" defaultValue={r.phone} inputMode="tel" autoComplete="tel" /></label>
            <div className="small muted">{t("rf_privacy")}</div>
            <div><button type="submit" className="btn primary">{t(r.status === "details_received" ? "rf_update" : "rf_send")}</button></div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
