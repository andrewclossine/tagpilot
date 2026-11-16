"use client";
import { useActionState, useMemo, useState } from "react";
import { saveBatchAction, type BatchState } from "./actions";

type Kind = "invoice" | "bill" | "bank";
type Row = { date: string; dueDate: string; direction: string; partner: string; reference: string; account: string; description: string; amount: string; vat: boolean; project: string };
type Col = keyof Row;

const blank = (): Row => ({ date: "", dueDate: "", direction: "out", partner: "", reference: "", account: "", description: "", amount: "", vat: false, project: "" });
const today = () => new Date().toISOString().slice(0, 10);

/** Columns in the order they are pasted from Excel, per kind of transaction. */
function columnsOf(kind: Kind, vat: boolean): Col[] {
  const tail: Col[] = vat ? ["amount", "vat", "project"] : ["amount", "project"];
  if (kind === "invoice") return ["date", "dueDate", "partner", "reference", "account", "description", ...tail];
  if (kind === "bill") return ["date", "dueDate", "partner", "reference", "account", "description", ...tail];
  return ["date", "direction", "partner", "reference", "account", "description", ...tail];
}

const num = (s: string) => { const v = Number(String(s).replace(/[^\d.-]/g, "")); return Number.isFinite(v) ? v : 0; };

