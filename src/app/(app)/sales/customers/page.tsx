import { requireView } from "@/lib/auth";
import { sp, type SearchParams } from "@/lib/actions";
import { PartnerList } from "@/components/PartnerList";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("partners");
  const q = await sp(searchParams);
  return <PartnerList ctx={ctx} only="customer" back="/sales/customers" title="nav_customers" error={q("error")} editId={q("edit")} />;
}
