import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { today } from "@/lib/format";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { BankRegister, homeBanks } from "../../banking/BankForms";
import { saveExpense } from "./actions";

export const metadata = { title: "Expenses" };

const ROWS = 4;

/** Expenses paid on the spot (cash, mobile money, card or bank) without a supplier's bill. */
export default async function ExpensesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("purchases");
  const { t, err, accName } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [banks, accounts, projects, suppliers] = await Promise.all([
    homeBanks(ctx),
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), eq(schema.accounts.isActive, true))).orderBy(schema.accounts.code),
    db.select().from(schema.projects).where(and(eq(schema.projects.companyId, ctx.company.id), eq(schema.projects.isActive, true))).orderBy(schema.projects.code),
    db.select().from(schema.partners).where(eq(schema.partners.companyId, ctx.company.id)).orderBy(schema.partners.name),
  ]);
  const usable = accounts.filter((a) => !a.currency && (a.type === "expense" || a.type === "asset") && !["bank", "cash", "momo", "ar", "ap"].includes(a.subtype ?? ""));
  const vat = ctx.company.vatRegistered;
  return (
    <div className="stack">
      <PageHead title={t("exp_title")} />
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {ctx.can("purchases", "write") ? (banks.length ? (
        <form action={saveExpense} className="panel stack">
          <h2>{t("exp_new")}</h2>
          <div className="fields">
            <label className="f">{t("paid_from")}
              <select id="e-account" name="accountId" required>{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
            <label className="f">{t("date")}<input id="e-date" name="date" type="date" required defaultValue={today()} /></label>
            <label className="f">{t("supplier")}
              <select id="e-partner" name="partnerId" defaultValue="">
                <option value="">{t("none")}</option>
                {suppliers.filter((p) => p.kind !== "customer").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            <label className="f">{t("exp_payee")}<input id="e-payee" name="payee" placeholder={t("exp_payee_help")} /></label>
            <label className="f">{t("reference")}<input id="e-reference" name="reference" placeholder={t("exp_reference_help")} /></label>
          </div>
          <div className="tbl-wrap"><table className="lines">
            <thead><tr><th>{t("account")}</th><th>{t("project")}</th><th>{t("description")}</th><th className="num">{t("amount")} ({ctx.company.currency})</th>{vat ? <th>{t("vat")}</th> : null}</tr></thead>
            <tbody>{Array.from({ length: ROWS }, (_, i) => (
              <tr key={i}>
                <td><select id={`e-acc-${i}`} name="lineAccount" aria-label={t("account")} defaultValue="">
                  <option value="">{t("none")}</option>
                  {usable.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
                </select></td>
                <td><select id={`e-prj-${i}`} name="lineProject" aria-label={t("project")} defaultValue="">
                  <option value="">{t("none")}</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
                </select></td>
                <td><input id={`e-desc-${i}`} name="lineDescription" aria-label={t("description")} /></td>
                <td><input id={`e-amt-${i}`} name="lineAmount" className="num" inputMode="decimal" aria-label={t("amount")} /></td>
                {vat ? <td><select id={`e-vat-${i}`} name="lineVat" aria-label={t("vat")} defaultValue="0"><option value="0">{t("no")}</option><option value="1">{ctx.company.vatRate}%</option></select></td> : <td hidden><input type="hidden" name="lineVat" value="0" /></td>}
              </tr>
            ))}</tbody>
          </table></div>
          <div className="fields">
            <label className="f">{t("memo")}<input id="e-memo" name="memo" /></label>
            <label className="f">{t("exp_receipt")}<input id="e-file" name="file" type="file" accept="image/*,application/pdf" /></label>
          </div>
          <div className="small muted">{t(vat ? "exp_help_vat" : "exp_help")}</div>
          <div><button type="submit" className="btn primary">{t("exp_save")}</button></div>
        </form>
      ) : <div className="panel"><Empty>{t("bank_no_accounts")}</Empty></div>) : null}
      <div className="panel stack"><h2>{t("exp_recent")}</h2><BankRegister ctx={ctx} kinds={["expense"]} /></div>
    </div>
  );
}
