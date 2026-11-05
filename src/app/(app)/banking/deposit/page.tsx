import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote, PageHead } from "@/components/ui";
import { saveDeposit } from "../actions";
import { BankDocFields, BankRegister } from "../BankForms";

export const metadata = { title: "Make deposit" };

export default async function DepositPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("banking");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="stack">
      <PageHead title={t("nav_make_deposit")} />
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {ctx.can("banking", "write") ? (
        <form action={saveDeposit} className="panel stack">
          <BankDocFields ctx={ctx} kind="deposit" />
          <div><button type="submit" className="btn primary">{t("nav_make_deposit")}</button></div>
        </form>
      ) : null}
      <div className="panel stack"><h2>{t("bk_deposits_made")}</h2><BankRegister ctx={ctx} kinds={["deposit"]} /></div>
    </div>
  );
}
