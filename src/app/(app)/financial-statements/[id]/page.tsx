import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import { fsFigures, fsTokens, loadDraft, NOTE_FOR_LINE, numberNotes, tOf, type FsLine, type LineFigures, type Pair } from "@/lib/fs";
import { addableTemplates, fillTokens } from "@/lib/fs-templates";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { addFsNote, deleteFsDraft, deleteFsNote, moveFsNote, saveFsNote, saveFsSettings } from "../actions";

export const metadata = { title: "Financial statements" };

/** Accounting style: negatives in brackets, nothing as a dash. */
const fmt = (n: number | null, lang: string) => {
  if (n === null) return "";
  const r = Math.round(n);
  if (!r) return "-";
  const s = Math.abs(r).toLocaleString(lang === "fr" ? "fr-FR" : "en-US");
  return r < 0 ? `(${s})` : s;
};

/**
 * One set of financial statements, as an audit package lays it out: cover, contents, reports, the four statements,
 * accounting policies, notes and the detailed income statement. The figures are read from the ledger each time.
 */
export default async function FsDraftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireView("reports");
  const { t: tu, err } = await getI18n();
  const q = await sp(searchParams);
  const draft = await loadDraft(ctx.company.id, id);
  if (!draft) notFound();
  const { d, notes } = draft;
  const lang = d.lang;
  const t = tOf(lang);
  const f = await fsFigures(ctx.company.id, d.periodFrom, d.periodTo, d.comparative, lang);
  const canEdit = ctx.can("journal", "write") && d.status !== "final";
  const canSettings = ctx.can("journal", "write");
  const { byId, byKey } = numberNotes(notes);
  const ref = (line: FsLine) => { const k = NOTE_FOR_LINE[line]; return k ? byKey.get(k) ?? "" : ""; };
  const tokens = fsTokens(d, ctx.company, f);
  const money = (n: number | null) => fmt(n, lang);
  const heads = [d.periodTo.slice(0, 4) === f.pTo.slice(0, 4) ? d.periodTo : d.periodTo.slice(0, 4), f.pTo.slice(0, 4) === d.periodTo.slice(0, 4) ? f.pTo : f.pTo.slice(0, 4)];
  const cols = d.comparative ? 2 : 1;

  // A statement line: label, note number, this period, last period.
  const Line = ({ label, note, v, strong, indent, neg }: { label: ReactNode; note?: string; v: Pair; strong?: boolean; indent?: boolean; neg?: boolean }) => {
    const s = neg ? -1 : 1;
    return (
      <tr className={strong ? "total" : undefined}>
        <td style={indent ? { paddingLeft: 22 } : undefined}>{label}</td>
        <td className="small muted" style={{ width: 50 }}>{note ? `${note}` : ""}</td>
        <td className="num">{money(v[0] * s)}</td>
        {cols === 2 ? <td className="num">{money(v[1] === null ? null : v[1] * s)}</td> : null}
      </tr>
    );
  };
  const Head = ({ children }: { children: ReactNode }) => <tr className="sub"><td colSpan={2 + cols}>{children}</td></tr>;
  const StmtTable = ({ children }: { children: ReactNode }) => (
    <div className="tbl-wrap"><table className="fs-table">
      <thead><tr><th /><th style={{ width: 50 }}>{t("fs_note")}</th><th className="num">{heads[0]}</th>{cols === 2 ? <th className="num">{heads[1]}</th> : null}</tr></thead>
      <tbody>{children}</tbody>
    </table></div>
  );
  const lineRows = (lines: FsLine[], neg = false) => lines.map((l) => f.lineOf(l)).filter((g): g is LineFigures => !!g && (!!g.v[0] || !!g.v[1]))
    .map((g) => <Line key={g.line} label={t(`fs_line_${g.line}` as never)} note={ref(g.line)} v={g.v} indent neg={neg} />);

  // The table under a note.
  const NoteFigures = ({ figures }: { figures: string | null }) => {
    if (!figures) return null;
    if (figures === "ppe") {
      if (!f.ppe.length) return null;
      return (
        <div className="tbl-wrap"><table className="fs-table">
          <thead><tr><th /><th className="num">{t("fs_cost")}</th><th className="num">{t("fs_accum_dep")}</th><th className="num">{t("fs_carrying")} {heads[0]}</th>{cols === 2 ? <th className="num">{t("fs_carrying")} {heads[1]}</th> : null}</tr></thead>
          <tbody>
            {f.ppe.map((p) => <tr key={p.name}><td>{p.name}</td><td className="num">{money(p.cost[0])}</td><td className="num">{money(p.accumulated[0])}</td><td className="num">{money(p.carrying[0])}</td>{cols === 2 ? <td className="num">{money(p.carrying[1])}</td> : null}</tr>)}
            <tr className="total"><td>{t("total")}</td>
              <td className="num">{money(f.ppe.reduce((s, p) => s + p.cost[0], 0))}</td><td className="num">{money(f.ppe.reduce((s, p) => s + p.accumulated[0], 0))}</td>
              <td className="num">{money(f.ppe.reduce((s, p) => s + p.carrying[0], 0))}</td>{cols === 2 ? <td className="num">{money(f.ppe.reduce((s, p) => s + (p.carrying[1] ?? 0), 0))}</td> : null}</tr>
          </tbody>
        </table></div>
      );
    }
    const rows = figures === "equity" ? [...f.equity, f.retained] : f.lineOf(figures as FsLine)?.accounts ?? [];
    if (!rows.length) return null;
    const total: Pair = figures === "equity" ? f.equityTotal : f.lineOf(figures as FsLine)!.v;
    return (
      <div className="tbl-wrap"><table className="fs-table">
        <thead><tr><th /><th className="num">{heads[0]}</th>{cols === 2 ? <th className="num">{heads[1]}</th> : null}</tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.id}><td>{r.name}</td><td className="num">{money(r.v[0])}</td>{cols === 2 ? <td className="num">{money(r.v[1])}</td> : null}</tr>)}
          <tr className="total"><td>{t("total")}</td><td className="num">{money(total[0])}</td>{cols === 2 ? <td className="num">{money(total[1])}</td> : null}</tr>
        </tbody>
      </table></div>
    );
  };

  // A report, policy or note: printed text, and for accountants the controls to change it.
  const NoteCard = ({ n }: { n: (typeof notes)[number] }) => (
    <section id={`note-${n.id}`} className="fs-note" style={{ opacity: n.included ? 1 : 0.5 }}>
      <h3>{byId.get(n.id) ? `${byId.get(n.id)} ` : ""}{n.title}{!n.included ? <span className="small muted"> · {tu("fs_not_printed")}</span> : null}</h3>
      {n.body ? <div className="fs-body">{fillTokens(n.body, tokens)}</div> : null}
      <NoteFigures figures={n.figures} />
      {canEdit ? (
        <div className="row fs-note-tools" style={{ gap: 6, flexWrap: "wrap" }}>
          <details className="fs-edit">
            <summary className="btn sm">{tu("edit")}</summary>
            <form action={saveFsNote} className="stack" style={{ marginTop: 8 }}>
              <input type="hidden" name="noteId" value={n.id} />
              <label className="f">{tu("fs_note_title")}<input id={`t-${n.id}`} name="title" defaultValue={n.title} required /></label>
              <label className="f">{tu("fs_note_text")}<textarea id={`b-${n.id}`} name="body" defaultValue={n.body} rows={Math.min(18, Math.max(4, Math.ceil(n.body.length / 90)))} /></label>
              <div className="small muted">{tu("fs_tokens_help")}</div>
              <label className="row small" style={{ gap: 8 }}><input type="checkbox" name="included" value="1" defaultChecked={n.included} style={{ width: "auto" }} /> {tu("fs_print_it")}</label>
              <div><button type="submit" className="btn primary sm">{tu("save")}</button></div>
            </form>
          </details>
          <form action={moveFsNote}><input type="hidden" name="noteId" value={n.id} /><input type="hidden" name="dir" value="up" /><button type="submit" className="btn sm ghost" aria-label={tu("fs_move_up")}>↑</button></form>
          <form action={moveFsNote}><input type="hidden" name="noteId" value={n.id} /><input type="hidden" name="dir" value="down" /><button type="submit" className="btn sm ghost" aria-label={tu("fs_move_down")}>↓</button></form>
          <form action={deleteFsNote}><input type="hidden" name="noteId" value={n.id} /><ConfirmButton className="btn sm ghost danger" confirmLabel={tu("confirm")}>{tu("delete")}</ConfirmButton></form>
        </div>
      ) : null}
    </section>
  );

  const reports = notes.filter((n) => n.kind === "report"), policies = notes.filter((n) => n.kind === "policy"), notesOnly = notes.filter((n) => n.kind === "note");
  const addable = addableTemplates(notes.map((n) => n.key));
  const AddNote = ({ kind }: { kind: "policy" | "note" }) => canEdit ? (
    <details className="panel fs-add">
      <summary className="btn sm">{tu(kind === "policy" ? "fs_add_policy" : "fs_add_note")}</summary>
      <form action={addFsNote} className="stack" style={{ marginTop: 10 }}>
        <input type="hidden" name="draftId" value={d.id} />
        <input type="hidden" name="kind" value={kind} />
        <label className="f">{tu("fs_template")}
          <select id={`tpl-${kind}`} name="template" defaultValue="">
            <option value="">{tu("fs_custom")}</option>
            {addable.filter((x) => x.kind === kind).map((x) => <option key={x.key} value={x.key}>{x.title[lang]}</option>)}
          </select></label>
        <label className="f">{tu("fs_note_title")}<input id={`at-${kind}`} name="title" placeholder={tu("fs_title_from_template")} /></label>
        <label className="f">{tu("fs_note_text")}<textarea id={`ab-${kind}`} name="body" rows={4} placeholder={tu("fs_text_from_template")} /></label>
        <div><button type="submit" className="btn primary sm">{tu("add")}</button></div>
      </form>
    </details>
  ) : null;

  const pl = f.pl;
  return (
    <div className="stack fs-doc">
      <PageHead title={d.title}>
        <Pill kind={d.status === "final" ? "final" : "draft"}>{tu(d.status === "final" ? "fs_final" : "fs_draft")}</Pill>
        <a className="btn" href={`/api/pdf/fs/${d.id}`} download>{tu("pdf_download")}</a>
        <Link className="btn ghost" href="/financial-statements">{tu("back")}</Link>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{tu("saved")}</div> : null}
      {!f.balanced ? <div className="note bad small">{tu("fs_not_balanced")}</div> : null}
      <div className="small muted">{tu("fs_live_help")}</div>

      {canSettings ? (
        <details className="panel" open={!d.approvedBy && d.status !== "final"}>
          <summary><b>{tu("fs_settings")}</b></summary>
          <form action={saveFsSettings} className="stack" style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={d.id} />
            <fieldset disabled={d.status === "final"} className="fields" style={{ border: 0, padding: 0, margin: 0 }}>
              <label className="f">{tu("fs_doc_title")}<input id="fs-title" name="title" defaultValue={d.title} /></label>
              <label className="f">{tu("fs_framework")}<select id="fs-fw" name="framework" defaultValue={d.framework}><option value="ifrs_sme">{tu("fs_fw_sme")}</option><option value="ifrs">{tu("fs_fw_ifrs")}</option></select></label>
              <label className="f">{tu("fs_approved_on")}<input id="fs-on" name="approvedOn" type="date" defaultValue={d.approvedOn ?? ""} /></label>
              <label className="f" style={{ gridColumn: "1 / -1" }}>{tu("fs_approved_by")}<textarea id="fs-by" name="approvedBy" rows={3} defaultValue={d.approvedBy} placeholder={tu("fs_approved_by_placeholder")} /></label>
            </fieldset>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {d.status === "final" ? <button type="submit" className="btn">{tu("fs_reopen")}</button> : <>
                <button type="submit" name="status" value="draft" className="btn primary">{tu("save")}</button>
                <ConfirmButton className="btn" name="status" value="final" confirmLabel={tu("confirm")}>{tu("fs_mark_final")}</ConfirmButton>
              </>}
            </div>
          </form>
          {d.status !== "final" ? (
            <form action={deleteFsDraft} style={{ marginTop: 10 }}><input type="hidden" name="id" value={d.id} /><ConfirmButton className="btn sm ghost danger" confirmLabel={tu("confirm")}>{tu("fs_delete")}</ConfirmButton></form>
          ) : null}
        </details>
      ) : null}

      <section className="panel fs-page fs-cover">
        <div className="fs-cover-name">{ctx.company.name}</div>
        <div className="fs-cover-title">{t("fs_cover_title").replace("{date}", d.periodTo)}</div>
        <div className="small muted">{t(d.framework === "ifrs" ? "fs_fw_ifrs" : "fs_fw_sme")} · {ctx.company.currency}</div>
        {ctx.company.registrationNo ? <div className="small muted">{t("co_reg")}: {ctx.company.registrationNo}</div> : null}
        {ctx.company.tin ? <div className="small muted">TIN: {ctx.company.tin}</div> : null}
      </section>

      <section className="panel fs-page">
        <h2>{t("fs_contents")}</h2>
        <ol className="fs-contents">
          {reports.filter((r) => r.included).map((r) => <li key={r.id}><a href={`#note-${r.id}`}>{r.title}</a></li>)}
          <li><a href="#sofp">{t("fs_sofp")}</a></li>
          <li><a href="#pl">{t("fs_pl")}</a></li>
          <li><a href="#soce">{t("fs_soce")}</a></li>
          <li><a href="#cf">{t("fs_cf")}</a></li>
          <li><a href="#policies">{t("fs_policies")}</a></li>
          <li><a href="#notes">{t("fs_notes")}</a></li>
          <li><a href="#detailed">{t("fs_detailed")}</a></li>
        </ol>
      </section>

      {reports.length ? <section className="panel fs-page stack">{reports.map((n) => <NoteCard key={n.id} n={n} />)}</section> : null}

      <section className="panel fs-page" id="sofp">
        <h2>{t("fs_sofp")}</h2>
        <div className="small muted">{t("fs_as_at").replace("{date}", d.periodTo)}</div>
        <StmtTable>
          <Head>{t("assets")}</Head>
          <Head>{t("r_non_current_assets")}</Head>
          {lineRows(["ppe", "investment_property", "biological", "other_non_current_assets"])}
          <Line label={t("r_total_non_current_assets")} v={f.nonCurrentAssets} strong />
          <Head>{t("r_current_assets")}</Head>
          {lineRows(["inventories", "receivables", "other_current_assets", "cash"])}
          <Line label={t("r_total_current_assets")} v={f.currentAssets} strong />
          <Line label={t("r_total_assets")} v={f.totalAssets} strong />
          <Head>{t("fs_equity_liabilities")}</Head>
          <Head>{t("equity")}</Head>
          {f.equity.map((r) => <Line key={r.id} label={r.name} note={byKey.get("n_equity")} v={r.v} indent />)}
          <Line label={f.retained.name} note={byKey.get("n_equity")} v={f.retained.v} indent />
          <Line label={t("r_total_equity")} v={f.equityTotal} strong />
          {f.nonCurrentLiabilities[0] || f.nonCurrentLiabilities[1] ? <><Head>{t("r_non_current_liabilities")}</Head>{lineRows(["loans", "deferred_income", "other_non_current_liabilities"])}<Line label={t("r_total_non_current_liabilities")} v={f.nonCurrentLiabilities} strong /></> : null}
          {f.currentLiabilities[0] || f.currentLiabilities[1] ? <><Head>{t("r_current_liabilities")}</Head>{lineRows(["payables", "tax_payable", "other_current_liabilities"])}<Line label={t("r_total_current_liabilities")} v={f.currentLiabilities} strong /></> : null}
          <Line label={t("r_total_liabilities")} v={f.totalLiabilities} strong />
          <Line label={t("total_le")} v={f.totalEquityLiabilities} strong />
        </StmtTable>
      </section>

      <section className="panel fs-page" id="pl">
        <h2>{t("fs_pl")}</h2>
        <div className="small muted">{t("fs_for_period").replace("{from}", d.periodFrom).replace("{to}", d.periodTo)}</div>
        <StmtTable>
          {lineRows(["revenue", "grants"])}
          {lineRows(["cost_of_sales"], true)}
          {pl.cost_of_sales.v[0] || pl.cost_of_sales.v[1] ? <Line label={t("r_gross_profit")} v={f.gross} strong /> : null}
          {lineRows(["other_income"])}
          {lineRows(["employee_costs", "depreciation", "other_expenses"], true)}
          <Line label={t("fs_operating_profit")} v={f.operating} strong />
          {lineRows(["finance_costs"], true)}
          <Line label={t("fs_before_tax")} v={f.beforeTax} strong />
          {lineRows(["income_tax"], true)}
          <Line label={t("fs_profit")} v={f.profit} strong />
        </StmtTable>
      </section>

      <section className="panel fs-page" id="soce">
        <h2>{t("fs_soce")}</h2>
        <div className="tbl-wrap"><table className="fs-table">
          <thead><tr><th />{f.soce.columns.map((c) => <th key={c} className="num">{c}</th>)}<th className="num">{t("total")}</th></tr></thead>
          <tbody>
            {f.soce.periods.map((p, i) => {
              const row = (key: string, label: string, v: number[], strong?: boolean) => (
                <tr key={key} className={strong ? "total" : undefined}><td>{label}</td>{v.map((x, k) => <td key={k} className="num">{money(x)}</td>)}<td className="num">{money(v.reduce((s, x) => s + x, 0))}</td></tr>
              );
              return [
                <tr key={`h${i}`} className="sub"><td colSpan={f.soce.columns.length + 2}>{t("fs_year_to").replace("{date}", p.label)}</td></tr>,
                row(`o${i}`, t("fs_balance_start"), p.opening, true),
                row(`r${i}`, t("fs_profit"), p.result),
                row(`m${i}`, t("fs_other_movements"), p.other),
                row(`c${i}`, t("fs_balance_end"), p.closing, true),
              ];
            })}
          </tbody>
        </table></div>
      </section>

      <section className="panel fs-page" id="cf">
        <h2>{t("fs_cf")}</h2>
        <div className="small muted">{t("fs_for_period").replace("{from}", d.periodFrom).replace("{to}", d.periodTo)}</div>
        <div className="tbl-wrap"><table className="fs-table">
          <thead><tr><th /><th className="num">{heads[0]}</th>{cols === 2 ? <th className="num">{heads[1]}</th> : null}</tr></thead>
          <tbody>
            {f.cf.map((r, i) => r.style === "head"
              ? <tr key={i} className="sub"><td colSpan={1 + cols}>{r.label}</td></tr>
              : <tr key={i} className={r.style === "sub" || r.style === "total" ? "total" : undefined}><td style={r.style === "line" ? { paddingLeft: 22 } : undefined}>{r.label}</td><td className="num">{money(r.v[0])}</td>{cols === 2 ? <td className="num">{money(r.v[1])}</td> : null}</tr>)}
          </tbody>
        </table></div>
      </section>

      <section className="panel fs-page stack" id="policies">
        <h2>1. {t("fs_policies")}</h2>
        {policies.map((n) => <NoteCard key={n.id} n={n} />)}
        <AddNote kind="policy" />
      </section>

      <section className="panel fs-page stack" id="notes">
        <h2>{t("fs_notes")}</h2>
        {notesOnly.map((n) => <NoteCard key={n.id} n={n} />)}
        <AddNote kind="note" />
      </section>

      <section className="panel fs-page" id="detailed">
        <h2>{t("fs_detailed")}</h2>
        <div className="small muted">{t("fs_detailed_help")}</div>
        <div className="tbl-wrap"><table className="fs-table">
          <thead><tr><th /><th className="num">{heads[0]}</th>{cols === 2 ? <th className="num">{heads[1]}</th> : null}</tr></thead>
          <tbody>
            {f.detailed.map((g) => [
              <tr key={`h-${g.line}`} className="sub"><td colSpan={1 + cols}>{t(`fs_line_${g.line}` as never)}</td></tr>,
              ...g.accounts.map((a) => <tr key={a.id}><td style={{ paddingLeft: 22 }}>{a.code} {a.name}</td><td className="num">{money(a.v[0])}</td>{cols === 2 ? <td className="num">{money(a.v[1])}</td> : null}</tr>),
              <tr key={`t-${g.line}`} className="total"><td>{t("total")}</td><td className="num">{money(g.v[0])}</td>{cols === 2 ? <td className="num">{money(g.v[1])}</td> : null}</tr>,
            ])}
            <tr className="total"><td>{t("fs_profit")}</td><td className="num">{money(f.profit[0])}</td>{cols === 2 ? <td className="num">{money(f.profit[1])}</td> : null}</tr>
          </tbody>
        </table></div>
      </section>
    </div>
  );
}

