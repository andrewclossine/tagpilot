import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { signOut } from "@/app/session-actions";
import { Logo } from "@/components/Logo";
import Link from "next/link";
import { openRefunds } from "@/lib/subscriptions";

export const metadata = { title: "Account suspended" };

/** What people in a suspended organisation see instead of the apps. */
export default async function SuspendedPage() {
  const user = await requireUser();
  const { t } = await getI18n();
  const db = await getDb();
  const rows = await db.select({ id: schema.companies.id, name: schema.companies.name, reason: schema.companies.suspendedReason, at: schema.companies.suspendedAt, role: schema.memberships.role })
    .from(schema.memberships).innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId)).where(eq(schema.memberships.userId, user.id));
  const suspended = rows.filter((r) => r.at);
  // Administrators of a suspended organisation can still say where its refund goes.
  const refunds = await openRefunds(suspended.filter((r) => r.role === "admin").map((r) => r.id));
  return (
    <div className="launcher">
      <header className="launcher-top"><Logo size={30} /><span className="spacer" /><form action={signOut}><button type="submit" className="btn sm">{t("sign_out")}</button></form></header>
      <main className="launcher-main stack" style={{ maxWidth: 640 }}>
        <h1>{t("plt_suspended_title")}</h1>
        {suspended.map((r) => <div key={r.name} className="note bad"><b>{r.name}</b>{r.reason ? <div>{r.reason}</div> : null}</div>)}
        {refunds.map((r) => (
          <div key={r.id} className="note warn row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <span>{t(r.status === "awaiting_details" ? "rf_banner_waiting" : "rf_banner_received").replace("{amount}", `${r.amount} ${r.currency}`)}</span>
            <Link className="btn sm" href={`/refund/${r.token}`}>{t(r.status === "awaiting_details" ? "rf_give_details" : "rf_change_details")}</Link>
          </div>
        ))}
        <p className="muted">{t("plt_suspended_help")}</p>
      </main>
    </div>
  );
}
