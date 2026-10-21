import { getCtx } from "@/lib/auth";
import { sp, type SearchParams } from "@/lib/actions";
import { DocList } from "@/components/docs";

export const metadata = { title: "Invoices" };

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getCtx();
  const q = await sp(searchParams);
  return <DocList kind="invoice" ctx={ctx} status={q("status")} />;
}
