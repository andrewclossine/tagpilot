import { requireView } from "@/lib/auth";
import { sp, type SearchParams } from "@/lib/actions";
import { DocList } from "@/components/docs";

export const metadata = { title: "Bills" };

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("purchases");
  const q = await sp(searchParams);
  return <DocList kind="bill" ctx={ctx} status={q("status")} />;
}
