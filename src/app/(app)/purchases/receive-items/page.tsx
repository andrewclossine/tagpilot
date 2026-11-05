import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Receive items" };

export default async function ReceiveItemsPage() {
  const ctx = await requireView("purchases");
  const { t, money } = await getI18n();
  const db = await getDb();
  const rows = await db.select({ r: schema.goodsReceipts, supplier: schema.partners.name }).from(schema.goodsReceipts)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.goodsReceipts.partnerId))
    .where(eq(schema.goodsReceipts.companyId, ctx.company.id)).orderBy(desc(schema.goodsReceipts.date), desc(schema.goodsReceipts.number)).limit(300);
  return (
    <div className="stack">
      <PageHead title={t("nav_receive_items")}>
        {ctx.can("purchases", "write") ? <Link className="btn primary" href="/purchases/receive-items/new">{t("gr_new")}</Link> : null}
      </PageHead>
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("gr_help")}</p>
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t("supplier")}</th><th>{t("gr_delivery_note")}</th><th className="num">{t("amount")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{rows.map(({ r, supplier }) => (
              <tr key={r.id}>
                <td><Link className="rowlink" href={`/purchases/receive-items/${r.id}`}><code className="k">{r.number}</code></Link></td>
                <td>{r.date}</td><td>{supplier}</td><td>{r.deliveryNote}</td><td className="num">{money(r.value, 2)}</td>
                <td><Pill kind={r.status === "received" ? "open" : r.status === "billed" ? "paid" : "void"}>{t(`gr_${r.status}`)}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
