import { requireView } from "@/lib/auth";
import { DocList } from "@/components/docs";

export const metadata = { title: "Sales receipts" };

/** Sales paid on the spot. */
export default async function Page() {
  const ctx = await requireView("sales");
  return <DocList kind="invoice" ctx={ctx} status="" receipts />;
}
