import { redirect } from "next/navigation";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote, PageHead } from "@/components/ui";
import { VoucherForm } from "../VoucherForm";

export const metadata = { title: "New payment voucher" };

export default async function NewVoucherPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("vouchers");
  if (!ctx.can("vouchers", "write")) redirect("/no-access");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="stack">
      <PageHead title={t("pv_new")} />
      <ErrorNote message={err(q("error"))} />
      <VoucherForm ctx={ctx} project={q("project")} line={q("line")} />
    </div>
  );
}
