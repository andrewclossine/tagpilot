import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { today } from "@/lib/format";
import { ErrorNote, PageHead } from "@/components/ui";
import { receiveItems } from "../actions";

export const metadata = { title: "Receive items" };

const ROWS = Array.from({ length: 8 }, (_, i) => i);

export default async function NewReceiptPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("purchases");
  if (!ctx.can("purchases", "write")) redirect("/no-access");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [suppliers, items] = await Promise.all([
    db.select().from(schema.partners).where(and(eq(schema.partners.companyId, ctx.company.id), inArray(schema.partners.kind, ["supplier", "both"]))).orderBy(schema.partners.name),
    db.select().from(schema.items).where(and(eq(schema.items.companyId, ctx.company.id), eq(schema.items.kind, "stock"), eq(schema.items.isActive, true))).orderBy(schema.items.sku),
  ]);
  return (
    <div className="stack">
      <PageHead title={t("gr_new")}><Link className="btn ghost" href="/purchases/receive-items">{t("back")}</Link></PageHead>
      <ErrorNote message={err(q("error"))} />
      {!suppliers.length ? <div className="note warn small"><Link href="/purchases/suppliers">{t("nav_suppliers")} →</Link></div> : null}
      {!items.length ? <div className="note warn small"><Link href="/inventory/new">{t("item_new")} →</Link></div> : null}
      <form action={receiveItems} className="panel stack">
        <div className="fields">
          <label className="f">{t("supplier")}
            <select id="r-partner" name="partnerId" required defaultValue="">
              <option value="">—</option>
              {suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          <label className="f">{t("date")}<input id="r-date" name="date" type="date" required defaultValue={today()} /></label>
          <label className="f">{t("gr_delivery_note")}<input id="r-note" name="deliveryNote" required /></label>
          <label className="f">{t("gr_file")}<input id="r-file" name="file" type="file" accept="image/*,application/pdf" /></label>
        </div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("item")}</th><th className="num">{t("qty")}</th><th className="num">{t("gr_unit_cost")}</th></tr></thead>
          <tbody>{ROWS.map((i) => (
            <tr key={i}>
              <td><select id={`r-item-${i}`} name="itemId" defaultValue="" aria-label={t("item")}>
                <option value="">—</option>
                {items.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name} ({it.unit})</option>)}
              </select></td>
              <td><input id={`r-qty-${i}`} name="quantity" className="num" inputMode="decimal" aria-label={t("qty")} /></td>
              <td><input id={`r-cost-${i}`} name="unitCost" className="num" inputMode="decimal" aria-label={t("gr_unit_cost")} /></td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="small muted">{t("gr_cost_help")}</div>
        <label className="f">{t("notes")}<textarea id="r-notes" name="notes" rows={2} /></label>
        <div><button type="submit" className="btn primary">{t("gr_receive")}</button></div>
      </form>
    </div>
  );
}
