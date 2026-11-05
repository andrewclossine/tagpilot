import Link from "next/link";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { OrderList } from "@/components/OrderList";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Purchase orders" };

export default async function OrdersPage() {
  const ctx = await requireView("procurement");
  const { t } = await getI18n();
  return (
    <div className="stack">
      <PageHead title={t("nav_purchase_orders")}>
        {ctx.can("procurement", "write") ? <Link className="btn primary" href="/procurement/orders/new">{t("po_new")}</Link> : null}
      </PageHead>
      <div className="panel"><OrderList ctx={ctx} base="/procurement/orders" /></div>
    </div>
  );
}
