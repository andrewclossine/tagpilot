import { redirect } from "next/navigation";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote, PageHead } from "@/components/ui";
import { ProformaForm } from "../ProformaForm";

export const metadata = { title: "New proforma" };

export default async function NewProformaPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("sales");
  if (!ctx.can("sales", "write")) redirect("/no-access");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="stack">
      <PageHead title={t("pf_new")} />
      <ErrorNote message={err(q("error"))} />
      <ProformaForm ctx={ctx} />
    </div>
  );
}
