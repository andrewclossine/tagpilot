import { requireWrite } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote, PageHead } from "@/components/ui";
import { OrderForm } from "../OrderForm";

export const metadata = { title: "New purchase order" };

export default async function NewOrderPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireWrite("procurement");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="stack">
      <PageHead title={t("po_new")} />
      <ErrorNote message={err(q("error"))} />
      <OrderForm ctx={ctx} />
    </div>
  );
}
