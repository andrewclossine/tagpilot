import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { today } from "@/lib/format";
import { Empty } from "@/components/ui";
import { saveOrder } from "./actions";

type Order = typeof schema.purchaseOrders.$inferSelect;
type Line = typeof schema.purchaseOrderLines.$inferSelect;

const ROWS = 8;

export async function OrderForm({ ctx, order, lines = [] }: { ctx: Ctx; order?: Order; lines?: Line[] }) {
  const { t } = await getI18n();
  const db = await getDb();
  const [partners, projects] = await Promise.all([
    db.select().from(schema.partners).where(and(eq(schema.partners.companyId, ctx.company.id), inArray(schema.partners.kind, ["supplier", "both"]))).orderBy(schema.partners.name),
    db.select().from(schema.projects).where(and(eq(schema.projects.companyId, ctx.company.id), eq(schema.projects.isActive, true))).orderBy(schema.projects.code),
  ]);
  if (!projects.length) return <div className="panel"><Empty>{t("po_no_projects")}</Empty></div>;
  const vat = ctx.company.vatRegistered;
  return (
    <form action={saveOrder} className="panel stack">
      {order ? <input type="hidden" name="id" value={order.id} /> : null}
      <div className="fields">
        <label className="f">{t("supplier")}
          <select id="po-partner" name="partnerId" required defaultValue={order?.partnerId ?? ""}>
            <option value="" disabled>{t("none")}</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <label className="f">{t("po_project")}
          <select id="po-project" name="projectId" required defaultValue={order?.projectId ?? ""}>
            <option value="" disabled>{t("none")}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select></label>
        <label className="f">{t("date")}<input id="po-date" name="date" type="date" required defaultValue={order?.date ?? today()} /></label>
        <label className="f">{t("po_expected")}<input id="po-expected" name="expectedDate" type="date" defaultValue={order?.expectedDate ?? ""} /></label>
      </div>
      <div className="tbl-wrap"><table className="lines">
        <thead><tr><th>{t("description")}</th><th className="num">{t("qty")}</th><th className="num">{t("unit_price")} ({ctx.company.currency})</th>{vat ? <th>{t("vat")}</th> : null}</tr></thead>
        <tbody>{Array.from({ length: ROWS }, (_, i) => (
          <tr key={i}>
            <td><input id={`po-desc-${i}`} name="lineDescription" aria-label={t("description")} defaultValue={lines[i]?.description} /></td>
            <td><input id={`po-qty-${i}`} name="lineQuantity" className="num" inputMode="decimal" aria-label={t("qty")} defaultValue={lines[i]?.quantity ?? ""} /></td>
            <td><input id={`po-price-${i}`} name="linePrice" className="num" inputMode="decimal" aria-label={t("unit_price")} defaultValue={lines[i]?.unitPrice ?? ""} /></td>
            {vat ? <td><select id={`po-vat-${i}`} name="lineVat" aria-label={t("vat")} defaultValue={lines[i] && !lines[i].vatApplies ? "0" : "1"}><option value="1">{t("yes")}</option><option value="0">{t("no")}</option></select></td> : <td hidden><input type="hidden" name="lineVat" value="0" /></td>}
          </tr>
        ))}</tbody>
      </table></div>
      <label className="f">{t("notes")}<textarea id="po-notes" name="notes" rows={2} defaultValue={order?.notes} /></label>
      <div className="row">
        <button type="submit" className="btn primary">{t("save_draft")}</button>
        <Link className="btn ghost" href={order ? `/procurement/orders/${order.id}` : "/procurement/orders"}>{t("cancel")}</Link>
      </div>
    </form>
  );
}
