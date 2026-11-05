import { requireView } from "@/lib/auth";
import { sp, type SearchParams } from "@/lib/actions";
import { PartnerList } from "@/components/PartnerList";

export const metadata = { title: "Customers & suppliers" };

export default async function PartnersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("partners");
  const q = await sp(searchParams);
  return <PartnerList ctx={ctx} back="/partners" title="partners_title" error={q("error")} editId={q("edit")} />;
}
