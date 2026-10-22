import type { T } from "@/lib/i18n";

type Item = {
  sku: string; name: string; unit: string; kind: string; salePrice: number; purchaseCost: number; reorderLevel: number;
  inventoryAccount: string; incomeAccount: string; cogsAccount: string; expenseAccount: string; isActive: boolean;
};
type Acc = { code: string; name: string; type: string };

/** The item form fields shared by the new-item and item pages. */
export function ItemFields({ t, item, accounts, fixedKind }: { t: T; item?: Item; accounts: Acc[]; fixedKind?: boolean }) {
  const sel = (name: keyof Item, value: string, types: string[]) => (
    <select id={`i-${name}`} name={name} defaultValue={value}>
      {accounts.filter((a) => types.includes(a.type)).map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
    </select>
  );
  return (
    <>
      <div className="fields">
        <label className="f">{t("sku")}<input id="i-sku" name="sku" defaultValue={item?.sku} required pattern="[A-Za-z0-9._\-]+" /></label>
        <label className="f">{t("name")}<input id="i-name" name="name" defaultValue={item?.name} required /></label>
        <label className="f">{t("unit")}<input id="i-unit" name="unit" defaultValue={item?.unit ?? "pcs"} /></label>
        <label className="f">{t("item_kind")}
          <select id="i-kind" name="kind" defaultValue={item?.kind ?? "stock"} disabled={fixedKind}>
            <option value="stock">{t("item_stock")}</option><option value="service">{t("item_service")}</option>
          </select></label>
        <label className="f">{t("sale_price")}<input id="i-salePrice" name="salePrice" className="num" inputMode="decimal" defaultValue={item?.salePrice ?? ""} /></label>
        <label className="f">{t("purchase_cost")}<input id="i-purchaseCost" name="purchaseCost" className="num" inputMode="decimal" defaultValue={item?.purchaseCost ?? ""} /></label>
        <label className="f">{t("reorder_level")}<input id="i-reorder" name="reorderLevel" className="num" inputMode="decimal" defaultValue={item?.reorderLevel ?? ""} /></label>
        {item ? <label className="f">{t("status")}<select id="i-active" name="isActive" defaultValue={item.isActive ? "1" : "0"}><option value="1">{t("active")}</option><option value="0">{t("inactive")}</option></select></label> : null}
      </div>
      <div className="fields">
        <label className="f">{t("inv_account")}{sel("inventoryAccount", item?.inventoryAccount ?? "1300", ["asset"])}</label>
        <label className="f">{t("revenue_account")}{sel("incomeAccount", item?.incomeAccount ?? "4100", ["income"])}</label>
        <label className="f">{t("cogs_account")}{sel("cogsAccount", item?.cogsAccount ?? "5100", ["expense"])}</label>
        <label className="f">{t("expense_account")}{sel("expenseAccount", item?.expenseAccount ?? "6900", ["expense", "asset"])}</label>
      </div>
    </>
  );
}
