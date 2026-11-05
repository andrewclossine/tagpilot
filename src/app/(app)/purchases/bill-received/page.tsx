import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { makeBill } from "../receive-items/actions";

export const metadata = { title: "Enter bill for received items" };

/** The deliveries still waiting for their bill. */
export default async function BillReceivedPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("purchases");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const rows = await db.select({ r: schema.goodsReceipts, supplier: schema.partners.name }).from(schema.goodsReceipts)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.goodsReceipts.partnerId))
    .where(and(eq(schema.goodsReceipts.companyId, ctx.company.id), eq(schema.goodsReceipts.status, "received"))).orderBy(asc(schema.goodsReceipts.date), asc(schema.goodsReceipts.number));
  const canBill = ctx.can("purchases", "write");
  return (
    <div className="stack">
      <PageHead title={t("nav_bill_received")} />
      <ErrorNote message={err(q("error"))} />
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("gr_bill_help")}</p>
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t("supplier")}</th><th>{t("gr_delivery_note")}</th><th className="num">{t("amount")}</th><th /></tr></thead>
            <tbody>{rows.map(({ r, supplier }) => (
              <tr key={r.id}>
                <td><Link className="rowlink" href={`/purchases/receive-items/${r.id}`}><code className="k">{r.number}</code></Link></td>
                <td>{r.date}</td><td>{supplier}</td><td>{r.deliveryNote}</td><td className="num">{money(r.value, 2)}</td>
                <td>{r.billId ? <Link className="btn sm" href={`/purchases/bills/${r.billId}`}>{t("bill_bill")} →</Link> : canBill ? <form action={makeBill}><input type="hidden" name="id" value={r.id} /><button type="submit" className="btn sm primary">{t("gr_make_bill")}</button></form> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("r_no_receipts_to_bill")}</Empty>}
      </div>
    </div>
  );
}
