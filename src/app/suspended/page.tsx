import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { signOut } from "@/app/session-actions";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Account suspended" };

/** What people in a suspended organisation see instead of the apps. */
export default async function SuspendedPage() {
  const user = await requireUser();
  const { t } = await getI18n();
  const db = await getDb();
  const rows = await db.select({ name: schema.companies.name, reason: schema.companies.suspendedReason, at: schema.companies.suspendedAt })
    .from(schema.memberships).innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId)).where(eq(schema.memberships.userId, user.id));
  const suspended = rows.filter((r) => r.at);
  return (
    <div className="launcher">
      <header className="launcher-top"><Logo size={30} /><span className="spacer" /><form action={signOut}><button type="submit" className="btn sm">{t("sign_out")}</button></form></header>
      <main className="launcher-main stack" style={{ maxWidth: 640 }}>
        <h1>{t("plt_suspended_title")}</h1>
        {suspended.map((r) => <div key={r.name} className="note bad"><b>{r.name}</b>{r.reason ? <div>{r.reason}</div> : null}</div>)}
        <p className="muted">{t("plt_suspended_help")}</p>
      </main>
    </div>
  );
}
