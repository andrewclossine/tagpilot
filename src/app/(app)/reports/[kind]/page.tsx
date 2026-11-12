import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { balances, listAccounts } from "@/lib/ledger";
import { daysBetween, isIsoDate, round2, today } from "@/lib/format";
import { AS_AT_KINDS, natural } from "@/lib/financial-reports";
import { isCustomerKind, isVendorKind } from "@/lib/vendor-reports";
import { buildReport, isReportKind, REPORT_TITLES, reportArea, type ReportKind } from "@/lib/reports";
import { taxLineKey, taxLineOf, taxLinesFor } from "@/lib/tax-lines";
import { saveTaxLines } from "../actions";
import { PrintButton } from "@/components/PrintButton";
import { ReportTable } from "@/components/ReportTable";
import { Empty, PageHead } from "@/components/ui";

export const metadata = { title: "Reports" };

const OTHER_KINDS = { vat: "r_vat", ar: "r_ar" } as const satisfies Record<string, Key>;
const KINDS: Record<string, Key> = { ...REPORT_TITLES, ...OTHER_KINDS };
type Kind = keyof typeof OTHER_KINDS | ReportKind;

export default async function ReportPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: SearchParams }) {
  const { kind: k } = await params;
  if (!(k in KINDS)) notFound();
  const kind = k as Kind;
  const ctx = await requireView(isReportKind(kind) ? reportArea(kind) : "reports");
  const { t, accName, money } = await getI18n();
  const q = await sp(searchParams);
  const from = isIsoDate(q("from")) ? q("from") : `${today().slice(0, 4)}-01-01`;
  const to = isIsoDate(q("to")) ? q("to") : today();
  const db = await getDb();
  const accounts = await listAccounts(db, ctx.company.id);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const qs = `from=${from}&to=${to}`;

  let body: React.ReactNode = null;
  let periodLabel = `${from} → ${to}`;
  let note: string | undefined;

  if (isReportKind(kind)) {
    const report = await buildReport(kind, { companyId: ctx.company.id, apAccount: ctx.company.settings.apAccount, arAccount: ctx.company.settings.arAccount, from, to, account: q("account"), t, accName });
    periodLabel = report.period;
    note = report.note;
    const picker = kind === "gl" || kind === "txn-account" ? (
      <form className="row noprint" method="get" style={{ marginBottom: 12 }}>
        <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
        <select id="account" name="account" defaultValue={q("account")} style={{ width: "auto", minWidth: 260 }} aria-label={t("account")}>
          <option value="">{t("r_all_accounts")}</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
        </select>
        <button type="submit" className="btn sm">{t("show")}</button>
      </form>
    ) : null;
    if (kind === "tax-prep" && ctx.can("accounts", "write")) {
      const m = await balances(db, ctx.company.id, { from, to });
      const list = accounts.filter((a) => a.type === "income" || a.type === "expense");
      body = (
        <form action={saveTaxLines} className="stack">
          <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
          <table>
            <thead><tr><th>{t("account")}</th><th>{t("r_tax_line")}</th><th className="num">{t("amount")}</th></tr></thead>
            <tbody>{list.map((a) => (
              <tr key={a.id}>
                <td><Link className="rowlink" href={`/reports/gl?${qs}&account=${a.id}`}>{a.code} {accName(a)}</Link></td>
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
      body = report.rows.length ? <>{picker}<ReportTable report={report} money={money} /></> : picker;
    }
  } else if (kind === "vat") {
    const m = await balances(db, ctx.company.id, { from, to });
    const s = ctx.company.settings;
    const vin = accounts.find((a) => a.code === s.vatIn), vout = accounts.find((a) => a.code === s.vatOut);
    const inV = vin ? m.get(vin.id)?.net ?? 0 : 0, outV = vout ? -(m.get(vout.id)?.net ?? 0) : 0, net = round2(outV - inV);
    body = <table><tbody>
      <tr><td>{t("vat_out")} · <code className="k">{s.vatOut}</code></td><td className="num">{money(outV)}</td></tr>
      <tr><td>{t("vat_in")} · <code className="k">{s.vatIn}</code></td><td className="num">{money(inV)}</td></tr>
      <tr className="total"><td>{net >= 0 ? t("vat_net") : t("vat_credit")}</td><td className="num">{money(Math.abs(net))}</td></tr>
    </tbody></table>;
  } else {
    // Ageing of unpaid invoices (ar) or bills (ap) as at the end date.
    periodLabel = `${t("as_at")} ${to}`;
    const doc = kind === "ar" ? schema.invoices : schema.bills;
    const rows = await db.select({ d: doc, partner: schema.partners.name }).from(doc).innerJoin(schema.partners, eq(schema.partners.id, doc.partnerId))
      .where(and(eq(doc.companyId, ctx.company.id), inArray(doc.status, ["open", "partial"]), lte(doc.date, to)));
    const buckets = ["aging_current", "aging_30", "aging_60", "aging_90", "aging_over"] as const;
    const bucketOf = (due: string) => { const d = daysBetween(due, to); return d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4; };
    const byPartner = new Map<string, number[]>();
    for (const { d, partner } of rows) {
      const arr = byPartner.get(partner) ?? [0, 0, 0, 0, 0];
      arr[bucketOf(d.dueDate)] += d.total - d.amountPaid;
      byPartner.set(partner, arr);
    }
    const totals = [0, 0, 0, 0, 0];
    body = byPartner.size ? <table>
      <thead><tr><th>{t(kind === "ar" ? "customer" : "supplier")}</th>{buckets.map((b) => <th key={b} className="num">{t(b)}</th>)}<th className="num">{t("total")}</th></tr></thead>
      <tbody>
        {[...byPartner].sort((a, b) => a[0].localeCompare(b[0])).map(([name, arr]) => { arr.forEach((v, i) => (totals[i] += v)); return (
          <tr key={name}><td>{name}</td>{arr.map((v, i) => <td key={i} className="num">{v ? money(v) : ""}</td>)}<td className="num"><b>{money(arr.reduce((s, v) => s + v, 0))}</b></td></tr>); })}
        <tr className="total"><td>{t("total")}</td>{totals.map((v, i) => <td key={i} className="num">{money(v)}</td>)}<td className="num">{money(totals.reduce((s, v) => s + v, 0))}</td></tr>
      </tbody></table> : null;
  }

  return (
    <div className="stack">
      <PageHead title={t(KINDS[kind])}>
        <div className="row noprint">
          {ctx.can("reports") ? <Link className="btn sm" href="/reports">{t("r_all_reports")}</Link> : ctx.can("purchases") && isVendorKind(kind) ? <Link className="btn sm" href="/purchases/reports">{t("nav_vendor_reports")}</Link> : ctx.can("sales") && isCustomerKind(kind) ? <Link className="btn sm" href="/sales/reports">{t("nav_customer_reports")}</Link> : null}
          {isReportKind(kind) ? <a className="btn sm" href={`/api/export/report/${kind}?${qs}${q("account") ? `&account=${q("account")}` : ""}`}>{t("r_download_excel")}</a> : null}
          <PrintButton label={t("r_print")} />
        </div>
      </PageHead>
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      <form className="row noprint" method="get">
        {q("account") ? <input type="hidden" name="account" value={q("account")} /> : null}
        {AS_AT_KINDS.includes(kind) ? <input type="hidden" name="from" value={from} /> : <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{t("from")}<input type="date" id="from" name="from" defaultValue={from} style={{ width: "auto" }} /></label>}
        <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{AS_AT_KINDS.includes(kind) ? t("as_at") : t("to")}<input type="date" id="to" name="to" defaultValue={to} style={{ width: "auto" }} /></label>
        <button type="submit" className="btn sm">{t("show")}</button>
      </form>
      <div className="panel stack">
        <h2>{t(KINDS[kind])} <span className="small muted">· {ctx.company.name} · {periodLabel} · {ctx.company.currency}</span></h2>
        <div className="tbl-wrap">{body ?? <Empty>{t("no_posted")}</Empty>}</div>
        {note ? <p className="small muted">{note}</p> : null}
      </div>
    </div>
  );
}
