"use client";
import { useState } from "react";

type Line = { id: string; date: string; reference: string; memo: string; amount: number };
type Labels = { date: string; reference: string; memo: string; moneyIn: string; moneyOut: string; opening: string; cleared: string; ending: string; difference: string; finish: string; all: string };

/** The tick list of a reconciliation: the difference must come to zero before it can be finished. */
export function ReconcileForm({ action, accountId, date, ending, opening, lines, labels, canWrite, lang }: {
  action: (fd: FormData) => void | Promise<void>; accountId: string; date: string; ending: number; opening: number; lines: Line[]; labels: Labels; canWrite: boolean; lang: string;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const fmt = (n: number) => n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cents = (n: number) => Math.round(n * 100);
  const cleared = lines.reduce((s, l) => s + (ticked.has(l.id) ? cents(l.amount) : 0), cents(opening));
  const diff = cents(ending) - cleared;
  const toggle = (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = lines.length > 0 && ticked.size === lines.length;
  return (
    <form action={action} className="stack">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="ending" value={ending} />
      <div className="kpis">
        <div className="panel kpi"><div className="label">{labels.opening}</div><div className="v">{fmt(opening)}</div></div>
        <div className="panel kpi"><div className="label">{labels.cleared}</div><div className="v">{fmt(cleared / 100)}</div></div>
        <div className="panel kpi"><div className="label">{labels.ending}</div><div className="v">{fmt(ending)}</div></div>
        <div className="panel kpi"><div className="label">{labels.difference}</div><div className="v" style={{ color: diff ? "var(--bad)" : "var(--ok)" }}>{fmt(diff / 100)}</div></div>
      </div>
      <div className="tbl-wrap"><table>
        <thead><tr>
          <th style={{ width: 32 }}><input type="checkbox" aria-label={labels.all} checked={allOn} onChange={() => setTicked(allOn ? new Set() : new Set(lines.map((l) => l.id)))} style={{ width: "auto" }} /></th>
          <th>{labels.date}</th><th>{labels.reference}</th><th>{labels.memo}</th><th className="num">{labels.moneyIn}</th><th className="num">{labels.moneyOut}</th>
        </tr></thead>
        <tbody>{lines.map((l) => (
          <tr key={l.id}>
            <td><input type="checkbox" name="line" value={l.id} aria-label={l.memo} checked={ticked.has(l.id)} onChange={() => toggle(l.id)} style={{ width: "auto" }} /></td>
            <td style={{ whiteSpace: "nowrap" }}>{l.date}</td><td>{l.reference}</td><td>{l.memo}</td>
            <td className="num">{l.amount > 0 ? fmt(l.amount) : ""}</td><td className="num">{l.amount < 0 ? fmt(-l.amount) : ""}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {canWrite ? <div><button type="submit" className="btn primary" disabled={diff !== 0}>{labels.finish}</button></div> : null}
    </form>
  );
}
