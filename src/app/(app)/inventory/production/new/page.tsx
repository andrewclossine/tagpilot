import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { today } from "@/lib/format";
import { ErrorNote, PageHead } from "@/components/ui";
import { newProductionOrder } from "../actions";

export const metadata = { title: "New production order" };

/** Pick a product that has a bill of materials and how many to make. */
export default async function NewProductionPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireWrite("inventory");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const withBom = await db.selectDistinct({ id: schema.bomLines.itemId }).from(schema.bomLines).where(eq(schema.bomLines.companyId, ctx.company.id));
  const products = withBom.length ? await db.select().from(schema.items)
    .where(and(eq(schema.items.companyId, ctx.company.id), eq(schema.items.isActive, true), inArray(schema.items.id, withBom.map((x) => x.id)))).orderBy(schema.items.sku) : [];
  return (
    <div className="stack">
      <PageHead title={t("mo_new")}><Link className="btn ghost" href="/inventory/production">{t("back")}</Link></PageHead>
      <ErrorNote message={err(q("error"))} />
      {products.length ? (
        <form action={newProductionOrder} className="panel stack">
          <div className="fields">
            <label className="f">{t("mo_product")}
              <select id="mo-item" name="itemId" defaultValue={q("item")} required>
                {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name} ({p.unit})</option>)}
              </select></label>
            <label className="f">{t("mo_qty_to_make")}<input id="mo-qty" name="quantity" className="num" inputMode="decimal" required /></label>
            <label className="f">{t("mo_planned_date")}<input id="mo-date" name="plannedDate" type="date" defaultValue={today()} /></label>
            <label className="f">{t("notes")}<input id="mo-notes" name="notes" /></label>
          </div>
          <div className="small muted">{t("mo_new_help")}</div>
          <div><button type="submit" className="btn primary">{t("mo_create")}</button></div>
        </form>
      ) : <div className="panel stack"><div className="muted">{t("mo_no_products")}</div><div><Link className="btn" href="/inventory">{t("nav_items")}</Link></div></div>}
    </div>
  );
}
