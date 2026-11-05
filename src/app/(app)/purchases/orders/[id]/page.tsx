import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { addDays, isUuid, round2, today } from "@/lib/format";
import { orderProgress, statusOf } from "@/lib/purchase-orders";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { receiveOrderBill } from "../actions";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("purchases");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { t, err, money, accName } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [row] = await db.select({ o: schema.purchaseOrders, vendor: schema.partners.name, project: schema.projects }).from(schema.purchaseOrders)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.purchaseOrders.partnerId)).innerJoin(schema.projects, eq(schema.projects.id, schema.purchaseOrders.projectId))
    .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.companyId, ctx.company.id), inArray(schema.purchaseOrders.status, ["issued", "closed"])));
  if (!row) notFound();
  const { o, vendor, project } = row;
  const [lines, accounts, bills] = await Promise.all([
    db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.orderId, id)).orderBy(asc(schema.purchaseOrderLines.lineNo)),
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), eq(schema.accounts.isActive, true), inArray(schema.accounts.type, ["expense", "asset"]))).orderBy(schema.accounts.code),
    db.select().from(schema.bills).where(and(eq(schema.bills.companyId, ctx.company.id), eq(schema.bills.purchaseOrderId, id))).orderBy(desc(schema.bills.date)),
  ]);
  const p = (await orderProgress(db, [id])).get(id);
  const billed = p?.billed ?? 0;
  const status = statusOf(o, billed);
  const usable = accounts.filter((a) => !["bank", "cash", "momo", "ar", "ap"].includes(a.subtype ?? "") && !a.currency);
  const left = (l: (typeof lines)[number]) => round2(l.quantity - (p?.byLine.get(l.id) ?? 0));
  const canBill = ctx.can("purchases", "write") && o.status === "issued" && lines.some((l) => left(l) > 0);
  const now = today();
  return (
    <div className="stack">
      <PageHead title={`${t("po_title")} ${o.number}`}>
        <Link className="btn" href="/purchases/orders">{t("back")}</Link>
        <a className="btn" href={`/api/pdf/po/${o.id}`} download={`${o.number}.pdf`}>{t("pv_download_pdf")}</a>
        <Pill kind={status}>{t(`po_st_${status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      <div className="panel stack">
        <div className="fields">
          <div><div className="label">{t("supplier")}</div>{vendor}</div>
          <div><div className="label">{t("po_project")}</div><b>{project.code}</b> · {project.name}</div>
          <div><div className="label">{t("date")}</div>{o.date}</div>
          <div><div className="label">{t("subtotal")}</div>{money(o.subtotal, 2)}</div>
          <div><div className="label">{t("po_billed")}</div>{money(billed, 2)}</div>
          <div><div className="label">{t("po_remaining")}</div>{money(o.status === "issued" ? round2(o.subtotal - billed) : 0, 2)}</div>
        </div>
      </div>
      {canBill ? (
        <form action={receiveOrderBill} className="panel stack">
          <h2>{t("po_receive_bill")}</h2>
          <input type="hidden" name="id" value={o.id} />
          <div className="fields">
            <label className="f">{t("po_supplier_bill_no")}<input id="pb-ref" name="supplierRef" required /></label>
            <label className="f">{t("po_bill_date")}<input id="pb-date" name="date" type="date" required defaultValue={now} /></label>
            <label className="f">{t("due_date")}<input id="pb-due" name="dueDate" type="date" required defaultValue={addDays(now, 30)} /></label>
          </div>
          <div className="tbl-wrap"><table className="lines">
            <thead><tr><th>{t("description")}</th><th className="num">{t("po_qty_ordered")}</th><th className="num">{t("po_qty_left")}</th><th className="num">{t("po_qty_this_bill")}</th><th className="num">{t("unit_price")}</th><th>{t("account")}</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}<input type="hidden" name="lineId" value={l.id} /></td>
                <td className="num">{l.quantity}</td><td className="num">{left(l)}</td>
                <td><input id={`pb-q-${l.id}`} name="lineQuantity" className="num" inputMode="decimal" aria-label={t("po_qty_this_bill")} defaultValue={left(l) > 0 ? left(l) : ""} readOnly={left(l) <= 0} /></td>
                <td><input id={`pb-p-${l.id}`} name="linePrice" className="num" inputMode="decimal" aria-label={t("unit_price")} defaultValue={l.unitPrice} /></td>
                <td><select id={`pb-a-${l.id}`} name="lineAccount" aria-label={t("account")} defaultValue="">
                  <option value="">{t("none")}</option>
                  {usable.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
                </select></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="small muted">{t("po_bill_help")}</div>
          <div><button type="submit" className="btn primary">{t("po_receive_bill")}</button></div>
        </form>
      ) : null}
      <div className="panel stack">
        <h2>{t("po_bills")}</h2>
        {bills.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("po_supplier_bill_no")}</th><th>{t("date")}</th><th className="num">{t("total")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{bills.map((b) => (
              <tr key={b.id}><td><Link className="rowlink" href={`/purchases/bills/${b.id}`}>{b.number}</Link></td><td>{b.supplierRef}</td><td>{b.date}</td><td className="num">{money(b.total, 2)}</td>
                <td><Pill kind={b.status}>{t(`st_${b.status}`)}</Pill></td></tr>
            ))}</tbody>
          </table></div>
        ) : <div className="small muted">{t("nothing_yet")}</div>}
      </div>
    </div>
  );
}
