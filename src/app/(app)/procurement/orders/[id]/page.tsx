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
import { closeOrder, deleteOrder, issueOrder, rateOrderAction, receiveOrder, voidOrderReceipt } from "../actions";
import { matchBill, receiptsOf, receivedByLine } from "@/lib/receipts";
import { today } from "@/lib/format";
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
  const [got, notes, bills] = await Promise.all([
    receivedByLine(db, [id]), receiptsOf(db, id),
    db.select().from(schema.bills).where(and(eq(schema.bills.purchaseOrderId, id), eq(schema.bills.companyId, ctx.company.id))),
  ]);
  const matches = await Promise.all(bills.map(async (b) => ({ b, m: await matchBill(db, b.id) })));
  const [rating] = await db.select().from(schema.supplierRatings).where(eq(schema.supplierRatings.orderId, id));
  const delivered = notes.some((n) => n.r.status === "received");
  const outstanding = (lineId: string, qty: number) => round2(qty - (got.get(lineId)?.accepted ?? 0));
  const lineOf = (lineId: string) => lines.find((l) => l.id === lineId);
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
          <thead><tr><th>{t("description")}</th><th className="num">{t("qty")}</th><th className="num">{t("unit_price")}</th><th className="num">{t("amount")}</th><th className="num">{t("grn_accepted")}</th><th className="num">{t("po_qty_billed")}</th></tr></thead>
          <tbody>
            {lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitPrice, 2)}</td><td className="num">{money(l.amount, 2)}</td><td className="num">{got.get(l.id)?.accepted ?? 0}</td><td className="num">{p?.byLine.get(l.id) ?? 0}</td></tr>)}
            <tr className="rsub"><td colSpan={3}>{t("subtotal")}</td><td className="num">{money(o.subtotal, 2)}</td><td colSpan={2} /></tr>
            {o.vat ? <tr><td colSpan={3}>{t("vat")}</td><td className="num">{money(o.vat, 2)}</td><td colSpan={2} /></tr> : null}
            <tr className="total"><td colSpan={3}>{t("total")} {ctx.company.currency}</td><td className="num">{money(o.total, 2)}</td><td colSpan={2} /></tr>
          </tbody>
        </table></div>
        <div className="small muted">{t("po_billed")}: {money(billed, 2)} · {t("po_remaining")}: {money(round2(o.subtotal - billed), 2)}</div>
        {o.requireReceipt ? <div className="note info small">{t("po_match_on")}</div> : null}
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
      {notes.length ? (
        <div className="panel stack" id="receipts">
          <h2>{t("grn_title")}</h2>
          {notes.map(({ r, by, lines: ls }) => (
            <div key={r.id} className="stack" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 10, opacity: r.status === "void" ? 0.6 : 1 }}>
              <div className="row" style={{ gap: 8 }}>
                <b style={{ flex: 1 }}>{r.number} · {r.date}{r.deliveryNote ? ` · ${t("grn_delivery_note")} ${r.deliveryNote}` : ""}</b>
                <span className="small muted">{by}</span>
                {r.status === "void" ? <Pill kind="cancelled">{t("grn_void")}</Pill> : null}
                {r.attachmentId ? <a className="small" href={`/api/files/${r.attachmentId}`} target="_blank" rel="noreferrer">{t("tn_file")}</a> : null}
              </div>
              <div className="small">{(["quantity", "specification", "condition", "documents"] as const).map((k) => <span key={k} style={{ marginRight: 12, color: r.checks[k] ? "var(--ok)" : "var(--bad)" }}>{r.checks[k] ? "✓" : "✗"} {t(`grn_chk_${k}`)}</span>)}</div>
              <div className="tbl-wrap"><table>
                <thead><tr><th>{t("description")}</th><th className="num">{t("grn_received")}</th><th className="num">{t("grn_accepted")}</th><th className="num">{t("grn_rejected")}</th><th>{t("notes")}</th></tr></thead>
                <tbody>{ls.map((l) => <tr key={l.id}><td>{lineOf(l.lineId)?.description}</td><td className="num">{l.received}</td><td className="num">{l.accepted}</td><td className="num">{round2(l.received - l.accepted) || ""}</td><td className="small">{l.note}</td></tr>)}</tbody>
              </table></div>
              {r.defects ? <div className="note warn small" style={{ whiteSpace: "pre-wrap" }}>{t("grn_defects")}: {r.defects}</div> : null}
              {r.status === "void" ? <div className="small muted">{r.voidNote}</div> : write ? (
                <form action={voidOrderReceipt} className="row" style={{ gap: 8 }}>
                  <input type="hidden" name="id" value={o.id} /><input type="hidden" name="receiptId" value={r.id} />
                  <input name="note" placeholder={t("grn_void_reason")} aria-label={t("grn_void_reason")} style={{ maxWidth: 280 }} />
                  <ConfirmButton className="btn sm ghost danger" confirmLabel={t("confirm")}>{t("grn_void_btn")}</ConfirmButton>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {delivered && (write || rating) ? (
        <div className="panel stack" id="rating">
          <h2>{t("rate_title")}</h2>
          {rating ? <div className="small">{t("rate_quality")} <b>{rating.quality}</b> · {t("rate_delivery")} <b>{rating.delivery}</b> · {t("rate_service")} <b>{rating.service}</b>{rating.comment ? ` · ${rating.comment}` : ""}</div> : <div className="small muted">{t("rate_help")}</div>}
          {write ? (
            <form action={rateOrderAction} className="fields" style={{ alignItems: "end" }}>
              <input type="hidden" name="id" value={o.id} />
              {(["quality", "delivery", "service"] as const).map((k) => (
                <label key={k} className="f">{t(`rate_${k}`)}
                  <select name={k} defaultValue={String(rating?.[k] ?? 4)}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)} {n}</option>)}</select></label>
              ))}
              <label className="f">{t("cm_comment")}<input name="comment" defaultValue={rating?.comment ?? ""} /></label>
              <div><button type="submit" className="btn">{t(rating ? "rate_update" : "rate_save")}</button></div>
            </form>
          ) : null}
        </div>
      ) : null}

      {matches.length ? (
        <div className="panel stack">
          <h2>{t("match_title")}</h2>
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("src_bill")}</th><th>{t("date")}</th><th className="num">{t("amount")}</th><th>{t("status")}</th><th>{t("match_result")}</th></tr></thead>
            <tbody>{matches.map(({ b, m }) => (
              <tr key={b.id}>
                <td><Link href={`/purchases/bills/${b.id}`}>{b.number ?? b.supplierRef ?? t("st_draft")}</Link></td><td>{b.date}</td><td className="num">{money(b.total, 2)}</td><td>{b.status}</td>
                <td>{!m.applies ? <span className="muted">{t("match_off")}</span> : m.issues.length ? <span style={{ color: "var(--bad)" }}>✗ {m.issues.map((i) => t(`match_issue_${i}`)).join(", ")}</span> : <span style={{ color: "var(--ok)" }}>✓ {t("match_ok")}</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ) : null}

      {write && o.status === "issued" && lines.some((l) => outstanding(l.id, l.quantity) > 0) ? (
        <form action={receiveOrder} className="panel stack" id="receive">
          <h2>{t("grn_receive")}</h2>
          <div className="small muted">{t("grn_help")}</div>
          <input type="hidden" name="id" value={o.id} />
          <div className="fields">
            <label className="f">{t("date")}<input id="g-date" name="date" type="date" required defaultValue={today()} /></label>
            <label className="f">{t("grn_delivery_note")}<input id="g-dn" name="deliveryNote" /></label>
            <label className="f">{t("tn_file")}<input id="g-file" name="file" type="file" accept="image/*,application/pdf" /></label>
          </div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("description")}</th><th className="num">{t("grn_outstanding")}</th><th className="num">{t("grn_received")}</th><th className="num">{t("grn_accepted")}</th><th>{t("notes")}</th></tr></thead>
            <tbody>{lines.filter((l) => outstanding(l.id, l.quantity) > 0).map((l) => (
              <tr key={l.id}>
                <td>{l.description}<input type="hidden" name="grnLine" value={l.id} /></td>
                <td className="num">{outstanding(l.id, l.quantity)}</td>
                <td><input name={`received_${l.id}`} className="num" style={{ width: 100 }} inputMode="decimal" aria-label={t("grn_received")} /></td>
                <td><input name={`accepted_${l.id}`} className="num" style={{ width: 100 }} inputMode="decimal" placeholder={t("grn_all")} aria-label={t("grn_accepted")} /></td>
                <td><input name={`grnNote_${l.id}`} aria-label={t("notes")} /></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="stack" style={{ gap: 4 }}>
            <div className="label">{t("grn_inspection")}</div>
            {(["Quantity", "Specification", "Condition", "Documents"] as const).map((k) => (
              <label key={k} className="row small" style={{ gap: 8 }}><input type="checkbox" name={`chk${k}`} defaultChecked style={{ width: "auto" }} /> {t(`grn_chk_${k.toLowerCase() as "quantity"}`)}</label>
            ))}
          </div>
          <label className="f">{t("grn_defects")}<textarea id="g-defects" name="defects" rows={2} placeholder={t("grn_defects_help")} /></label>
          <div><button type="submit" className="btn primary">{t("grn_save")}</button></div>
        </form>
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
