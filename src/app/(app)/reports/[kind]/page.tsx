import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { balances, listAccounts } from "@/lib/ledger";
import { natural } from "@/lib/financial-reports";
import { isCustomerKind, isVendorKind } from "@/lib/vendor-reports";
import { isReportKind, REPORT_TITLES, reportArea } from "@/lib/reports";
import { RANGE_GROUPS, RANGES } from "@/lib/report-dates";
import { companyToday, fiscalStart, loadReport, queryString, readQuery } from "@/lib/report-view";
import { taxLineKey, taxLineOf, taxLinesFor } from "@/lib/tax-lines";
import { emailReport, saveTaxLines } from "../actions";
import { PrintButton } from "@/components/PrintButton";
import { ReportControls } from "@/components/ReportControls";
import { ReportTable } from "@/components/ReportTable";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { AccountField } from "@/components/AccountField";

export const metadata = { title: "Reports" };

/**
 * One report, as in QuickBooks Desktop: a Dates list (Today, This fiscal quarter-to-date, Last year...), Customize
 * for the columns and the title, every line opening its transaction, and the report printed, saved as PDF or Excel,
 * or emailed.
 */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: SearchParams }) {
  const { kind } = await params;
  if (!isReportKind(kind)) notFound();
  const ctx = await requireView(reportArea(kind));
  const { t, err, accName, money } = await getI18n();
  const q = await sp(searchParams);
  const query = readQuery(ctx, q);
  const { from, to } = query;
  const qs = queryString(query);
  const { full, report, title, asAt } = await loadReport(ctx, kind, query);
  const db = await getDb();

  let body: React.ReactNode;
  let picker: React.ReactNode = null;
  if (kind === "gl" || kind === "txn-account") {
    const accounts = await listAccounts(db, ctx.company.id);
    picker = (
      <form className="row noprint" method="get" style={{ marginBottom: 12 }}>
        <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
        {query.hide.length ? <input type="hidden" name="hide" value={query.hide.join(",")} /> : null}
        {query.title ? <input type="hidden" name="title" value={query.title} /> : null}
        <AccountField id="account" name="account" accounts={accounts} defaultValue={query.account} placeholder={t("r_all_accounts")} style={{ width: "auto", minWidth: 260 }} noAdd />
        <button type="submit" className="btn sm">{t("show")}</button>
      </form>
    );
  }
  if (kind === "tax-prep" && ctx.can("accounts", "write")) {
    const accounts = await listAccounts(db, ctx.company.id);
    const m = await balances(db, ctx.company.id, { from, to });
    const list = accounts.filter((a) => a.type === "income" || a.type === "expense");
    body = (
      <form action={saveTaxLines} className="stack">
        <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
        <table>
          <thead><tr><th>{t("account")}</th><th>{t("r_tax_line")}</th><th className="num">{t("amount")}</th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id}>
              <td><Link className="rowlink" href={`/reports/gl?from=${from}&to=${to}&account=${a.id}`}>{a.code} {accName(a)}</Link></td>
              <td><select id={`tax_${a.id}`} name={`tax_${a.id}`} defaultValue={taxLineOf(a)} aria-label={t("r_tax_line")} style={{ width: "auto", minWidth: 220 }}>
                {taxLinesFor(a.type).map((l) => <option key={l} value={l}>{t(taxLineKey(l))}</option>)}
              </select></td>
              <td className="num">{money(natural(a, m.get(a.id)?.net ?? 0))}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className="row noprint"><button type="submit" className="btn primary">{t("save")}</button></div>
      </form>
    );
  } else {
    body = report.rows.length ? <ReportTable report={report} money={money} /> : null;
  }

  const ranges = Object.fromEntries(RANGES.map((r) => [r, t(`rng_${r.replace(/-/g, "_")}` as Key)]));
  const back = `/reports/${kind}?${qs}`;
  return (
    <div className="stack">
      <PageHead title={title}>
        <div className="row noprint" style={{ flexWrap: "wrap" }}>
          {ctx.can("reports") ? <Link className="btn sm" href="/reports">{t("r_all_reports")}</Link> : ctx.can("purchases") && isVendorKind(kind) ? <Link className="btn sm" href="/purchases/reports">{t("nav_vendor_reports")}</Link> : ctx.can("sales") && isCustomerKind(kind) ? <Link className="btn sm" href="/sales/reports">{t("nav_customer_reports")}</Link> : null}
          <a className="btn sm" href={`/api/pdf/report/${kind}?${qs}`} target="_blank" rel="noreferrer">PDF</a>
          <a className="btn sm" href={`/api/export/report/${kind}?${qs}`}>Excel</a>
          <PrintButton label={t("r_print")} />
        </div>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {q("emailed") ? <div className="note ok small">{t("r_emailed_to")} {q("emailed")}</div> : null}
      <ReportControls
        range={query.range} from={from} to={to} asAt={asAt} today={companyToday(ctx)} fiscalStart={fiscalStart(ctx)} account={query.account}
        columns={full.columns.map((c) => c.label)} hide={query.hide} title={query.title}
        labels={{
          dates: t("r_dates"), from: t("from"), to: t("to"), asAt: t("as_at"), show: t("r_refresh"), customize: t("r_customize"), columns: t("r_columns"),
          title: t("r_custom_title"), titleHelp: t(REPORT_TITLES[kind]), ranges, groups: RANGE_GROUPS.map((_, i) => t(`rng_group_${i}` as Key)),
        }}
      />
      <div className="panel stack">
        <div className="report-head">
          <div className="report-company">{ctx.company.name}</div>
          <h2>{title}</h2>
          <div className="small muted">{report.period} · {ctx.company.currency}</div>
        </div>
        {picker}
        <div className="tbl-wrap">{body ?? <Empty>{t("no_posted")}</Empty>}</div>
        {report.note ? <p className="small muted">{report.note}</p> : null}
      </div>
      <details className="panel noprint">
        <summary><b>{t("r_email")}</b></summary>
        <form action={emailReport} className="stack" style={{ marginTop: 12 }}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="query" value={qs} />
          <input type="hidden" name="back" value={back} />
          <div className="fields">
            <label className="f">{t("email")}<input id="r-to" name="to" type="email" required multiple placeholder="name@example.com" /></label>
            <label className="f">{t("r_attach_as")}
              <select id="r-format" name="format" defaultValue="pdf">
                <option value="pdf">PDF</option><option value="xlsx">Excel</option><option value="both">PDF + Excel</option>
              </select>
            </label>
          </div>
          <label className="f">{t("pdf_message")}<textarea id="r-msg" name="message" rows={2} /></label>
          <div><button type="submit" className="btn primary">{t("r_send")}</button></div>
        </form>
      </details>
    </div>
  );
}
