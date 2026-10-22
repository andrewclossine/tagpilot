import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { round2 } from "@/lib/format";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Inventory" };

/** Items with quantity on hand, weighted average cost and stock value; items at or below their reorder level stand out. */
export default async function InventoryPage() {
  const ctx = await requireView("inventory");
  const { t, money } = await getI18n();
  const db = await getDb();
  const items = await db.select().from(schema.items).where(eq(schema.items.companyId, ctx.company.id)).orderBy(schema.items.sku);
  const stock = items.filter((i) => i.kind === "stock");
  const value = round2(stock.reduce((s, i) => s + i.qtyOnHand * i.avgCost, 0));
  const low = stock.filter((i) => i.isActive && i.reorderLevel > 0 && i.qtyOnHand <= i.reorderLevel);
  return (
    <div className="stack">
      <PageHead title={t("nav_inventory")}>
        {ctx.can("inventory", "write") ? <Link className="btn primary" href="/inventory/new">{t("item_new")}</Link> : null}
      </PageHead>
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("stock_value")} · {ctx.company.currency}</div><div className="v">{money(value)}</div></div>
        <div className="panel kpi"><div className="label">{t("items_count")}</div><div className="v">{items.length}</div></div>
        <div className="panel kpi"><div className="label">{t("low_stock")}</div><div className="v">{low.length}</div></div>
      </div>
      {low.length ? <div className="note warn small">{t("low_stock")}: {low.map((i) => `${i.sku} (${i.qtyOnHand} ${i.unit})`).join(", ")}</div> : null}
      <div className="panel">
        {items.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("sku")}</th><th>{t("name")}</th><th>{t("item_kind")}</th><th className="num">{t("on_hand")}</th>
              <th className="num">{t("avg_cost")}</th><th className="num">{t("stock_value")}</th><th className="num">{t("sale_price")}</th><th /></tr></thead>
            <tbody>
              {items.map((i) => {
                const isLow = i.kind === "stock" && i.reorderLevel > 0 && i.qtyOnHand <= i.reorderLevel;
                return (
                  <tr key={i.id} className="click" style={{ opacity: i.isActive ? 1 : 0.5 }}>
                    <td><code className="k">{i.sku}</code></td>
                    <td><Link className="rowlink" href={`/inventory/${i.id}`}>{i.name}</Link></td>
                    <td className="small">{t(i.kind === "stock" ? "item_stock" : "item_service")}</td>
                    <td className="num">{i.kind === "stock" ? `${i.qtyOnHand} ${i.unit}` : "—"}</td>
                    <td className="num">{i.kind === "stock" ? money(i.avgCost, 2) : ""}</td>
                    <td className="num">{i.kind === "stock" ? money(i.qtyOnHand * i.avgCost) : ""}</td>
                    <td className="num">{money(i.salePrice)}</td>
                    <td>{isLow ? <Pill kind="overdue">{t("low_stock")}</Pill> : null}</td>
                  </tr>
                );
              })}
              <tr className="total"><td colSpan={5}>{t("total")}</td><td className="num">{money(value)}</td><td colSpan={2} /></tr>
            </tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
