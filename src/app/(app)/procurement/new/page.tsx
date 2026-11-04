import { redirect } from "next/navigation";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote, PageHead } from "@/components/ui";
import { TenderForm } from "../TenderForm";

export const metadata = { title: "New procurement" };

export default async function NewTenderPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("procurement");
  if (!ctx.can("procurement", "write")) redirect("/no-access");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const kind = q("kind") === "tender" ? "tender" : "rfq";
  return (
    <div className="stack">
      <PageHead title={t(kind === "rfq" ? "tn_new_rfq" : "tn_new_tender")} />
      <ErrorNote message={err(q("error"))} />
      <TenderForm ctx={ctx} kind={kind} />
    </div>
  );
}
