import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { today } from "@/lib/format";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { saveTransfer } from "../actions";
import { BankRegister, homeBanks } from "../BankForms";

export const metadata = { title: "Transfer funds" };

export default async function TransferPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("banking");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const banks = await homeBanks(ctx);
  const options = banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>);
  return (
    <div className="stack">
      <PageHead title={t("nav_transfer_funds")} />
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {ctx.can("banking", "write") ? (
        banks.length < 2 ? <div className="panel"><Empty>{t("bk_need_two")}</Empty></div> : (
          <form action={saveTransfer} className="panel stack">
            <div className="fields">
              <label className="f">{t("bk_from_bank")}<select id="t-from" name="fromId" required defaultValue={banks[0].id}>{options}</select></label>
              <label className="f">{t("bk_to_bank")}<select id="t-to" name="toId" required defaultValue={banks[1].id}>{options}</select></label>
              <label className="f">{t("date")}<input id="t-date" name="date" type="date" required defaultValue={today()} /></label>
              <label className="f">{t("amount")} ({ctx.company.currency})<input id="t-amount" name="amount" className="num" inputMode="decimal" required /></label>
              <label className="f">{t("reference")}<input id="t-reference" name="reference" /></label>
            </div>
            <label className="f">{t("memo")}<input id="t-memo" name="memo" /></label>
            <div><button type="submit" className="btn primary">{t("nav_transfer_funds")}</button></div>
          </form>
        )
      ) : null}
      <div className="panel stack"><h2>{t("bk_transfers_made")}</h2><BankRegister ctx={ctx} kinds={["transfer"]} /></div>
    </div>
  );
}
