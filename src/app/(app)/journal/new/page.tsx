import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote, PageHead } from "@/components/ui";
import { EntryForm } from "../EntryForm";

export const metadata = { title: "New journal entry" };

export default async function NewEntryPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("journal");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="stack">
      <PageHead title={t("jr_new")} />
      <ErrorNote message={err(q("error"))} />
      <EntryForm ctx={ctx} />
    </div>
  );
}
