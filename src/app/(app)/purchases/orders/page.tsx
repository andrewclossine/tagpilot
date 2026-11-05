import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { OrderList } from "@/components/OrderList";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Purchase orders" };

/** The orders Procurement issued, as Accounting sees them: where a supplier's bill is received. */
export default async function PurchaseOrdersPage() {
  const ctx = await requireView("purchases");
  const { t } = await getI18n();
  return (
    <div className="stack">
      <PageHead title={t("nav_purchase_orders")} />
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("po_accounting_help")}</p>
      <div className="panel"><OrderList ctx={ctx} base="/purchases/orders" issuedOnly /></div>
    </div>
  );
}
