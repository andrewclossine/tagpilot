import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid, round2 } from "@/lib/format";
import { orderProgress, statusOf } from "@/lib/purchase-orders";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { closeOrder, deleteOrder, issueOrder } from "../actions";
import { OrderForm } from "../OrderForm";

export const metadata = { title: "Purchase order" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("procurement");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [row] = await db.select({ o: schema.purchaseOrders, vendor: schema.partners.name, project: schema.projects }).from(schema.purchaseOrders)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.purchaseOrders.partnerId)).innerJoin(schema.projects, eq(schema.projects.id, schema.purchaseOrders.projectId))
    .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.companyId, ctx.company.id)));
  if (!row) notFound();
  const { o, vendor, project } = row;
  const lines = await db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.orderId, id)).orderBy(asc(schema.purchaseOrderLines.lineNo));
  const write = ctx.can("procurement", "write");
  if (q("edit") && o.status === "draft" && write) {
    return (
      <div className="stack">
        <PageHead title={`${t("edit")}: ${o.number}`} />
        <ErrorNote message={err(q("error"))} />
        <OrderForm ctx={ctx} order={o} lines={lines} />
      </div>
    );
  }
  const p = (await orderProgress(db, [id])).get(id);
  const billed = p?.billed ?? 0;
  const status = statusOf(o, billed);
  return (
    <div className="stack">
      <PageHead title={`${t("po_title")} ${o.number}`}>
        <Link className="btn" href="/procurement/orders">{t("back")}</Link>
        <a className="btn" href={`/api/pdf/po/${o.id}`} download={`${o.number}.pdf`}>{t("pv_download_pdf")}</a>
        <Pill kind={status}>{t(`po_st_${status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      <div className="panel stack">
        <div className="fields">
          <div><div className="label">{t("supplier")}</div>{vendor}</div>
          <div><div className="label">{t("po_project")}</div><b>{project.code}</b> · {project.name}</div>
          <div><div className="label">{t("date")}</div>{o.date}</div>
          {o.expectedDate ? <div><div className="label">{t("po_expected")}</div>{o.expectedDate}</div> : null}
        </div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("description")}</th><th className="num">{t("qty")}</th><th className="num">{t("unit_price")}</th><th className="num">{t("amount")}</th><th className="num">{t("po_qty_billed")}</th></tr></thead>
          <tbody>
            {lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitPrice, 2)}</td><td className="num">{money(l.amount, 2)}</td><td className="num">{p?.byLine.get(l.id) ?? 0}</td></tr>)}
            <tr className="rsub"><td colSpan={3}>{t("subtotal")}</td><td className="num">{money(o.subtotal, 2)}</td><td /></tr>
            {o.vat ? <tr><td colSpan={3}>{t("vat")}</td><td className="num">{money(o.vat, 2)}</td><td /></tr> : null}
            <tr className="total"><td colSpan={3}>{t("total")} {ctx.company.currency}</td><td className="num">{money(o.total, 2)}</td><td /></tr>
          </tbody>
        </table></div>
        <div className="small muted">{t("po_billed")}: {money(billed, 2)} · {t("po_remaining")}: {money(round2(o.subtotal - billed), 2)}</div>
        {o.notes ? <div style={{ whiteSpace: "pre-wrap" }}>{o.notes}</div> : null}
        {o.closeNote ? <div className="note info small">{o.closeNote}</div> : null}
      </div>
      {write && o.status === "draft" ? (
        <div className="panel row">
          <form action={issueOrder}><input type="hidden" name="id" value={o.id} /><button type="submit" className="btn primary">{t("po_issue")}</button></form>
          <Link className="btn" href={`/procurement/orders/${o.id}?edit=1`}>{t("edit")}</Link>
          <form action={deleteOrder}><input type="hidden" name="id" value={o.id} /><ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
        </div>
      ) : null}
      {write && o.status === "issued" ? (
        <form action={closeOrder} className="panel stack">
          <h2>{t(billed > 0 ? "po_close" : "po_cancel")}</h2>
          <input type="hidden" name="id" value={o.id} />
          <label className="f">{t("po_close_reason")}<input id="po-note" name="note" required /></label>
          <div><button type="submit" className="btn danger">{t(billed > 0 ? "po_close" : "po_cancel")}</button></div>
        </form>
      ) : null}
    </div>
  );
}
