import { getDb } from "@/db";
import { getI18n } from "@/lib/i18n";
import { itemsOf, pricesOf } from "@/lib/boq";

/**
 * The price part of a bid form. With a bill of quantities the bidder gives a unit price for every line and the total
 * is worked out on the server; without one, a single amount. Shows the bidder's own earlier prices only.
 */
export async function BidPriceFields({ tenderId, bid, currency }: { tenderId: string; bid?: { id: string; amount: number }; currency: string }) {
  const { t, money } = await getI18n();
  const db = await getDb();
  const items = await itemsOf(db, tenderId);
  if (!items.length) {
    return <label className="f">{t("portal_amount")} ({currency})<input id="b-amount" name="amount" className="num" inputMode="decimal" required defaultValue={bid?.amount || ""} /></label>;
  }
  const mine = bid ? await pricesOf(db, [bid.id]) : new Map<string, number>();
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="label">{t("boq_price_each")} ({currency})</div>
      <div className="tbl-wrap"><table>
        <thead><tr><th>#</th><th>{t("description")}</th><th>{t("rq_unit")}</th><th className="num">{t("rq_quantity")}</th><th className="num">{t("boq_unit_price")}</th></tr></thead>
        <tbody>{items.map((it) => (
          <tr key={it.id}>
            <td className="muted">{it.sortOrder}</td><td>{it.description}</td><td>{it.unit}</td><td className="num">{it.quantity}</td>
            <td><input name={`price_${it.id}`} className="num" style={{ width: 130 }} inputMode="decimal" required defaultValue={mine.get(`${bid?.id}:${it.id}`) ?? ""} aria-label={`${t("boq_unit_price")} ${it.description}`} /></td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="small muted">{t("boq_total_help")}{bid ? ` ${t("boq_your_total")}: ${money(bid.amount, 2)} ${currency}` : ""}</div>
    </div>
  );
}
