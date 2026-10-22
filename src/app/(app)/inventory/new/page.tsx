import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { today } from "@/lib/format";
import { ensureInventoryAccounts } from "@/lib/inventory";
import { ErrorNote, PageHead } from "@/components/ui";
import { ItemFields } from "../ItemFields";
import { createItem } from "../actions";

export const metadata = { title: "New item" };

export default async function NewItemPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("inventory");
  const { t, err, accName } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  if (ctx.can("inventory", "write")) await ensureInventoryAccounts(db, ctx.company.id);
  const accounts = (await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id)).orderBy(schema.accounts.code))
    .map((a) => ({ code: a.code, name: accName(a), type: a.type }));
  return (
    <div className="stack">
      <PageHead title={t("item_new")}><Link className="btn ghost" href="/inventory">{t("back")}</Link></PageHead>
      <ErrorNote message={err(q("error"))} />
      <form action={createItem} className="panel stack">
        <ItemFields t={t} accounts={accounts} />
        <h3>{t("inv_opening")}</h3>
        <div className="small muted">{t("inv_opening_help")}</div>
        <div className="fields">
          <label className="f">{t("qty")}<input id="o-qty" name="openingQty" className="num" inputMode="decimal" /></label>
          <label className="f">{t("unit_cost")}<input id="o-cost" name="openingCost" className="num" inputMode="decimal" /></label>
          <label className="f">{t("date")}<input id="o-date" name="openingDate" type="date" defaultValue={today()} /></label>
          <label className="f">{t("inv_opening_credit")}
            <select id="o-credit" name="openingCredit" defaultValue="3200">
              {accounts.filter((a) => a.type === "equity" || a.type === "liability").map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
            </select></label>
        </div>
        <div><button type="submit" className="btn primary">{t("save")}</button></div>
      </form>
    </div>
  );
}
