import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { ScanForm } from "./ScanForm";
import { scanDocument } from "./actions";

export const metadata = { title: "Scan & book" };

export default async function ScanPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getCtx();
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const drafts = await db.select().from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.companyId, ctx.company.id), eq(schema.journalEntries.status, "draft")))
    .orderBy(desc(schema.journalEntries.createdAt)).limit(30);
  return (
    <div className="stack">
      <PageHead title={t("ai_title")} />
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("ai_sub")}</p>
      <ErrorNote message={err(q("error"))} />
      <div className="grid2">
        <div className="panel">
          {ctx.canWrite
            ? <ScanForm action={scanDocument} labels={{ drop: t("ai_drop"), choose: t("ai_choose"), read: t("ai_read"), reading: t("ai_reading") }} />
            : <Empty>{t("role_viewer")}</Empty>}
        </div>
        <div className="panel stack">
          <h2>{t("drafts_waiting")}</h2>
          {drafts.length ? (
            <table><tbody>
              {drafts.map((e) => (
                <tr key={e.id} className="click">
                  <td className="num" style={{ textAlign: "left" }}>{e.date}</td>
                  <td><Link className="rowlink" href={`/journal/${e.id}`}>{e.memo || "—"}</Link></td>
                  <td className="small muted">{t(`src_${e.source}`)}{e.ai ? ` · ${Math.round(e.ai.confidence * 100)}%` : ""}</td>
                </tr>
              ))}
            </tbody></table>
          ) : <Empty>{t("nothing_yet")}</Empty>}
        </div>
      </div>
    </div>
  );
}
