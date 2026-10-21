import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { DocForm } from "@/components/docs";

export const metadata = { title: "Bills" };

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getCtx();
  const { err } = await getI18n();
  const q = await sp(searchParams);
  return <DocForm kind="bill" ctx={ctx} error={err(q("error"))} />;
}
