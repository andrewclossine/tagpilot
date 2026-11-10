import { getI18n } from "@/lib/i18n";
import type { TenderItem } from "@/lib/boq";

/**
 * The price comparison sheet: every line of the bill of quantities against every bidder, the lowest price of each
 * line marked, and each bidder's total. Only shown once the bids are opened.
 */
export async function PriceComparison({ items, bids, prices, currency }: {
  items: TenderItem[]; bids: { id: string; partner: string; amount: number }[]; prices: Map<string, number>; currency: string;
}) {
  const { t, money } = await getI18n();
  if (!items.length || !bids.length) return null;
  const lowest = new Map(items.map((it) => {
    const all = bids.map((b) => prices.get(`${b.id}:${it.id}`)).filter((p): p is number => p !== undefined && p > 0);
    return [it.id, all.length ? Math.min(...all) : null];
  }));
  const best = Math.min(...bids.map((b) => b.amount).filter((a) => a > 0));
  return (
    <div className="panel stack" id="comparison">
      <h2>{t("boq_comparison")}</h2>
      <div className="small muted">{t("boq_comparison_help")} ({currency})</div>
      <div className="tbl-wrap"><table className="compare">
        <thead>
          <tr><th rowSpan={2}>#</th><th rowSpan={2}>{t("description")}</th><th rowSpan={2}>{t("rq_unit")}</th><th rowSpan={2} className="num">{t("rq_quantity")}</th>
            {bids.map((b) => <th key={b.id} colSpan={2} className="num" style={{ textAlign: "center" }}>{b.partner}</th>)}</tr>
          <tr>{bids.map((b) => [<th key={`${b.id}u`} className="num">{t("boq_unit_price")}</th>, <th key={`${b.id}t`} className="num">{t("amount")}</th>])}</tr>
        </thead>
        <tbody>{items.map((it) => (
          <tr key={it.id}>
            <td className="muted">{it.sortOrder}</td><td>{it.description}</td><td>{it.unit}</td><td className="num">{it.quantity}</td>
            {bids.map((b) => {
              const p = prices.get(`${b.id}:${it.id}`);
              const low = p !== undefined && p > 0 && p === lowest.get(it.id);
              return [
                <td key={`${b.id}u`} className="num" style={low ? { background: "var(--ok-soft)", fontWeight: 600 } : undefined}>{p === undefined ? "-" : money(p, 2)}</td>,
                <td key={`${b.id}t`} className="num">{p === undefined ? "-" : money(p * it.quantity, 2)}</td>,
              ];
            })}
          </tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={4} className="num"><b>{t("total")}</b></td>
          {bids.map((b) => <td key={b.id} colSpan={2} className="num" style={b.amount === best ? { background: "var(--ok-soft)" } : undefined}><b>{money(b.amount, 2)}</b></td>)}</tr></tfoot>
      </table></div>
    </div>
  );
}
