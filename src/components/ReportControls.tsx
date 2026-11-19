"use client";
import { useRef, useState } from "react";
import { RANGE_GROUPS, rangeDates, type Range } from "@/lib/report-dates";

type Labels = {
  dates: string; from: string; to: string; asAt: string; show: string; customize: string; columns: string; title: string; titleHelp: string;
  ranges: Record<string, string>; groups: string[];
};

/**
 * The bar on top of a report, as in QuickBooks: a Dates list (Today, This fiscal quarter-to-date, Last year...) that
 * fills in the dates, the dates themselves, and Customize to choose the columns shown and a title of one's own.
 */
export function ReportControls({ range, from, to, asAt, today, fiscalStart, account, columns, hide, title, labels }: {
  range: Range; from: string; to: string; asAt: boolean; today: string; fiscalStart: number; account: string;
  columns: string[]; hide: number[]; title: string; labels: Labels;
}) {
  const [r, setR] = useState<Range>(range);
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [hidden, setHidden] = useState(new Set(hide));
  const form = useRef<HTMLFormElement>(null);
  const pick = (v: Range) => {
    setR(v);
    const d = rangeDates(v, today, fiscalStart);
    if (d) { setF(d.from); setT(d.to); }
  };
  const toggle = (i: number) => setHidden((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <form ref={form} className="report-controls noprint" method="get">
      {account ? <input type="hidden" name="account" value={account} /> : null}
      <input type="hidden" name="hide" value={[...hidden].sort((a, b) => a - b).join(",")} />
      <label className="f">{labels.dates}
        <select id="range" name="range" value={r} onChange={(e) => pick(e.target.value as Range)}>
          {RANGE_GROUPS.map((g, gi) => (
            <optgroup key={gi} label={labels.groups[gi]}>
              {g.map((x) => <option key={x} value={x}>{labels.ranges[x]}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {asAt ? <input type="hidden" name="from" value={f} /> : (
        <label className="f">{labels.from}<input type="date" id="from" name="from" value={f} onChange={(e) => { setF(e.target.value); setR("custom"); }} /></label>
      )}
      <label className="f">{asAt ? labels.asAt : labels.to}<input type="date" id="to" name="to" value={t} onChange={(e) => { setT(e.target.value); setR("custom"); }} /></label>
      <button type="submit" className="btn sm primary">{labels.show}</button>
      <details className="report-customize">
        <summary className="btn sm">{labels.customize}</summary>
        <div className="report-customize-panel stack">
          <label className="f">{labels.title}<input id="r-title" name="title" defaultValue={title} placeholder={labels.titleHelp} maxLength={120} /></label>
          {columns.length > 1 ? (
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">{labels.columns}</legend>
              {columns.map((c, i) => (
                <label key={i} className="check">
                  <input type="checkbox" checked={i === 0 || !hidden.has(i)} disabled={i === 0} onChange={() => toggle(i)} /> {c || "—"}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div><button type="submit" className="btn sm primary">{labels.show}</button></div>
        </div>
      </details>
    </form>
  );
}
