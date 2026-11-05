import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { balances, moneyAccounts } from "@/lib/ledger";
import { today } from "@/lib/format";
import { foreignBalances } from "@/lib/banking";
import { CURRENCIES } from "@/lib/template";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { addForeignAccount, saveForeignExchange, saveForeignMove, saveRevaluation } from "../actions";
import { BankRegister } from "../BankForms";

export const metadata = { title: "Foreign currency" };

export default async function ForeignPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("banking");
  const { t, err, money, accName } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [money_, bal, foreign, all, projects, partners] = await Promise.all([
    moneyAccounts(db, ctx.company.id), balances(db, ctx.company.id), foreignBalances(db, ctx.company.id),
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), eq(schema.accounts.isActive, true))).orderBy(schema.accounts.code),
    db.select().from(schema.projects).where(and(eq(schema.projects.companyId, ctx.company.id), eq(schema.projects.isActive, true))).orderBy(schema.projects.code),
    db.select().from(schema.partners).where(eq(schema.partners.companyId, ctx.company.id)).orderBy(schema.partners.name),
  ]);
  const fx = money_.filter((a) => a.currency);
  const home = ctx.company.currency;
  const canWrite = ctx.can("banking", "write");
  const counters = all.filter((a) => !a.currency && a.subtype !== "ar" && a.subtype !== "ap" && !["bank", "cash", "momo"].includes(a.subtype ?? ""));
  const anyMoney = money_.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)} ({a.currency ?? home})</option>);
  return (
    <div className="stack">
      <PageHead title={t("nav_foreign")} />
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      <div className="note info small">{t("bk_fx_help").replace("{home}", home)}</div>

      <div className="panel stack">
        <h2>{t("bk_fx_accounts")}</h2>
        {fx.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("account")}</th><th>{t("currency")}</th><th className="num">{t("bk_fx_balance")}</th><th className="num">{t("bk_fx_carrying")} ({home})</th><th className="num">{t("bk_fx_book_rate")}</th></tr></thead>
            <tbody>{fx.map((a) => {
              const f = foreign.get(a.id) ?? 0, c = bal.get(a.id)?.net ?? 0;
              return <tr key={a.id}><td>{a.code} · {accName(a)}</td><td>{a.currency}</td><td className="num">{money(f, 2)}</td><td className="num">{money(c, 2)}</td><td className="num">{f ? (c / f).toFixed(4) : ""}</td></tr>;
            })}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
        {canWrite ? (
          <form action={addForeignAccount} className="stack">
            <h3>{t("bk_fx_new_account")}</h3>
            <div className="fields">
              <label className="f">{t("code")}<input id="n-code" name="code" required placeholder="1120" /></label>
              <label className="f">{t("name_en")}<input id="n-name" name="name" required /></label>
              <label className="f">{t("currency")}
                <select id="n-currency" name="currency" required defaultValue="">
                  <option value="" disabled>{t("none")}</option>
                  {CURRENCIES.filter((c) => c !== home).map((c) => <option key={c} value={c}>{c}</option>)}
                </select></label>
            </div>
            <div><button type="submit" className="btn">{t("add")}</button></div>
          </form>
        ) : null}
      </div>

      {canWrite && fx.length ? (
        <>
          <form action={saveForeignMove} className="panel stack">
            <h2>{t("bk_fx_move")}</h2>
            <div className="fields">
              <label className="f">{t("account")}<select id="f-account" name="accountId" required>{fx.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)} ({a.currency})</option>)}</select></label>
              <label className="f">{t("bk_fx_direction")}
                <select id="f-direction" name="direction" required defaultValue="in"><option value="in">{t("money_in")}</option><option value="out">{t("money_out")}</option></select></label>
              <label className="f">{t("date")}<input id="f-date" name="date" type="date" required defaultValue={today()} /></label>
              <label className="f">{t("bk_fx_foreign_amount")}<input id="f-foreign" name="foreign" className="num" inputMode="decimal" required /></label>
              <label className="f">{t("bk_fx_rate")} ({home})<input id="f-rate" name="rate" className="num" inputMode="decimal" required /></label>
              <label className="f">{t("bank_counter")}
                <select id="f-counter" name="counterId" required defaultValue="">
                  <option value="" disabled>{t("none")}</option>
                  {counters.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
                </select></label>
              <label className="f">{t("project")}
                <select id="f-project" name="projectId" defaultValue=""><option value="">{t("none")}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
              <label className="f">{t("partner")}
                <select id="f-partner" name="partnerId" defaultValue=""><option value="">{t("none")}</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="f">{t("reference")}<input id="f-reference" name="reference" /></label>
            </div>
            <label className="f">{t("memo")}<input id="f-memo" name="memo" /></label>
            <div><button type="submit" className="btn primary">{t("save")}</button></div>
          </form>

          <form action={saveForeignExchange} className="panel stack">
            <h2>{t("bk_fx_exchange")}</h2>
            <div className="small muted">{t("bk_fx_exchange_help")}</div>
            <div className="fields">
              <label className="f">{t("bk_from_bank")}<select id="x-from" name="fromId" required>{anyMoney}</select></label>
              <label className="f">{t("bk_fx_sent")}<input id="x-sent" name="sent" className="num" inputMode="decimal" required /></label>
              <label className="f">{t("bk_to_bank")}<select id="x-to" name="toId" required>{anyMoney}</select></label>
              <label className="f">{t("bk_fx_received")}<input id="x-received" name="received" className="num" inputMode="decimal" required /></label>
              <label className="f">{t("date")}<input id="x-date" name="date" type="date" required defaultValue={today()} /></label>
              <label className="f">{t("bk_fx_rate_both")} ({home})<input id="x-rate" name="rate" className="num" inputMode="decimal" /></label>
              <label className="f">{t("reference")}<input id="x-reference" name="reference" /></label>
            </div>
            <div><button type="submit" className="btn primary">{t("save")}</button></div>
          </form>

          <form action={saveRevaluation} className="panel stack">
            <h2>{t("bk_fx_revalue")}</h2>
            <div className="small muted">{t("bk_fx_revalue_help")}</div>
            <div className="fields">
              <label className="f">{t("date")}<input id="v-date" name="date" type="date" required defaultValue={today()} /></label>
              {fx.map((a) => <label key={a.id} className="f">{a.code} · {a.currency} ({home})<input id={`rate-${a.id}`} name={`rate_${a.id}`} className="num" inputMode="decimal" /></label>)}
            </div>
            <div><button type="submit" className="btn primary">{t("bk_fx_revalue")}</button></div>
          </form>
        </>
      ) : null}

      <div className="panel stack"><h2>{t("bk_fx_transactions")}</h2><BankRegister ctx={ctx} kinds={["fx_in", "fx_out", "fx_exchange", "fx_revaluation"]} /></div>
    </div>
  );
}
