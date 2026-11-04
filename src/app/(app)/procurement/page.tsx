import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { LocalTime } from "@/components/datetime";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Procurement" };

export default async function ProcurementPage() {
  const ctx = await requireView("procurement");
  const { t } = await getI18n();
  const db = await getDb();
  const rows = await db.select({ t: schema.tenders, bids: sql<number>`(select count(*) from bids b where b.tender_id = ${schema.tenders.id})` })
    .from(schema.tenders).where(eq(schema.tenders.companyId, ctx.company.id)).orderBy(desc(schema.tenders.createdAt)).limit(300);
  return (
    <div className="stack">
      <PageHead title={t("tn_title")}>
        {ctx.can("procurement", "write") ? <>
          <Link className="btn primary" href="/procurement/new?kind=rfq">{t("tn_new_rfq")}</Link>
          <Link className="btn" href="/procurement/new?kind=tender">{t("tn_new_tender")}</Link>
        </> : null}
      </PageHead>
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("type")}</th><th>{t("tn_subject")}</th><th>{t("tn_deadline")}</th><th className="num">{t("tn_bids")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{rows.map(({ t: x, bids }) => (
              <tr key={x.id}>
                <td><Link className="rowlink" href={`/procurement/${x.id}`}><code className="k">{x.number}</code></Link></td>
                <td>{t(x.kind === "rfq" ? "tn_rfq" : "tn_tender")}</td>
                <td><Link className="rowlink" href={`/procurement/${x.id}`}>{x.title}</Link></td>
                <td><LocalTime value={x.deadline?.toISOString() ?? null} /></td>
                <td className="num">{Number(bids)}</td>
                <td><Pill kind={x.status}>{t(`ts_${x.status}`)}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
