import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getI18n } from "@/lib/i18n";
import { addDays, isUuid, today } from "@/lib/format";
import { companyStatus, requirePlatformOwner } from "@/lib/platform";
import { sp, type SearchParams } from "@/lib/actions";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead, Pill } from "@/components/ui";
import { cookies } from "next/headers";
import { resetUserPassword } from "../../../actions";
import { cancelSubscriptionAction, checkCardPayment, confirmTransfer, extendTrial, reactivateCompany, recordPayment, refundCancel, refundPaid, refundResend, rejectTransfer, suspendCompany } from "../../../actions";

const PAY_PILL = { successful: "paid", failed: "void", pending: "open", refunded: "cancelled" } as const;
const REFUND_PILL = { awaiting_details: "open", details_received: "requested", paid: "paid", cancelled: "void" } as const;

/** One organisation, as the platform owner sees it: who it is, who uses it, what it paid. Not its books. */
export default async function PlatformCompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await requirePlatformOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
  if (!c) notFound();
  const [people, payments, refunds] = await Promise.all([
    db.select({ u: schema.users, role: schema.memberships.role }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.companyId, id)).orderBy(schema.users.name),
    db.select().from(schema.subscriptionPayments).where(eq(schema.subscriptionPayments.companyId, id)).orderBy(desc(schema.subscriptionPayments.createdAt)),
    db.select().from(schema.subscriptionRefunds).where(eq(schema.subscriptionRefunds.companyId, id)).orderBy(desc(schema.subscriptionRefunds.createdAt)),
  ]);
  const paid = payments.filter((p) => p.status === "successful");
  const active = !!c.paidUntil && c.paidUntil.getTime() > Date.now();
  const s = companyStatus(c);
  // Shown once, for a few minutes, when the email with a one-time password could not be sent.
  let flash: { userId: string; code: string; until: string } | null = null;
  try { flash = JSON.parse((await cookies()).get("tp_pw_flash")?.value ?? "null"); } catch { flash = null; }
  const fields: [string, string][] = [
    [t("country"), [c.city, c.country].filter(Boolean).join(", ")], [t("email"), c.email], [t("phone"), c.phone], [t("tin"), c.tin],
    [t("co_reg"), c.registrationNo], [t("org_type"), c.orgType], [t("currency"), c.currency], [t("plt_signed_up"), c.createdAt.toISOString().slice(0, 10)],
    [t("plt_apps"), c.modules.map((m) => t(`module_${m}`)).join(", ")], [t("plt_trial_ends"), c.trialEndsAt.toISOString().slice(0, 10)],
    [t("billing_active_until"), c.paidUntil ? c.paidUntil.toISOString().slice(0, 10) : "—"],
  ];
  return (
    <div className="stack">
      <PageHead title={c.name}>
        <Pill kind={s.status === "paid" ? "paid" : s.status === "trial" ? "open" : s.status === "expired" ? "partial" : "void"}>{t(`plt_st_${s.status}`)}</Pill>
        <Link className="btn ghost" href="/platform">{t("back")}</Link>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {q("pwsent") ? <div className="note ok small">{t("pw_sent")}</div> : null}
      {q("pwnomail") ? <div className="note warn small">{t("pw_not_sent")}</div> : null}
      {q("nomail") ? <div className="note warn small">{t("plt_mail_not_sent")}</div> : null}
      {c.suspendedAt ? <div className="note bad small">{t("plt_suspended_since")} {c.suspendedAt.toISOString().slice(0, 10)}: {c.suspendedReason}</div> : null}
      <div className="panel">
        <div className="fields">{fields.filter(([, v]) => v).map(([k, v]) => <div key={k}><div className="label">{k}</div>{v}</div>)}</div>
      </div>
      <div className="panel stack">
        <h2>{t("plt_users")} · {people.length}</h2>
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("name")}</th><th>{t("username")}</th><th>{t("email")}</th><th>{t("role")}</th><th>{t("plt_signed_up")}</th><th /></tr></thead>
          <tbody>{people.map(({ u, role }) => (
            <tr key={u.id}><td>{u.name}</td><td>{u.username}</td><td>{u.email}</td><td>{t(`role_${role}`)}</td><td>{u.createdAt.toISOString().slice(0, 10)}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {u.mustChangePassword && u.tempPasswordExpiresAt ? <div className="small muted">{t(u.tempPasswordExpiresAt.getTime() > Date.now() ? "pw_pending_until" : "pw_expired").replace("{time}", u.tempPasswordExpiresAt.toISOString().slice(0, 16).replace("T", " "))}</div> : null}
                {flash?.userId === u.id ? <div className="note warn small">{t("pw_code_not_sent")} <code className="k" style={{ fontSize: 16 }}>{flash.code}</code></div> : null}
                <form action={resetUserPassword}><input type="hidden" name="userId" value={u.id} /><input type="hidden" name="id" value={c.id} />
                  <ConfirmButton className="btn sm" confirmLabel={t("confirm")}>{t("pw_reset_btn")}</ConfirmButton></form>
              </td></tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="panel stack">
        <h2>{t("plt_payments")}</h2>
        {payments.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("date")}</th><th className="num">{t("amount")}</th><th>{t("plt_method")}</th><th>{t("plt_covers")}</th><th>{t("reference")}</th><th>{t("status")}</th><th /></tr></thead>
            <tbody>{payments.map((p) => (
              <tr key={p.id}><td>{p.createdAt.toISOString().slice(0, 10)}</td><td className="num">{money(p.amount, 2)} {p.currency}</td>
                <td className="small">{t(`plt_method_${p.method}`)} · {t(p.period === "yearly" ? "billing_yearly" : "billing_monthly")}</td>
                <td className="small">{p.periodEnd ? `→ ${p.periodEnd.toISOString().slice(0, 10)}` : ""} {p.modules.map((m) => t(`module_${m}`)).join(", ")}</td>
                <td className="small">{p.method === "card" ? p.providerTransactionId ?? p.txRef : p.providerTransactionId ?? ""}{p.note ? <div className="muted">{p.note}</div> : null}</td>
                <td><Pill kind={PAY_PILL[p.status]}>{t(`pay_${p.status}`)}</Pill></td>
                <td style={{ minWidth: 220 }}>
                  {p.status === "pending" && p.method === "transfer" ? (
                    <div className="stack" style={{ gap: 6 }}>
                      <form action={confirmTransfer}><input type="hidden" name="paymentId" value={p.id} /><ConfirmButton className="btn sm primary" confirmLabel={t("confirm")}>{t("plt_confirm_payment")}</ConfirmButton></form>
                      <form action={rejectTransfer} className="row" style={{ gap: 6 }}><input type="hidden" name="paymentId" value={p.id} />
                        <input name="reason" placeholder={t("plt_reason")} aria-label={t("plt_reason")} required style={{ minWidth: 0 }} />
                        <button type="submit" className="btn sm ghost danger">{t("plt_reject")}</button></form>
                    </div>
                  ) : null}
                  {p.status === "pending" && p.method === "card" ? (
                    <form action={checkCardPayment}><input type="hidden" name="paymentId" value={p.id} /><button type="submit" className="btn sm">{t("plt_check_card")}</button></form>
                  ) : null}
                </td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
      {refunds.length ? (
        <div className="panel stack">
          <h2>{t("plt_refunds")}</h2>
          {refunds.map((r) => (
            <div key={r.id} className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <b>{money(r.amount, 2)} {r.currency}</b>
                <span className="small muted">{r.createdAt.toISOString().slice(0, 10)} · {r.reason}</span>
                <Pill kind={REFUND_PILL[r.status]}>{t(`rf_st_${r.status}`)}</Pill>
              </div>
              {r.detailsAt ? (
                <div className="fields small">
                  <div><div className="label">{t("rf_pay_to")}</div>{t(r.payTo === "momo" ? "rf_momo" : "rf_bank")}</div>
                  <div><div className="label">{t("rf_account_name")}</div>{r.accountName}</div>
                  {r.payTo === "momo" ? <div><div className="label">{t("rf_phone")}</div><code className="k">{r.phone}</code></div> : <>
                    <div><div className="label">{t("rf_bank_name")}</div>{r.bankName}</div>
                    <div><div className="label">{t("rf_account_number")}</div><code className="k">{r.accountNumber}</code></div>
                    {r.bankCode ? <div><div className="label">{t("rf_bank_code")}</div>{r.bankCode}</div> : null}
                  </>}
                </div>
              ) : <div className="small muted">{r.emailedAt ? t("plt_refund_emailed").replace("{date}", r.emailedAt.toISOString().slice(0, 10)) : t("plt_refund_not_emailed")}</div>}
              {r.status === "paid" ? <div className="small">{t("plt_refund_paid_on")} {r.paidAt?.toISOString().slice(0, 10)} · {r.paidReference}</div> : null}
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {r.status === "details_received" ? (
                  <form action={refundPaid} className="row" style={{ gap: 6 }}><input type="hidden" name="refundId" value={r.id} />
                    <input name="reference" placeholder={t("plt_refund_reference")} aria-label={t("plt_refund_reference")} required />
                    <ConfirmButton className="btn sm primary" confirmLabel={t("confirm")}>{t("plt_refund_mark_paid")}</ConfirmButton></form>
                ) : null}
                {r.status === "awaiting_details" || r.status === "details_received" ? <>
                  <form action={refundResend}><input type="hidden" name="refundId" value={r.id} /><button type="submit" className="btn sm">{t("plt_refund_resend")}</button></form>
                  <form action={refundCancel}><input type="hidden" name="refundId" value={r.id} /><ConfirmButton className="btn sm ghost danger" confirmLabel={t("confirm")}>{t("plt_refund_cancel")}</ConfirmButton></form>
                </> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid2">
        <form action={extendTrial} className="panel stack">
          <h2>{t("plt_extend_trial")}</h2>
          <input type="hidden" name="id" value={c.id} />
          <label className="f">{t("plt_extra_days")}<input id="pf-days" name="days" className="num" inputMode="numeric" defaultValue="14" required /></label>
          <div><button type="submit" className="btn">{t("plt_extend_trial")}</button></div>
        </form>
        <form action={recordPayment} className="panel stack">
          <h2>{t("plt_record_payment")}</h2>
          <div className="small muted">{t("plt_record_payment_help")}</div>
          <input type="hidden" name="id" value={c.id} />
          <div className="fields">
            <label className="f">{t("amount")}<input id="pf-amount" name="amount" className="num" inputMode="decimal" required /></label>
            <label className="f">{t("currency")}<input id="pf-currency" name="currency" defaultValue="USD" maxLength={3} required /></label>
            <label className="f">{t("plt_paid_until")}<input id="pf-until" name="until" type="date" required defaultValue={addDays(today(), 30)} /></label>
            <label className="f">{t("reference")}<input id="pf-ref" name="reference" /></label>
          </div>
          <div><button type="submit" className="btn">{t("plt_record_payment")}</button></div>
        </form>
      </div>
      <form action={cancelSubscriptionAction} className="panel stack">
        <h2>{t("plt_cancel_sub")}</h2>
        <div className="small muted">{t("plt_cancel_sub_help")}</div>
        {!active ? <div className="small muted">{t("plt_no_active_sub")}</div> : null}
        <input type="hidden" name="id" value={c.id} />
        <div className="fields">
          <label className="f">{t("plt_reason")}<input id="pc-reason" name="reason" required /></label>
          <label className="f">{t("plt_refund_payment")}
            <select id="pc-payment" name="paymentId" defaultValue={paid[0]?.id ?? ""}>
              <option value="">{t("plt_refund_none")}</option>
              {paid.map((p) => <option key={p.id} value={p.id}>{p.createdAt.toISOString().slice(0, 10)} · {money(p.amount, 2)} {p.currency}</option>)}
            </select></label>
          <label className="f">{t("plt_refund_amount")}<input id="pc-refund" name="refund" className="num" inputMode="decimal" placeholder="0" /></label>
        </div>
        <label className="row small" style={{ gap: 8 }}><input id="pc-suspend" type="checkbox" name="suspend" value="1" style={{ width: "auto" }} /> {t("plt_cancel_and_suspend")}</label>
        <div><ConfirmButton className="btn danger" confirmLabel={t("confirm")}>{t("plt_cancel_sub")}</ConfirmButton></div>
      </form>
      {c.suspendedAt ? (
        <form action={reactivateCompany} className="panel row">
          <input type="hidden" name="id" value={c.id} />
          <span style={{ flex: 1 }}>{t("plt_reactivate_help")}</span>
          <button type="submit" className="btn primary">{t("plt_reactivate")}</button>
        </form>
      ) : (
        <form action={suspendCompany} className="panel stack">
          <h2>{t("plt_suspend")}</h2>
          <div className="small muted">{t("plt_suspend_help")}</div>
          <input type="hidden" name="id" value={c.id} />
          <label className="f">{t("plt_reason")}<input id="pf-reason" name="reason" required /></label>
          <div><ConfirmButton className="btn danger" confirmLabel={t("confirm")}>{t("plt_suspend")}</ConfirmButton></div>
        </form>
      )}
    </div>
  );
}