export function BatchGrid({ kind, lang, vat, currency, accounts, partners, projects, banks, labels }: {
  kind: Kind; lang: string; vat: boolean; currency: string; accounts: string[]; partners: string[]; projects: string[];
  banks: { id: string; label: string }[];
  labels: { [k: string]: string | Record<string, string>; errors: Record<string, string> } & Record<"date" | "dueDate" | "direction" | "out" | "in" | "partner" | "reference" | "account" | "description" | "amount" | "vatCol" | "project" | "total" | "rows" | "addRows" | "clear" | "save" | "saving" | "post" | "draft" | "createPartners" | "bank" | "pasteHint" | "saved" | "fix" | "remove" | "postNow", string>;
}) {
  const cols = columnsOf(kind, vat);
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 10 }, (_, i) => ({ ...blank(), date: i === 0 ? today() : "" })));
  const [state, action, pending] = useActionState<BatchState, FormData>(saveBatchAction, { kind: null, saved: 0, errors: [] });
  // Once a batch is saved the grid starts again empty.
  const [clearedFor, setClearedFor] = useState<BatchState | null>(null);
  if (state.saved && clearedFor !== state) {
    setClearedFor(state);
    setRows(Array.from({ length: 10 }, (_, i) => ({ ...blank(), date: i === 0 ? today() : "" })));
  }
  const errorOf = new Map(state.errors.filter((e) => e.row >= 0).map((e) => [e.row, e.message]));
  const general = state.errors.filter((e) => e.row < 0);
  const total = useMemo(() => rows.reduce((s, r) => s + num(r.amount), 0), [rows]);
  const filled = rows.filter((r) => r.partner || r.account || r.amount || r.description).length;
  const fmt = (n: number) => n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const set = (i: number, c: Col, v: string | boolean) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [c]: v } : r)));
  // Pasting a block copied from Excel fills the grid from the cell pasted into, adding rows as needed.
  const paste = (i: number, c: Col) => (e: React.ClipboardEvent<HTMLElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n").filter((l, k, all) => l.trim() || k < all.length - 1);
    const start = cols.indexOf(c);
    setRows((rs) => {
      const out = [...rs];
      lines.forEach((line, k) => {
        const at = i + k;
        while (out.length <= at) out.push(blank());
        const cells = line.split("\t");
        const r = { ...out[at] };
        cells.forEach((cell, n) => {
          const col = cols[start + n];
          if (!col) return;
          const v = cell.trim();
          if (col === "vat") r.vat = /^(y|yes|1|true|x|oui|vat|tva)$/i.test(v);
          else if (col === "direction") r.direction = /^(in|deposit|received|receipt|entr|dépôt|depot|\+)/i.test(v) ? "in" : "out";
          else r[col] = v as never;
        });
        out[at] = r;
      });
      return out;
    });
  };

  const head: Record<Col, string> = {
    date: labels.date, dueDate: labels.dueDate, direction: labels.direction, partner: labels.partner, reference: labels.reference,
    account: labels.account, description: labels.description, amount: `${labels.amount} (${currency})`, vat: labels.vatCol, project: labels.project,
  };
  const width: Partial<Record<Col, number>> = { date: 128, dueDate: 128, direction: 112, partner: 190, reference: 120, account: 210, description: 220, amount: 130, vat: 52, project: 110 };

  return (
    <form action={action} className="stack">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <div className="panel row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        {kind === "bank" ? (
          <label className="f" style={{ minWidth: 240 }}>{labels.bank}
            <select id="b-bank" name="bankId" defaultValue={banks[0]?.id ?? ""} required>{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
        ) : (
          <>
            <label className="f" style={{ minWidth: 200 }}>{labels.post}
              <select id="b-post" name="post" defaultValue="1"><option value="1">{labels.postNow}</option><option value="0">{labels.draft}</option></select></label>
            <label className="row small" style={{ gap: 8 }}><input id="b-create" type="checkbox" name="createPartners" value="1" style={{ width: "auto" }} /> {labels.createPartners}</label>
          </>
        )}
        <span className="small muted" style={{ flex: 1, minWidth: 220 }}>{labels.pasteHint}</span>
      </div>

      {state.saved ? <div className="note ok">{labels.saved.replace("{n}", String(state.saved))}</div> : null}
      {state.errors.length ? <div className="note bad">{labels.fix.replace("{n}", String(errorOf.size || general.length))}{general.map((g) => <div key={g.message}>{labels.errors[g.message] ?? g.message}</div>)}</div> : null}

      <div className="panel tbl-wrap batch-grid">
        <table>
          <thead><tr><th style={{ width: 36 }}>#</th>{cols.map((c) => <th key={c} className={c === "amount" ? "num" : undefined} style={width[c] ? { width: width[c] } : undefined}>{head[c]}</th>)}<th style={{ width: 36 }} /></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const err = errorOf.get(i);
              return [
                <tr key={i} className={err ? "batch-bad" : undefined}>
                  <td className="small muted">{i + 1}</td>
                  {cols.map((c) => (
                    <td key={c} className={c === "amount" ? "num" : undefined}>
                      {c === "vat" ? (
                        <input type="checkbox" checked={r.vat} onChange={(e) => set(i, "vat", e.target.checked)} aria-label={`${head.vat} ${i + 1}`} style={{ width: "auto" }} />
                      ) : c === "direction" ? (
                        <select value={r.direction} onChange={(e) => set(i, "direction", e.target.value)} onPaste={paste(i, c)} aria-label={`${head.direction} ${i + 1}`}>
                          <option value="out">{labels.out}</option><option value="in">{labels.in}</option>
                        </select>
                      ) : (
                        <input value={r[c] as string} onChange={(e) => set(i, c, e.target.value)} onPaste={paste(i, c)} aria-label={`${head[c]} ${i + 1}`}
                          className={c === "amount" ? "num" : undefined} inputMode={c === "amount" ? "decimal" : undefined}
                          placeholder={c === "date" || c === "dueDate" ? "YYYY-MM-DD" : undefined}
                          list={c === "account" ? "batch-accounts" : c === "partner" ? "batch-partners" : c === "project" ? "batch-projects" : undefined} />
                      )}
                    </td>
                  ))}
                  <td><button type="button" className="btn ghost sm" aria-label={`${labels.remove} ${i + 1}`} onClick={() => setRows((rs) => rs.length > 1 ? rs.filter((_, j) => j !== i) : [blank()])}>×</button></td>
                </tr>,
                err ? <tr key={`e${i}`} className="batch-err"><td /><td colSpan={cols.length + 1} className="small">{labels.errors[err] ?? err}</td></tr> : null,
              ];
            })}
            <tr className="total"><td /><td colSpan={cols.indexOf("amount")}>{labels.rows}: {filled}</td><td className="num">{fmt(total)}</td><td colSpan={cols.length - cols.indexOf("amount")} /></tr>
          </tbody>
        </table>
      </div>
      <datalist id="batch-accounts">{accounts.map((a) => <option key={a} value={a} />)}</datalist>
      <datalist id="batch-partners">{partners.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="batch-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button type="submit" className="btn primary" disabled={pending || !filled}>{pending ? labels.saving : labels.save.replace("{n}", String(filled))}</button>
        <button type="button" className="btn" onClick={() => setRows((rs) => [...rs, ...Array.from({ length: 10 }, blank)])}>{labels.addRows}</button>
        <button type="button" className="btn ghost" onClick={() => setRows(Array.from({ length: 10 }, blank))}>{labels.clear}</button>
      </div>
    </form>
  );
}
