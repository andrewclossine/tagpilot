import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getI18n } from "@/lib/i18n";
import { companyStatus, requirePlatformOwner, type CompanyStatus } from "@/lib/platform";
import { sp, type SearchParams } from "@/lib/actions";
import { Empty, PageHead, Pill } from "@/components/ui";

const PILL: Record<CompanyStatus, string> = { paid: "paid", trial: "open", expired: "partial", suspended: "void" };

/** Every organisation on TAGPILOT: what it chose, where its subscription stands, and how many people use it. */
export default async function PlatformPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePlatformOwner();
  const { t, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [companies, members, admins, payments] = await Promise.all([
    db.select().from(schema.companies).orderBy(desc(schema.companies.createdAt)),
    db.select({ companyId: schema.memberships.companyId, n: sql<number>`count(*)` }).from(schema.memberships).groupBy(schema.memberships.companyId),
    db.select({ companyId: schema.memberships.companyId, email: schema.users.email, name: schema.users.name }).from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.role, "admin")),
    db.select({ currency: schema.subscriptionPayments.currency, total: sql<string>`sum(${schema.subscriptionPayments.amount})` }).from(schema.subscriptionPayments)
      .where(eq(schema.subscriptionPayments.status, "successful")).groupBy(schema.subscriptionPayments.currency),
  ]);
  const [{ users }] = await db.select({ users: sql<number>`count(*)` }).from(schema.users);
  const rows = companies.map((c) => ({ c, s: companyStatus(c), n: Number(members.find((m) => m.companyId === c.id)?.n ?? 0), admin: admins.find((a) => a.companyId === c.id) }));
  const filter = ["paid", "trial", "expired", "suspended"].includes(q("status")) ? q("status") : "";
  const shown = rows.filter((r) => !filter || r.s.status === filter)
    .filter((r) => !q("q") || `${r.c.name} ${r.admin?.email ?? ""} ${r.c.country}`.toLowerCase().includes(q("q").toLowerCase()));
  const count = (s: CompanyStatus) => rows.filter((r) => r.s.status === s).length;
  const recent = rows.filter((r) => Date.now() - r.c.createdAt.getTime() < 30 * 86400000).length;
  return (
    <div className="stack">
      <PageHead title={t("plt_companies")} />
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("plt_companies")}</div><div className="v">{rows.length}</div><div className="small muted">{t("plt_new_30")}: {recent}</div></div>
        <div className="panel kpi"><div className="label">{t("plt_st_paid")}</div><div className="v">{count("paid")}</div></div>
        <div className="panel kpi"><div className="label">{t("plt_st_trial")}</div><div className="v">{count("trial")}</div></div>
        <div className="panel kpi"><div className="label">{t("plt_st_expired")}</div><div className="v">{count("expired")}</div><div className="small muted">{t("plt_st_suspended")}: {count("suspended")}</div></div>
        <div className="panel kpi"><div className="label">{t("plt_users")}</div><div className="v">{Number(users)}</div></div>
        <div className="panel kpi"><div className="label">{t("plt_received")}</div><div className="v">{payments.length ? payments.map((p) => `${money(Number(p.total))} ${p.currency}`).join(" · ") : "0"}</div></div>
      </div>
      <form method="get" className="panel row">
        <input id="pf-q" name="q" defaultValue={q("q")} placeholder={t("plt_search")} aria-label={t("plt_search")} style={{ flex: 1, minWidth: 200 }} />
        <select id="pf-status" name="status" defaultValue={filter} aria-label={t("status")} style={{ width: "auto" }}>
          <option value="">{t("all")}</option>
          {(["paid", "trial", "expired", "suspended"] as const).map((s) => <option key={s} value={s}>{t(`plt_st_${s}`)}</option>)}
        </select>
        <button type="submit" className="btn">{t("show")}</button>
      </form>
      <div className="panel">
        {shown.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("name")}</th><th>{t("country")}</th><th>{t("plt_admin")}</th><th>{t("plt_apps")}</th><th className="num">{t("plt_users")}</th><th>{t("plt_signed_up")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{shown.map(({ c, s, n, admin }) => (
              <tr key={c.id}>
                <td><Link className="rowlink" href={`/platform/companies/${c.id}`}><b>{c.name}</b></Link></td>
                <td>{c.country}</td>
                <td className="small">{admin ? <>{admin.name}<div className="muted">{admin.email}</div></> : "—"}</td>
                <td className="small">{c.modules.map((m) => t(`module_${m}`)).join(", ")}</td>
                <td className="num">{n}</td>
                <td style={{ whiteSpace: "nowrap" }}>{c.createdAt.toISOString().slice(0, 10)}</td>
                <td><Pill kind={PILL[s.status]}>{t(`plt_st_${s.status}`)}{s.status === "trial" || s.status === "paid" ? ` · ${s.days} ${t("plt_days")}` : ""}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
