import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid, round2, today } from "@/lib/format";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { ConfirmButton } from "@/components/editors";
import { PILL } from "../../InventoryTabs";
import { cancelProduction, finishProduction, saveProductionDraft } from "../actions";

export const metadata = { title: "Production order" };

/**
 * One production run. As a draft its quantities can change; started, its materials sit in work in progress; finished,
 * the product is in stock at what it really cost.
 */
export default async function ProductionOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireView("inventory");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [o] = await db.select().from(schema.productionOrders).where(and(eq(schema.productionOrders.id, id), eq(schema.productionOrders.companyId, ctx.company.id)));
  if (!o) notFound();
  const [[product], lines] = await Promise.all([
    db.select().from(schema.items).where(eq(schema.items.id, o.itemId)),
    db.select({ l: schema.productionLines, sku: schema.items.sku, name: schema.items.name, unit: schema.items.unit, avgCost: schema.items.avgCost, onHand: schema.items.qtyOnHand })
      .from(schema.productionLines).innerJoin(schema.items, eq(schema.items.id, schema.productionLines.componentId))
      .where(eq(schema.productionLines.orderId, id)).orderBy(asc(schema.productionLines.sortOrder)),
  ]);
  const canEdit = ctx.can("inventory", "write");
  const draft = o.status === "draft";
  // A draft shows what the materials would cost today; after the start, what they did cost.
  const materials = draft ? round2(lines.reduce((s, r) => s + r.l.quantity * r.avgCost, 0)) : o.materialsCost;
  const conversion = o.status === "done" ? o.conversionCost : round2(product.conversionCost * o.quantity);
  const total = round2(materials + conversion);
  const units = o.status === "done" ? o.quantityMade : o.quantity;
  const short = draft ? lines.filter((r) => r.l.quantity > r.onHand + 0.0005) : [];
  return (
    <div className="stack">
      <PageHead title={`${o.number} · ${product.sku} ${product.name}`}>
        <Pill kind={PILL[o.status]}>{t(`mo_st_${o.status}`)}</Pill>
        <Link className="btn ghost" href="/inventory/production">{t("back")}</Link>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}

      <div className="kpis">
        <div className="panel kpi"><div className="label">{o.status === "done" ? t("mo_made") : t("mo_planned")}</div><div className="v">{units} {product.unit}</div></div>
        <div className="panel kpi"><div className="label">{t("mo_materials")}</div><div className="v">{money(materials)}</div></div>
        <div className="panel kpi"><div className="label">{t("mo_conversion")}</div><div className="v">{money(conversion)}</div></div>
        <div className="panel kpi"><div className="label">{t("mo_unit_cost")}</div><div className="v">{units ? money(total / units, 2) : "—"}</div></div>
      </div>

      {draft ? (
        <form action={saveProductionDraft} className="panel stack">
          <input type="hidden" name="id" value={o.id} />
          <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
            <div className="fields">
              <label className="f">{t("mo_qty_to_make")}<input id="mo-qty" name="quantity" className="num" inputMode="decimal" defaultValue={o.quantity} required /></label>
              <label className="f">{t("mo_planned_date")}<input id="mo-planned" name="plannedDate" type="date" defaultValue={o.plannedDate} /></label>
              <label className="f">{t("notes")}<input id="mo-notes" name="notes" defaultValue={o.notes} /></label>
            </div>
            <h2>{t("mo_materials")}</h2>
            <div className="small muted">{t("mo_draft_help")}</div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>{t("item")}</th><th className="num">{t("mo_to_issue")}</th><th className="num">{t("on_hand")}</th><th className="num">{t("avg_cost")}</th><th className="num">{t("amount")}</th></tr></thead>
              <tbody>
                {lines.map((r) => (
                  <tr key={r.l.id}>
                    <td>{r.sku} · {r.name}</td>
                    <td className="num"><input type="hidden" name="lineId" value={r.l.id} />
                      <input id={`mo-l-${r.l.id}`} name="lineQty" className="num" inputMode="decimal" defaultValue={r.l.quantity} style={{ maxWidth: 120 }} aria-label={r.sku} /> {r.unit}</td>
                    <td className="num" style={r.l.quantity > r.onHand + 0.0005 ? { color: "var(--bad)" } : undefined}>{r.onHand} {r.unit}</td>
                    <td className="num">{money(r.avgCost, 2)}</td>
                    <td className="num">{money(r.l.quantity * r.avgCost)}</td>
                  </tr>
                ))}
                <tr className="total"><td colSpan={4}>{t("total")}</td><td className="num">{money(materials)}</td></tr>
              </tbody>
            </table></div>
            {short.length ? <div className="note warn small">{t("mo_short")}: {short.map((r) => `${r.sku} (${r.onHand}/${r.l.quantity} ${r.unit})`).join(", ")}</div> : null}
            {canEdit ? (
              <div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <button type="submit" name="do" value="save" className="btn">{t("save")}</button>
                <label className="f" style={{ maxWidth: 180 }}>{t("mo_start_date")}<input id="mo-start" name="startDate" type="date" defaultValue={today()} /></label>
                <ConfirmButton className="btn primary" name="do" value="start" confirmLabel={t("confirm")}>{t("mo_start")}</ConfirmButton>
              </div>
            ) : null}
          </fieldset>
        </form>
      ) : (
        <div className="panel stack">
          <h2>{t("mo_materials")}</h2>
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("item")}</th><th className="num">{t("mo_issued")}</th><th className="num">{t("unit_cost")}</th><th className="num">{t("amount")}</th></tr></thead>
            <tbody>
              {lines.map((r) => (
                <tr key={r.l.id}><td>{r.sku} · {r.name}</td><td className="num">{r.l.quantity} {r.unit}</td><td className="num">{money(r.l.unitCost, 2)}</td><td className="num">{money(r.l.value)}</td></tr>
              ))}
              <tr className="total"><td colSpan={3}>{t("total")}</td><td className="num">{money(o.materialsCost)}</td></tr>
            </tbody>
          </table></div>
          <div className="row small" style={{ gap: 16, flexWrap: "wrap" }}>
            {o.startDate ? <span>{t("mo_start_date")}: <b>{o.startDate}</b></span> : null}
            {o.finishDate ? <span>{t(o.status === "cancelled" ? "mo_cancel_date" : "mo_finish_date")}: <b>{o.finishDate}</b></span> : null}
            {o.startEntryId ? <Link href={`/journal/${o.startEntryId}`}>{t("mo_entry_start")} →</Link> : null}
            {o.finishEntryId ? <Link href={`/journal/${o.finishEntryId}`}>{t("mo_entry_finish")} →</Link> : null}
          </div>
        </div>
      )}

      {o.status === "in_progress" && canEdit ? (
        <form action={finishProduction} className="panel stack">
          <h2>{t("mo_finish")}</h2>
          <div className="small muted">{t("mo_finish_help")}</div>
          <input type="hidden" name="id" value={o.id} />
          <div className="fields">
            <label className="f">{t("mo_qty_made")}<input id="mo-made" name="quantityMade" className="num" inputMode="decimal" defaultValue={o.quantity} required /></label>
            <label className="f">{t("mo_finish_date")}<input id="mo-finish" name="date" type="date" defaultValue={today()} required /></label>
          </div>
          <div><ConfirmButton className="btn primary" confirmLabel={t("confirm")}>{t("mo_finish_btn")}</ConfirmButton></div>
        </form>
      ) : null}

      {(draft || o.status === "in_progress") && canEdit ? (
        <form action={cancelProduction} className="row" style={{ gap: 10, alignItems: "flex-end" }}>
          <input type="hidden" name="id" value={o.id} />
          {o.status === "in_progress" ? <label className="f" style={{ maxWidth: 180 }}>{t("mo_cancel_date")}<input id="mo-cancel" name="date" type="date" defaultValue={today()} /></label> : null}
          <ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("mo_cancel")}</ConfirmButton>
          {o.status === "in_progress" ? <span className="small muted">{t("mo_cancel_help")}</span> : null}
        </form>
      ) : null}
    </div>
  );
}
