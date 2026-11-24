"use client";
import { useState } from "react";
import type { PayrollComponent } from "@/db/schema";
import { AccountPicker, type PickerLabels } from "@/components/AccountPicker";

type Labels = Record<"code" | "name" | "kind" | "employee" | "employer" | "method" | "percent" | "brackets" | "rate" | "base" | "gross" | "remaining" | "liability" | "expense" | "add" | "delete", string>;

/** Edits the ordered list of payroll taxes and contributions; posts it as JSON. */
export function RulesEditor({ initial, accounts, labels, disabled, picker, canAdd }: {
  initial: PayrollComponent[]; accounts: { code: string; name: string; type: string }[]; labels: Labels; disabled?: boolean; picker: PickerLabels; canAdd: boolean;
}) {
  const blank: PayrollComponent = { code: "", name: "", kind: "employee", method: "percent", rate: 0, brackets: "", base: "gross", liabilityAccount: "", expenseAccount: "" };
  const [rows, setRows] = useState<PayrollComponent[]>(initial);
  const set = <K extends keyof PayrollComponent>(i: number, k: K, v: PayrollComponent[K]) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const accPick = (id: string, value: string, types: string[], on: (v: string) => void, label: string) => (
    <AccountPicker id={id} accounts={accounts.filter((a) => types.includes(a.type)).map((a) => ({ ...a, id: a.code }))} onlyTypes={types} by="code" value={value} onChange={on} disabled={disabled} canAdd={canAdd} labels={picker} placeholder={label ? "—" : undefined} />
  );
  return (
    <div className="tbl-wrap">
      <input type="hidden" name="components" value={JSON.stringify(rows)} />
      <table className="lines">
        <thead><tr><th>{labels.code}</th><th>{labels.name}</th><th>{labels.kind}</th><th>{labels.method}</th><th>{labels.rate}</th><th>{labels.base}</th><th>{labels.liability}</th><th>{labels.expense}</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><input id={`rc-${i}`} value={r.code} onChange={(e) => set(i, "code", e.target.value.toUpperCase())} style={{ width: 90 }} disabled={disabled} aria-label={labels.code} /></td>
              <td><input id={`rn-${i}`} value={r.name} onChange={(e) => set(i, "name", e.target.value)} style={{ minWidth: 160 }} disabled={disabled} aria-label={labels.name} /></td>
              <td><select id={`rk-${i}`} value={r.kind} onChange={(e) => set(i, "kind", e.target.value as PayrollComponent["kind"])} disabled={disabled} aria-label={labels.kind}>
                <option value="employee">{labels.employee}</option><option value="employer">{labels.employer}</option></select></td>
              <td><select id={`rm-${i}`} value={r.method} onChange={(e) => set(i, "method", e.target.value as PayrollComponent["method"])} disabled={disabled} aria-label={labels.method}>
                <option value="percent">{labels.percent}</option><option value="brackets">{labels.brackets}</option></select></td>
              <td>{r.method === "percent"
                ? <input id={`rr-${i}`} className="num" value={r.rate} onChange={(e) => set(i, "rate", Number(e.target.value) || 0)} style={{ width: 80 }} disabled={disabled} aria-label={labels.rate} />
                : <input id={`rb-${i}`} value={r.brackets} onChange={(e) => set(i, "brackets", e.target.value)} style={{ minWidth: 230 }} placeholder="60000:0, 100000:10, *:30" disabled={disabled} aria-label={labels.brackets} />}</td>
              <td><select id={`rs-${i}`} value={r.base} onChange={(e) => set(i, "base", e.target.value as PayrollComponent["base"])} disabled={disabled} aria-label={labels.base}>
                <option value="gross">{labels.gross}</option><option value="remaining">{labels.remaining}</option></select></td>
              <td>{accPick(`rl-${i}`, r.liabilityAccount, ["liability"], (v) => set(i, "liabilityAccount", v), labels.liability)}</td>
              <td>{r.kind === "employer"
                ? accPick(`re-${i}`, r.expenseAccount, ["expense"], (v) => set(i, "expenseAccount", v), labels.expense)
                : null}</td>
              <td>{disabled ? null : <button type="button" className="x" aria-label={labels.delete} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>×</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {disabled ? null : <button type="button" className="btn ghost" onClick={() => setRows((rs) => [...rs, { ...blank }])}>+ {labels.add}</button>}
    </div>
  );
}
