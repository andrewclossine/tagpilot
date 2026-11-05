import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { cancelReceipt, makeBill } from "../actions";

export const metadata = { title: "Receive items" };

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("purchases");
  const { t, err, money } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const [row] = await db.select({ r: schema.goodsReceipts, supplier: schema.partners.name }).from(schema.goodsReceipts)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.goodsReceipts.partnerId))
    .where(and(eq(schema.goodsReceipts.id, id), eq(schema.goodsReceipts.companyId, ctx.company.id)));
  if (!row) notFound();
  const { r, supplier } = row;
  const lines = await db.select({ l: schema.goodsReceiptLines, sku: schema.items.sku, name: schema.items.name, unit: schema.items.unit }).from(schema.goodsReceiptLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.goodsReceiptLines.itemId)).where(eq(schema.goodsReceiptLines.receiptId, id)).orderBy(schema.goodsReceiptLines.lineNo);
  const write = ctx.can("purchases", "write");
  return (
    <div className="stack">
      <PageHead title={r.number}>
        <Link className="btn" href="/purchases/receive-items">{t("back")}</Link>
        <Pill kind={r.status === "received" ? "open" : r.status === "billed" ? "paid" : "void"}>{t(`gr_${r.status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      <div className="panel stack">
        <div className="fields">
          <div><div className="label">{t("supplier")}</div><b>{supplier}</b></div>
          <div><div className="label">{t("date")}</div>{r.date}</div>
          <div><div className="label">{t("gr_delivery_note")}</div>{r.deliveryNote}</div>
        </div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("item")}</th><th className="num">{t("qty")}</th><th className="num">{t("gr_unit_cost")}</th><th className="num">{t("amount")}</th></tr></thead>
          <tbody>
            {lines.map(({ l, sku, name, unit }) => <tr key={l.id}><td><code className="k">{sku}</code> {name}</td><td className="num">{l.quantity} {unit}</td><td className="num">{money(l.unitCost, 2)}</td><td className="num">{money(l.amount, 2)}</td></tr>)}
            <tr className="total"><td colSpan={3}>{t("total")}</td><td className="num">{money(r.value, 2)}</td></tr>
          </tbody>
        </table></div>
        {r.notes ? <div className="small">{r.notes}</div> : null}
        <div className="row small">
          {r.entryId ? <Link href={`/journal/${r.entryId}`}>{t("open_entry")} →</Link> : null}
          {r.attachmentId ? <a href={`/api/files/${r.attachmentId}`} target="_blank" rel="noreferrer">{t("gr_file")} →</a> : null}
          {r.billId ? <Link href={`/purchases/bills/${r.billId}`}>{t("bill_bill")} →</Link> : null}
        </div>
      </div>
      {write && r.status === "received" && !r.billId ? (
        <div className="panel row">
          <form action={makeBill}><input type="hidden" name="id" value={r.id} /><button type="submit" className="btn primary">{t("gr_make_bill")}</button></form>
          <form action={cancelReceipt}><input type="hidden" name="id" value={r.id} /><ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("void_doc")}</ConfirmButton></form>
          <span className="small muted">{t("gr_bill_help")}</span>
        </div>
      ) : null}
    </div>
  );
}
