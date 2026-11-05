import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote, PageHead } from "@/components/ui";
import { saveCheck } from "../actions";
import { BankDocFields, BankRegister } from "../BankForms";

export const metadata = { title: "Write check" };

export default async function CheckPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("banking");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="stack">
      <PageHead title={t("nav_write_check")} />
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {ctx.can("banking", "write") ? (
        <form action={saveCheck} className="panel stack">
          <BankDocFields ctx={ctx} kind="check" />
          <div><button type="submit" className="btn primary">{t("nav_write_check")}</button></div>
        </form>
      ) : null}
      <div className="panel stack"><h2>{t("bk_checks_written")}</h2><BankRegister ctx={ctx} kinds={["check"]} pdf /></div>
    </div>
  );
}
