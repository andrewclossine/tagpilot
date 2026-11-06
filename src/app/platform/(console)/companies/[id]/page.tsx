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
import { extendTrial, reactivateCompany, recordPayment, suspendCompany } from "../../../actions";

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
  const [people, payments] = await Promise.all([
    db.select({ u: schema.users, role: schema.memberships.role }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.companyId, id)).orderBy(schema.users.name),
    db.select().from(schema.subscriptionPayments).where(eq(schema.subscriptionPayments.companyId, id)).orderBy(desc(schema.subscriptionPayments.createdAt)),
  ]);
  const s = companyStatus(c);
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
      {c.suspendedAt ? <div className="note bad small">{t("plt_suspended_since")} {c.suspendedAt.toISOString().slice(0, 10)}: {c.suspendedReason}</div> : null}
      <div className="panel">
        <div className="fields">{fields.filter(([, v]) => v).map(([k, v]) => <div key={k}><div className="label">{k}</div>{v}</div>)}</div>
      </div>
      <div className="panel stack">
        <h2>{t("plt_users")} · {people.length}</h2>
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("name")}</th><th>{t("username")}</th><th>{t("email")}</th><th>{t("role")}</th><th>{t("plt_signed_up")}</th></tr></thead>
          <tbody>{people.map(({ u, role }) => <tr key={u.id}><td>{u.name}</td><td>{u.username}</td><td>{u.email}</td><td>{t(`role_${role}`)}</td><td>{u.createdAt.toISOString().slice(0, 10)}</td></tr>)}</tbody>
        </table></div>
      </div>
      <div className="panel stack">
        <h2>{t("plt_payments")}</h2>
        {payments.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("date")}</th><th className="num">{t("amount")}</th><th>{t("plt_covers")}</th><th>{t("reference")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{payments.map((p) => (
              <tr key={p.id}><td>{p.createdAt.toISOString().slice(0, 10)}</td><td className="num">{money(p.amount, 2)} {p.currency}</td>
                <td className="small">{p.periodEnd ? `→ ${p.periodEnd.toISOString().slice(0, 10)}` : ""} {p.modules.map((m) => t(`module_${m}`)).join(", ")}</td>
                <td className="small">{p.txRef.startsWith("manual-") ? `${t("plt_manual")} ${p.providerTransactionId ?? ""}` : p.providerTransactionId ?? p.txRef}</td>
                <td><Pill kind={p.status === "successful" ? "paid" : p.status === "failed" ? "void" : "open"}>{p.status}</Pill></td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
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
