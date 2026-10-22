import { notFound } from "next/navigation";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { DocPage } from "@/components/docs";

export const metadata = { title: "Invoices" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const ctx = await requireView("sales");
  const { err } = await getI18n();
  const q = await sp(searchParams);
  const page = await DocPage({ kind: "invoice", ctx, id, error: err(q("error")) });
  return page ?? notFound();
}
