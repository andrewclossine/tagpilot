import Link from "next/link";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSupplier } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { biddingOpen, supplierCanSee } from "@/lib/procurement";
import { LocalTime } from "@/components/datetime";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Supplier portal" };

export default async function PortalPage() {
  const ctx = await requireSupplier();
  const { t, money } = await getI18n();
  const db = await getDb();
  const [tenders, mine] = await Promise.all([
    db.select().from(schema.tenders).where(and(eq(schema.tenders.companyId, ctx.company.id), ne(schema.tenders.status, "draft"))).orderBy(desc(schema.tenders.createdAt)).limit(300),
    db.select().from(schema.bids).where(and(eq(schema.bids.companyId, ctx.company.id), eq(schema.bids.partnerId, ctx.partnerId))),
  ]);
  const visible = [];
  for (const x of tenders) {
    const bid = mine.find((b) => b.tenderId === x.id);
    if (bid || await supplierCanSee(db, x, ctx.partnerId)) visible.push({ x, bid });
  }
  // Tenders still open first; the ones this supplier never bid on disappear once closed.
  const rows = visible.filter(({ x, bid }) => bid || biddingOpen(x));
  return (
    <div className="stack">
      <PageHead title={t("portal_tenders")} />
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("portal_sub")}</p>
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("type")}</th><th>{t("tn_subject")}</th><th>{t("tn_deadline")}</th><th className="num">{t("portal_my_bid")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{rows.map(({ x, bid }) => (
              <tr key={x.id}>
                <td><Link className="rowlink" href={`/portal/tenders/${x.id}`}><code className="k">{x.number}</code></Link></td>
                <td>{t(x.kind === "rfq" ? "tn_rfq" : "tn_tender")}</td>
                <td><Link className="rowlink" href={`/portal/tenders/${x.id}`}>{x.title}</Link></td>
                <td><LocalTime value={x.deadline?.toISOString() ?? null} /></td>
                <td className="num">{bid ? money(bid.amount, 2) : ""}</td>
                <td><Pill kind={biddingOpen(x) ? "published" : "opened"}>{t(biddingOpen(x) ? "portal_open" : "portal_closed")}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("portal_none")}</Empty>}
      </div>
    </div>
  );
}
