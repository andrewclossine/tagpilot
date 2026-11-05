import { requireView } from "@/lib/auth";
import { sp, type SearchParams } from "@/lib/actions";
import { PartnerList } from "@/components/PartnerList";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("partners");
  const q = await sp(searchParams);
  return <PartnerList ctx={ctx} only="supplier" back="/purchases/suppliers" title="nav_suppliers" error={q("error")} editId={q("edit")} />;
}
