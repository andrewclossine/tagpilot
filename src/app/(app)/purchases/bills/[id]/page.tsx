import { notFound } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { DocPage } from "@/components/docs";

export const metadata = { title: "Bills" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const ctx = await getCtx();
  const { err } = await getI18n();
  const q = await sp(searchParams);
  const page = await DocPage({ kind: "bill", ctx, id, error: err(q("error")) });
  return page ?? notFound();
}
