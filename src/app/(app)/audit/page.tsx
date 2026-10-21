import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { Empty, PageHead } from "@/components/ui";

export const metadata = { title: "Audit trail" };

/** Who did what, and when: every save, posting, payment, reversal and access change. */
export default async function AuditPage() {
  const ctx = await getCtx();
  const { t } = await getI18n();
  const db = await getDb();
  const rows = await db.select({ a: schema.auditLog, who: schema.users.name }).from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
    .where(eq(schema.auditLog.companyId, ctx.company.id)).orderBy(desc(schema.auditLog.at)).limit(300);
  return (
    <div className="stack">
      <PageHead title={t("audit_title")} />
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("audit_when")}</th><th>{t("audit_who")}</th><th>{t("audit_what")}</th><th>{t("description")}</th></tr></thead>
            <tbody>
              {rows.map(({ a, who }) => (
                <tr key={a.id}>
                  <td className="num" style={{ textAlign: "left" }}>{a.at.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td>{who ?? "—"}</td>
                  <td><code className="k">{a.action}</code> · {a.entity}</td>
                  <td className="small muted">{a.details ? Object.entries(a.details).map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : ""}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
