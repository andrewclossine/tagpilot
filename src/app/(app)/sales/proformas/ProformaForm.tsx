import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "@/lib/auth";
import { bookOptions, docLabels } from "@/lib/data";
import { addDays, today } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { DocLinesEditor, type DLine, type ItemOpt } from "@/components/editors";
import { PartnerPicker } from "@/components/PartnerPicker";
import { saveProforma } from "./actions";

type Proforma = typeof schema.proformas.$inferSelect;

export async function ProformaForm({ ctx, proforma, lines }: { ctx: Ctx; proforma?: Proforma; lines?: DLine[] }) {
  const { t, accName } = await getI18n();
  const o = await bookOptions(ctx.company.id, accName);
  const db = await getDb();
  const itemRows = await db.select().from(schema.items).where(and(eq(schema.items.companyId, ctx.company.id), eq(schema.items.isActive, true))).orderBy(schema.items.sku);
  const accId = (code: string) => o.accounts.find((a) => a.code === code)?.id ?? "";
  const items: ItemOpt[] = itemRows.map((it) => ({
    id: it.id, label: `${it.sku} · ${it.name}`, name: it.name, unit: it.unit, stock: it.kind === "stock" ? it.qtyOnHand : null, price: it.salePrice, accountId: accId(it.incomeAccount),
  }));
  const customers = o.partners.filter((p) => p.kind === "customer" || p.kind === "both");
  return (
    <form action={saveProforma} className="panel stack">
      {proforma ? <input type="hidden" name="id" value={proforma.id} /> : null}
      <div className="fields">
        <label className="f">{t("customer")}
          <PartnerPicker kind="customer" options={customers.map((p) => ({ id: p.id, name: p.name, terms: p.paymentTerms }))} defaultValue={proforma?.partnerId ?? ""} canAdd={ctx.can("partners", "write")}
            labels={{ add: t("cust_add_new"), title: t("cust_add_new_title"), name: t("name"), tin: t("tin"), phone: t("phone"), email: t("email"), save: t("save"), cancel: t("cancel") }} /></label>
        <label className="f">{t("date")}<input id="date" type="date" name="date" defaultValue={proforma?.date ?? today()} required /></label>
        <label className="f">{t("pf_valid_until")}<input id="validUntil" type="date" name="validUntil" defaultValue={proforma?.validUntil ?? addDays(today(), 30)} required /></label>
        <label className="f">{t("project")}
          <select id="projectId" name="projectId" defaultValue={proforma?.projectId ?? ""}>
            <option value="">{t("none")}</option>
            {o.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select></label>
      </div>
      <DocLinesEditor accounts={o.accountOpts} projects={o.projectOpts} initial={lines ?? []} vatRate={ctx.company.vatRegistered ? ctx.company.vatRate : 0}
        accountTypes={["income", "liability"]} defaultAccountId={accId("4200")} labels={docLabels(t)} items={items} />
      <label className="f">{t("notes")}<textarea id="notes" name="notes" rows={2} defaultValue={proforma?.notes} /></label>
      <div className="small muted">{t("pf_help")}</div>
      <div className="row">
        <button type="submit" className="btn primary">{t("save")}</button>
        <Link className="btn ghost" href={proforma ? `/sales/proformas/${proforma.id}` : "/sales/proformas"}>{t("cancel")}</Link>
      </div>
    </form>
  );
}
