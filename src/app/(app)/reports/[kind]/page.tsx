import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { balances, listAccounts } from "@/lib/ledger";
import { daysBetween, isIsoDate, round2, today } from "@/lib/format";
import { Empty, PageHead, Tabs } from "@/components/ui";

export const metadata = { title: "Reports" };

const KINDS = { tb: "r_tb", pl: "r_pl", bs: "r_bs", vat: "r_vat", proj: "r_proj", gl: "r_gl", ar: "r_ar", ap: "r_ap" } as const satisfies Record<string, Key>;
type Kind = keyof typeof KINDS;

export default async function ReportPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: SearchParams }) {
  const { kind: k } = await params;
  if (!(k in KINDS)) notFound();
  const kind = k as Kind;
  const ctx = await requireView("reports");
  const { t, accName, money } = await getI18n();
  const q = await sp(searchParams);
  const from = isIsoDate(q("from")) ? q("from") : `${today().slice(0, 4)}-01-01`;
  const to = isIsoDate(q("to")) ? q("to") : today();
  const db = await getDb();
  const accounts = await listAccounts(db, ctx.company.id);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const qs = `from=${from}&to=${to}`;

  const accCell = (id: string) => { const a = byId.get(id); return a ? <><code className="k">{a.code}</code> {accName(a)}</> : id; };
  const section = (title: string, rows: [string, number][], totalLabel?: string) => {
    const sum = round2(rows.reduce((s, [, v]) => s + v, 0));
    return {
      sum,
      el: <>
        <tr className="sub"><td colSpan={2}>{title}</td></tr>
        {rows.map(([id, v]) => <tr key={id}><td>{accCell(id)}</td><td className="num">{money(v)}</td></tr>)}
        <tr><td><b>{totalLabel ?? `${t("total")} ${title.toLowerCase()}`}</b></td><td className="num"><b>{money(sum)}</b></td></tr>
      </>,
    };
  };
  const ofType = (m: Awaited<ReturnType<typeof balances>>, type: string, sign: 1 | -1) =>
    accounts.filter((a) => a.type === type).map((a) => [a.id, round2((m.get(a.id)?.net ?? 0) * sign)] as [string, number]).filter(([, v]) => v !== 0);

  let body: React.ReactNode = null;
  let periodLabel = `${from} → ${to}`;

  if (kind === "tb") {
    const m = await balances(db, ctx.company.id, { from, to });
    let td = 0, tc = 0;
    const rows = accounts.filter((a) => m.get(a.id)?.net).map((a) => {
      const n = m.get(a.id)!.net; const d = n > 0 ? n : 0, c = n < 0 ? -n : 0; td += d; tc += c;
      return <tr key={a.id}><td><code className="k">{a.code}</code></td><td><Link className="rowlink" href={`/reports/gl?${qs}&account=${a.id}`}>{accName(a)}</Link></td><td className="num">{d ? money(d) : ""}</td><td className="num">{c ? money(c) : ""}</td></tr>;
    });
    body = rows.length ? <table><thead><tr><th>{t("code")}</th><th>{t("account")}</th><th className="num">{t("debit")}</th><th className="num">{t("credit")}</th></tr></thead>
      <tbody>{rows}<tr className="total"><td colSpan={2}>{t("total")}</td><td className="num">{money(td)}</td><td className="num">{money(tc)}</td></tr></tbody></table> : null;
  } else if (kind === "pl") {
    const m = await balances(db, ctx.company.id, { from, to });
    const inc = section(t("income"), ofType(m, "income", -1)), exp = section(t("expenses"), ofType(m, "expense", 1));
    body = <table><tbody>{inc.el}{exp.el}<tr className="total"><td>{t("net_result")}</td><td className="num">{money(inc.sum - exp.sum)}</td></tr></tbody></table>;
  } else if (kind === "bs") {
    periodLabel = `${t("as_at")} ${to}`;
    const m = await balances(db, ctx.company.id, { to });
    const a = section(t("assets"), ofType(m, "asset", 1)), l = section(t("liabilities"), ofType(m, "liability", -1)), e = section(t("equity"), ofType(m, "equity", -1));
    const result = round2(accounts.filter((x) => x.type === "income" || x.type === "expense").reduce((s, x) => s - (m.get(x.id)?.net ?? 0), 0));
    body = <table><tbody>
      {a.el}
      <tr><td colSpan={2} style={{ border: 0, height: 12 }} /></tr>
      {l.el}{e.el}<tr><td>{t("current_result")}</td><td className="num">{money(result)}</td></tr>
      <tr className="total"><td>{t("total_le")}</td><td className="num">{money(l.sum + e.sum + result)}</td></tr>
    </tbody></table>;
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
  } else if (kind === "proj") {
    const rows = await db.select({
      projectId: schema.journalLines.projectId, type: schema.accounts.type,
      net: sql<string>`sum(${schema.journalLines.debit} - ${schema.journalLines.credit})`,
    }).from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
      .where(and(eq(schema.journalLines.companyId, ctx.company.id), eq(schema.journalEntries.status, "posted"),
        gte(schema.journalEntries.date, from), lte(schema.journalEntries.date, to), inArray(schema.accounts.type, ["income", "expense"])))
      .groupBy(schema.journalLines.projectId, schema.accounts.type);
    const projects = await db.select().from(schema.projects).where(eq(schema.projects.companyId, ctx.company.id)).orderBy(schema.projects.code);
    const keys = [...projects.map((p) => p.id), null];
    const list = keys.map((id) => {
      const inc = -Number(rows.find((r) => r.projectId === id && r.type === "income")?.net ?? 0);
      const exp = Number(rows.find((r) => r.projectId === id && r.type === "expense")?.net ?? 0);
      return { id, label: id ? projects.find((p) => p.id === id)!.code + " · " + projects.find((p) => p.id === id)!.name : "—", inc, exp };
    }).filter((r) => r.inc || r.exp);
    body = list.length ? <table><thead><tr><th>{t("project")}</th><th className="num">{t("income")}</th><th className="num">{t("expenses")}</th><th className="num">{t("balance")}</th></tr></thead>
      <tbody>{list.map((r) => <tr key={r.id ?? "none"}><td>{r.id ? <Link className="rowlink" href={`/budgets?year=${to.slice(0, 4)}&project=${r.id}`}>{r.label}</Link> : r.label}</td><td className="num">{money(r.inc)}</td><td className="num">{money(r.exp)}</td><td className="num">{money(r.inc - r.exp)}</td></tr>)}</tbody></table> : null;
  } else if (kind === "gl") {
    const accountId = q("account");
    const acc = byId.get(accountId);
    const picker = (
      <form className="row" method="get">
        <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
        <select id="account" name="account" defaultValue={accountId} style={{ width: "auto", minWidth: 260 }} aria-label={t("account")}>
          <option value="">{t("choose_account")}</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
        </select>
        <button type="submit" className="btn sm">{t("show")}</button>
      </form>
    );
    if (!acc) body = picker;
    else {
      const [open] = await db.select({ net: sql<string>`coalesce(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)` })
        .from(schema.journalLines).innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
        .where(and(eq(schema.journalLines.accountId, acc.id), eq(schema.journalEntries.status, "posted"), lt(schema.journalEntries.date, from)));
      const lines = await db.select({ l: schema.journalLines, e: schema.journalEntries }).from(schema.journalLines)
        .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
        .where(and(eq(schema.journalLines.accountId, acc.id), eq(schema.journalEntries.status, "posted"), gte(schema.journalEntries.date, from), lte(schema.journalEntries.date, to)))
        .orderBy(asc(schema.journalEntries.date), asc(schema.journalEntries.number));
      let run = Number(open.net);
      body = <>{picker}<table>
        <thead><tr><th>{t("date")}</th><th>{t("number")}</th><th>{t("memo")}</th><th className="num">{t("debit")}</th><th className="num">{t("credit")}</th><th className="num">{t("balance")}</th></tr></thead>
        <tbody>
          <tr className="sub"><td colSpan={5}>{t("opening")}</td><td className="num">{money(run)}</td></tr>
          {lines.map(({ l, e }) => { run = round2(run + l.debit - l.credit); return (
            <tr key={l.id}><td className="num" style={{ textAlign: "left" }}>{e.date}</td><td><Link href={`/journal/${e.id}`}>{e.number}</Link></td><td>{e.memo}{l.description && l.description !== e.memo ? <div className="small muted">{l.description}</div> : null}</td>
              <td className="num">{l.debit ? money(l.debit) : ""}</td><td className="num">{l.credit ? money(l.credit) : ""}</td><td className="num">{money(run)}</td></tr>); })}
          <tr className="total"><td colSpan={5}>{t("closing")}</td><td className="num">{money(run)}</td></tr>
        </tbody></table></>;
    }
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
      <PageHead title={t("r_title")} />
      <Tabs current={kind} items={(Object.keys(KINDS) as Kind[]).map((key) => ({ key, href: `/reports/${key}?${qs}`, label: t(KINDS[key]) }))} />
      <form className="row noprint" method="get">
        {q("account") ? <input type="hidden" name="account" value={q("account")} /> : null}
        <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{t("from")}<input type="date" id="from" name="from" defaultValue={from} style={{ width: "auto" }} /></label>
        <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{t("to")}<input type="date" id="to" name="to" defaultValue={to} style={{ width: "auto" }} /></label>
        <button type="submit" className="btn sm">{t("show")}</button>
      </form>
      <div className="panel stack">
        <h2>{t(KINDS[kind])} <span className="small muted">· {ctx.company.name} · {periodLabel} · {ctx.company.currency}</span></h2>
        <div className="tbl-wrap">{body ?? <Empty>{t("no_posted")}</Empty>}</div>
      </div>
    </div>
  );
}
