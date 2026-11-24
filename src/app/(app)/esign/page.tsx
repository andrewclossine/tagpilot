import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { localDateTime, timeZoneOf } from "@/lib/format";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "e-Signature" };

const PILL: Record<string, string> = { draft: "draft", sent: "sent", completed: "paid", declined: "void", voided: "void" };
const TABS = ["all", "action", "sent", "completed", "draft", "closed"] as const;

/** The e-Signature dashboard: how many documents wait for others, are done or still drafts, and the list itself. */
export default async function EsignPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("esign");
  const { t } = await getI18n();
  const q = await sp(searchParams);
  const tab = (TABS as readonly string[]).includes(q("tab")) ? q("tab") : "all";
  const db = await getDb();
  const docs = await db.select().from(schema.esignDocuments).where(eq(schema.esignDocuments.companyId, ctx.company.id)).orderBy(desc(schema.esignDocuments.createdAt)).limit(500);
  const signers = docs.length ? await db.select().from(schema.esignSigners).where(inArray(schema.esignSigners.documentId, docs.map((d) => d.id))) : [];
  const of = (id: string) => signers.filter((s) => s.documentId === id);
  const me = ctx.user.email?.toLowerCase() ?? "";
  const needsMe = (id: string) => !!me && of(id).some((s) => s.email === me && s.status !== "signed" && s.status !== "declined");
  const count = { sent: docs.filter((d) => d.status === "sent").length, completed: docs.filter((d) => d.status === "completed").length, draft: docs.filter((d) => d.status === "draft").length, action: docs.filter((d) => d.status === "sent" && needsMe(d.id)).length };
  const shown = docs.filter((d) => tab === "all" || (tab === "closed" ? ["declined", "voided"].includes(d.status) : tab === "action" ? d.status === "sent" && needsMe(d.id) : d.status === tab));
  const tz = timeZoneOf(ctx.company.country);
  return (
    <div className="stack">
      <PageHead title={t("esign_title")}>
        {ctx.can("esign", "write") ? <Link className="btn primary" href="/esign/new">{t("es_new")}</Link> : null}
      </PageHead>
      {q("deleted") ? <div className="note ok small">{t("deleted")}</div> : null}
      <div className="kpis">
        {([["action", "es_k_action"], ["sent", "es_k_waiting"], ["completed", "es_k_completed"], ["draft", "es_k_drafts"]] as const).map(([k, label]) => (
          <Link key={k} href={`/esign?tab=${k}`} className="panel kpi" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="label">{t(label)}</div><div className="v">{count[k]}</div>
          </Link>
        ))}
      </div>
      <div className="tabs">
        {TABS.map((k) => <Link key={k} href={`/esign?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{t(`es_tab_${k}` as Key)}</Link>)}
      </div>
      <div className="panel">
        {shown.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("es_document")}</th><th>{t("es_signers")}</th><th>{t("status")}</th><th>{t("es_updated")}</th></tr></thead>
            <tbody>{shown.map((d) => {
              const ss = of(d.id);
              return (
                <tr key={d.id} className="rowclick">
                  <td><Link className="rowfill" href={`/esign/${d.id}`}><code className="k">{d.number}</code></Link></td>
                  <td><Link className="rowfill" href={`/esign/${d.id}`} tabIndex={-1}><b>{d.title}</b></Link></td>
                  <td><Link className="rowfill" href={`/esign/${d.id}`} tabIndex={-1}>{ss.length ? `${ss.filter((s) => s.status === "signed").length}/${ss.length} · ${ss.map((s) => s.name).join(", ")}` : "—"}</Link></td>
                  <td><Pill kind={PILL[d.status]}>{t(`es_st_${d.status}` as Key)}</Pill>{needsMe(d.id) && d.status === "sent" ? <span className="small" style={{ marginLeft: 6, color: "var(--accent)" }}>{t("es_your_turn")}</span> : null}</td>
                  <td className="small muted">{localDateTime(d.completedAt ?? d.sentAt ?? d.createdAt, tz)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Empty>{t("es_empty")}</Empty>}
      </div>
    </div>
  );
}
