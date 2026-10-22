import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid, today } from "@/lib/format";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { ConfirmButton } from "@/components/editors";
import { ItemFields } from "../ItemFields";
import { countItem, updateItem } from "../actions";

export const metadata = { title: "Item" };

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireView("inventory");
  const { t, err, accName, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [it] = await db.select().from(schema.items).where(and(eq(schema.items.id, id), eq(schema.items.companyId, ctx.company.id)));
  if (!it) notFound();
  const [moves, accounts] = await Promise.all([
    db.select().from(schema.stockMoves).where(eq(schema.stockMoves.itemId, id)).orderBy(desc(schema.stockMoves.date), desc(schema.stockMoves.createdAt)).limit(200),
    db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id)).orderBy(schema.accounts.code),
  ]);
  const accList = accounts.map((a) => ({ code: a.code, name: accName(a), type: a.type }));
  const canEdit = ctx.can("inventory", "write");
  const link = (m: (typeof moves)[number]) => m.sourceType === "invoice" ? `/sales/invoices/${m.sourceId}` : m.sourceType === "bill" ? `/purchases/bills/${m.sourceId}` : m.entryId ? `/journal/${m.entryId}` : null;
  return (
    <div className="stack">
      <PageHead title={`${it.sku} · ${it.name}`}>
        <Pill kind={it.isActive ? "posted" : "void"}>{t(it.isActive ? "active" : "inactive")}</Pill>
        <Link className="btn ghost" href="/inventory">{t("back")}</Link>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {it.kind === "stock" ? (
        <div className="kpis">
          <div className="panel kpi"><div className="label">{t("on_hand")}</div><div className="v">{it.qtyOnHand} {it.unit}</div></div>
          <div className="panel kpi"><div className="label">{t("avg_cost")}</div><div className="v">{money(it.avgCost, 2)}</div></div>
          <div className="panel kpi"><div className="label">{t("stock_value")}</div><div className="v">{money(it.qtyOnHand * it.avgCost)}</div></div>
        </div>
      ) : null}
      <div className="grid2">
        <div className="stack">
          <form action={updateItem} className="panel stack">
            <input type="hidden" name="id" value={it.id} />
            <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
              <ItemFields t={t} item={it} accounts={accList} fixedKind />
              {canEdit ? <div><button type="submit" className="btn primary">{t("save")}</button></div> : null}
            </fieldset>
          </form>
          {canEdit && it.kind === "stock" ? (
            <form action={countItem} className="panel stack">
              <h2>{t("stock_count")}</h2>
              <div className="small muted">{t("stock_count_help")}</div>
              <input type="hidden" name="id" value={it.id} />
              <div className="fields">
                <label className="f">{t("date")}<input id="c-date" name="date" type="date" defaultValue={today()} required /></label>
                <label className="f">{t("counted_qty")}<input id="c-counted" name="counted" className="num" inputMode="decimal" required /></label>
                <label className="f">{t("unit_cost_surplus")}<input id="c-cost" name="unitCost" className="num" inputMode="decimal" placeholder={String(it.avgCost)} /></label>
                <label className="f">{t("reason")}<input id="c-reason" name="reason" /></label>
              </div>
              <div><ConfirmButton className="btn" confirmLabel={t("confirm")}>{t("stock_count_btn")}</ConfirmButton></div>
            </form>
          ) : null}
        </div>
        <div className="panel stack">
          <h2>{t("stock_moves")}</h2>
          {moves.length ? (
            <div className="tbl-wrap"><table>
              <thead><tr><th>{t("date")}</th><th>{t("type")}</th><th className="num">{t("qty")}</th><th className="num">{t("unit_cost")}</th><th className="num">{t("amount")}</th><th className="num">{t("on_hand")}</th><th /></tr></thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td className="num" style={{ textAlign: "left" }}>{m.date}</td>
                    <td>{t(`mvk_${m.kind}`)}{m.notes ? <div className="small muted">{m.notes}</div> : null}</td>
                    <td className="num">{m.quantity > 0 ? "+" : ""}{m.quantity}</td>
                    <td className="num">{money(m.unitCost, 2)}</td><td className="num">{money(m.value)}</td><td className="num">{m.qtyAfter}</td>
                    <td>{link(m) ? <Link className="small" href={link(m)!}>→</Link> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <div className="muted small">{t("nothing_yet")}</div>}
        </div>
      </div>
    </div>
  );
}
