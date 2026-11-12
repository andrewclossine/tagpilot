import Link from "next/link";
import { getDb } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { yearChecklist } from "@/lib/closing";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { closeYear, saveClosingDate } from "./actions";

export const metadata = { title: "Close the books" };

/** The closing date, and the year-end: a checklist, the year's result, and closing the year. */
export default async function CloseBooksPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("journal");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const thisYear = new Date().getFullYear();
  const year = Number(q("year")) >= 2000 && Number(q("year")) <= thisYear ? Number(q("year")) : thisYear - 1;
  const db = await getDb();
  const c = await yearChecklist(db, ctx.company.id, year);
  const closed = ctx.company.settings.closedThrough ?? null;
  const yearClosed = !!closed && closed >= c.to;
  const admin = ctx.isAdmin && ctx.can("journal", "write");
  const check = (okay: boolean, label: string, href?: string) => (
    <li className="row small" style={{ gap: 8 }}>
      <span style={{ color: okay ? "var(--ok)" : "var(--warn, #b45309)", fontWeight: 700 }}>{okay ? "✓" : "!"}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {!okay && href ? <Link href={href}>{t("dash_open")} →</Link> : null}
    </li>
  );
  return (
    <div className="stack">
      <PageHead title={t("cb_title")} />
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {q("closed") ? <div className="note ok small">{t("cb_year_closed").replace("{year}", q("closed"))}</div> : null}

      <div className="grid2">
        <div className="panel stack">
          <h2>{t("cb_date_title")}</h2>
          <div>{closed ? <><Pill kind="posted">{t("cb_closed_through")} {closed}</Pill></> : <span className="muted">{t("cb_open")}</span>}</div>
          <div className="small muted">{t("cb_date_help")}</div>
          {admin ? (
            <form action={saveClosingDate} className="stack" style={{ gap: 8 }}>
              <div className="fields">
                <label className="f">{t("cb_close_through")}<input type="date" name="date" defaultValue={closed ?? ""} /></label>
                <label className="f">{t("cb_reason")}<input name="reason" placeholder={t("cb_reason_help")} /></label>
              </div>
              <div className="row">
                <button type="submit" name="do" value="set" className="btn primary">{t("cb_save_date")}</button>
                {closed ? <ConfirmButton className="btn ghost danger" name="do" value="clear" confirmLabel={t("confirm")}>{t("cb_clear")}</ConfirmButton> : null}
              </div>
            </form>
          ) : <div className="small muted">{t("cb_admin_only")}</div>}
        </div>

        <div className="panel stack">
          <div className="row">
            <h2 style={{ flex: 1 }}>{t("cb_year_title")}</h2>
            <form className="row" style={{ gap: 6 }}>
              <select name="year" defaultValue={String(year)} aria-label={t("year")} style={{ width: "auto" }}>
                {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button type="submit" className="btn sm">{t("show")}</button>
            </form>
          </div>
          <div className="kpis">
            <div className="panel kpi"><div className="label">{t("income")}</div><div className="v">{money(c.income)}</div></div>
            <div className="panel kpi"><div className="label">{t("cb_expenses")}</div><div className="v">{money(c.expenses)}</div></div>
            <div className="panel kpi"><div className="label">{t("cb_result")}</div><div className="v" style={{ color: c.result < 0 ? "var(--bad)" : undefined }}>{money(c.result)}</div></div>
          </div>
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 6 }}>
            {check(c.drafts === 0, t("cb_chk_drafts").replace("{n}", String(c.drafts)), "/journal?status=draft")}
            {check(c.draftInvoices === 0, t("cb_chk_invoices").replace("{n}", String(c.draftInvoices)), "/sales/invoices?status=draft")}
            {check(c.draftBills === 0, t("cb_chk_bills").replace("{n}", String(c.draftBills)), "/purchases/bills?status=draft")}
            {check(c.openBankLines === 0, t("cb_chk_bank").replace("{n}", String(c.openBankLines)), "/banking")}
            {check(c.balanced, t("cb_chk_balanced"))}
          </ul>
          <div className="small muted">{t("cb_year_help")}</div>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn sm" href={`/reports/pl?from=${c.from}&to=${c.to}`}>{t("cb_view_pl")}</Link>
            <Link className="btn sm" href={`/reports/bs?from=${c.from}&to=${c.to}`}>{t("cb_view_bs")}</Link>
            <Link className="btn sm" href={`/reports/tb?from=${c.from}&to=${c.to}`}>{t("cb_view_tb")}</Link>
          </div>
          {yearClosed ? <div className="note ok small">{t("cb_year_is_closed").replace("{year}", String(year))}</div> : admin ? (
            <form action={closeYear}>
              <input type="hidden" name="year" value={year} />
              <ConfirmButton className="btn primary" confirmLabel={t("cb_close_confirm").replace("{year}", String(year))}>{t("cb_close_year").replace("{year}", String(year))}</ConfirmButton>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
