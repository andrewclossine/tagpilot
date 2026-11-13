import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { round2 } from "@/lib/format";
import { Empty, PageHead, Pill } from "@/components/ui";
import { InventoryTabs, PILL } from "../InventoryTabs";

export const metadata = { title: "Production" };


/** Production runs: what is being made, in what quantity, and what it cost. */
export default async function ProductionPage() {
  const ctx = await requireView("inventory");
  const { t, money } = await getI18n();
  const db = await getDb();
  const orders = await db.select({ o: schema.productionOrders, sku: schema.items.sku, name: schema.items.name, unit: schema.items.unit })
    .from(schema.productionOrders).innerJoin(schema.items, eq(schema.items.id, schema.productionOrders.itemId))
    .where(eq(schema.productionOrders.companyId, ctx.company.id)).orderBy(desc(schema.productionOrders.createdAt)).limit(300);
  const wip = round2(orders.filter((r) => r.o.status === "in_progress").reduce((s, r) => s + r.o.materialsCost, 0));
  return (
    <div className="stack">
      <PageHead title={t("mo_title")}>
        {ctx.can("inventory", "write") ? <Link className="btn primary" href="/inventory/production/new">{t("mo_new")}</Link> : null}
      </PageHead>
      <InventoryTabs t={t} current="production" />
      <div className="small muted">{t("mo_help")}</div>
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("mo_wip")} · {ctx.company.currency}</div><div className="v">{money(wip)}</div></div>
        <div className="panel kpi"><div className="label">{t("mo_in_progress")}</div><div className="v">{orders.filter((r) => r.o.status === "in_progress").length}</div></div>
        <div className="panel kpi"><div className="label">{t("mo_drafts")}</div><div className="v">{orders.filter((r) => r.o.status === "draft").length}</div></div>
      </div>
      <div className="panel">
        {orders.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("mo_number")}</th><th>{t("mo_product")}</th><th className="num">{t("mo_planned")}</th><th className="num">{t("mo_made")}</th>
              <th>{t("date")}</th><th className="num">{t("mo_total_cost")}</th><th className="num">{t("mo_unit_cost")}</th><th>{t("status")}</th></tr></thead>
            <tbody>
              {orders.map(({ o, sku, name, unit }) => {
                const total = round2(o.materialsCost + o.conversionCost);
                return (
                  <tr key={o.id} className="click">
                    <td><Link className="rowlink" href={`/inventory/production/${o.id}`}><code className="k">{o.number}</code></Link></td>
                    <td>{sku} · {name}</td>
                    <td className="num">{o.quantity} {unit}</td>
                    <td className="num">{o.status === "done" ? `${o.quantityMade} ${unit}` : "—"}</td>
                    <td className="small">{o.finishDate ?? o.startDate ?? o.plannedDate}</td>
                    <td className="num">{total ? money(total) : "—"}</td>
                    <td className="num">{o.status === "done" && o.quantityMade ? money(total / o.quantityMade, 2) : "—"}</td>
                    <td><Pill kind={PILL[o.status]}>{t(`mo_st_${o.status}`)}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        ) : <Empty>{t("mo_none")}</Empty>}
      </div>
    </div>
  );
}
