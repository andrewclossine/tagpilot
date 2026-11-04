import Link from "next/link";
import { getDb } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { myBids } from "@/lib/bidding";
import { biddingOpen } from "@/lib/procurement";
import { LocalTime } from "@/components/datetime";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "My bids" };

export default async function MyBidsPage() {
  const ctx = await requireView("bidding");
  const { t, money } = await getI18n();
  const rows = await myBids(await getDb(), ctx.company.id);
  return (
    <div className="stack">
      <PageHead title={t("nav_my_bids")} />
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("tn_subject")}</th><th>{t("adv_buyer")}</th><th>{t("tn_deadline")}</th><th className="num">{t("portal_my_bid")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{rows.map(({ b, t: x, buyer }) => (
              <tr key={b.id}>
                <td><Link className="rowlink" href={`/adverts/${x.id}`}><code className="k">{x.number}</code></Link></td>
                <td><Link className="rowlink" href={`/adverts/${x.id}`}>{x.title}</Link></td>
                <td>{buyer}</td>
                <td><LocalTime value={x.deadline?.toISOString() ?? null} /></td>
                <td className="num">{money(b.amount, 2)}</td>
                <td>{x.status === "cancelled"
                  ? <Pill kind="cancelled">{t("ts_cancelled")}</Pill>
                  : <Pill kind={biddingOpen(x) ? "published" : "opened"}>{t(biddingOpen(x) ? "portal_open" : "portal_closed")}</Pill>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
