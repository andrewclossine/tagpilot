import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote, PageHead } from "@/components/ui";
import { RequisitionForm } from "../RequisitionForm";

export const metadata = { title: "New purchase requisition" };

export default async function NewRequisitionPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("requisitions");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="stack">
      <PageHead title={t("rq_new")} />
      <ErrorNote message={err(q("error"))} />
      <RequisitionForm ctx={ctx} />
    </div>
  );
}
