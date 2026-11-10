"use client";
import { useState } from "react";

export type ItemLine = { description: string; unit: string; quantity: number | ""; unitCost?: number | "" };

/**
 * Lines of things to buy: description, unit and quantity, with an estimated unit cost when `withCost` is set.
 * Sent as parallel fields (line_desc, line_unit, line_qty, line_cost) that the server reads with getAll.
 */
export function ItemLines({ initial, withCost, labels, currency }: {
  initial: ItemLine[]; withCost?: boolean; currency?: string;
  labels: { description: string; unit: string; quantity: string; unitCost: string; amount: string; total: string; add: string; remove: string };
}) {
  const blank: ItemLine = { description: "", unit: "", quantity: "", unitCost: "" };
  const [rows, setRows] = useState<ItemLine[]>(initial.length ? initial : [blank]);
  const set = (i: number, k: keyof ItemLine, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: k === "description" || k === "unit" ? v : v === "" ? "" : Number(v) } : x)));
  const amount = (x: ItemLine) => (Number(x.quantity) || 0) * (Number(x.unitCost) || 0);
  const total = rows.reduce((s, x) => s + amount(x), 0);
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="tbl-wrap"><table className="lines">
        <thead><tr>
          <th style={{ width: 32 }}>#</th><th>{labels.description}</th><th style={{ width: 110 }}>{labels.unit}</th><th className="num" style={{ width: 110 }}>{labels.quantity}</th>
          {withCost ? <><th className="num" style={{ width: 140 }}>{labels.unitCost}{currency ? ` (${currency})` : ""}</th><th className="num" style={{ width: 140 }}>{labels.amount}</th></> : null}
          <th style={{ width: 40 }} />
        </tr></thead>
        <tbody>{rows.map((x, i) => (
          <tr key={i}>
            <td className="muted">{i + 1}</td>
            <td><input name="line_desc" value={x.description} onChange={(e) => set(i, "description", e.target.value)} aria-label={labels.description} /></td>
            <td><input name="line_unit" value={x.unit} onChange={(e) => set(i, "unit", e.target.value)} aria-label={labels.unit} /></td>
            <td><input name="line_qty" className="num" inputMode="decimal" value={x.quantity} onChange={(e) => set(i, "quantity", e.target.value)} aria-label={labels.quantity} /></td>
            {withCost ? <>
              <td><input name="line_cost" className="num" inputMode="decimal" value={x.unitCost ?? ""} onChange={(e) => set(i, "unitCost", e.target.value)} aria-label={labels.unitCost} /></td>
              <td className="num">{fmt(amount(x))}</td>
            </> : null}
            <td><button type="button" className="btn sm ghost" aria-label={labels.remove} title={labels.remove} disabled={rows.length === 1} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>×</button></td>
          </tr>
        ))}</tbody>
        {withCost ? <tfoot><tr><td colSpan={5} className="num"><b>{labels.total}</b></td><td className="num"><b>{fmt(total)}</b></td><td /></tr></tfoot> : null}
      </table></div>
      <div><button type="button" className="btn sm" onClick={() => setRows((r) => [...r, blank])}>+ {labels.add}</button></div>
    </div>
  );
}
