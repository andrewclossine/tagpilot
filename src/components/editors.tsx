"use client";
import { useMemo, useState } from "react";

export type AccountOpt = { id: string; code: string; name: string; type: string };
export type ProjectOpt = { id: string; code: string; name: string };

const TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
const num = (v: string | number) => { const n = Number(String(v).replace(/[\s,]/g, "")); return Number.isFinite(n) ? n : 0; };
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function AccountSelect({ accounts, value, onChange, typeLabels, id, disabled, only }: {
  accounts: AccountOpt[]; value: string; onChange: (v: string) => void; typeLabels: Record<string, string>;
  id: string; disabled?: boolean; only?: readonly string[];
}) {
  const known = accounts.some((a) => a.id === value);
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">—</option>
      {value && !known ? <option value={value}>?</option> : null}
      {TYPES.filter((ty) => !only || only.includes(ty)).map((ty) => {
        const opts = accounts.filter((a) => a.type === ty);
        return opts.length ? (
          <optgroup key={ty} label={typeLabels[ty]}>
            {opts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

function ProjectSelect({ projects, value, onChange, id, disabled, noneLabel }: {
  projects: ProjectOpt[]; value: string; onChange: (v: string) => void; id: string; disabled?: boolean; noneLabel: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{noneLabel}</option>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
    </select>
  );
}

// ---------- journal lines ----------
export type JLine = { accountId: string; debit: string; credit: string; description: string; projectId: string };

export function JournalLinesEditor({ accounts, projects, initial, labels, readOnly }: {
  accounts: AccountOpt[]; projects: ProjectOpt[]; initial: JLine[]; readOnly?: boolean;
  labels: Record<"account" | "debit" | "credit" | "description" | "project" | "add_line" | "balanced" | "not_balanced" | "none" | "delete", string> & { types: Record<string, string> };
}) {
  const blank: JLine = { accountId: "", debit: "", credit: "", description: "", projectId: "" };
  const [lines, setLines] = useState<JLine[]>(initial.length ? initial : [blank, { ...blank }]);
  const set = (i: number, k: keyof JLine, v: string) => setLines((ls) => ls.map((l, j) => {
    if (j !== i) return l;
    const next = { ...l, [k]: v };
    if (k === "debit" && num(v)) next.credit = "";
    if (k === "credit" && num(v)) next.debit = "";
    return next;
  }));
  const d = lines.reduce((s, l) => s + num(l.debit), 0), c = lines.reduce((s, l) => s + num(l.credit), 0);
  const diff = Math.round((d - c) * 100) / 100;
  const payload = useMemo(() => JSON.stringify(lines.map((l) => ({
    accountId: l.accountId, debit: num(l.debit), credit: num(l.credit), description: l.description, projectId: l.projectId || null,
  }))), [lines]);
  return (
    <div className="tbl-wrap">
      <input type="hidden" name="lines" value={payload} />
      <table className="lines">
        <thead><tr><th>{labels.account}</th><th className="num">{labels.debit}</th><th className="num">{labels.credit}</th><th>{labels.description}</th><th>{labels.project}</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td><AccountSelect id={`acc-${i}`} accounts={accounts} value={l.accountId} onChange={(v) => set(i, "accountId", v)} typeLabels={labels.types} disabled={readOnly} /></td>
              <td><input id={`dr-${i}`} className="num" inputMode="decimal" value={l.debit} onChange={(e) => set(i, "debit", e.target.value)} disabled={readOnly} aria-label={labels.debit} /></td>
              <td><input id={`cr-${i}`} className="num" inputMode="decimal" value={l.credit} onChange={(e) => set(i, "credit", e.target.value)} disabled={readOnly} aria-label={labels.credit} /></td>
              <td><input id={`ds-${i}`} value={l.description} onChange={(e) => set(i, "description", e.target.value)} disabled={readOnly} aria-label={labels.description} /></td>
              <td><ProjectSelect id={`pj-${i}`} projects={projects} value={l.projectId} onChange={(v) => set(i, "projectId", v)} disabled={readOnly} noneLabel="—" /></td>
              <td>{readOnly ? null : <button type="button" className="x" aria-label={labels.delete} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>×</button>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{readOnly ? null : <button type="button" className="btn ghost" onClick={() => setLines((ls) => [...ls, { ...blank }])}>+ {labels.add_line}</button>}</td>
            <td className="num">{fmt(d)}</td><td className="num">{fmt(c)}</td>
            <td colSpan={3}>{diff === 0 && d > 0 ? <span className="balance-ok">✓ {labels.balanced}</span> : <span className="balance-bad">{labels.not_balanced} {fmt(Math.abs(diff))}</span>}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------- invoice & bill lines ----------
export type DLine = { description: string; quantity: string; unitPrice: string; vatApplies: boolean; accountId: string; projectId: string };

export function DocLinesEditor({ accounts, projects, initial, vatRate, labels, accountTypes, defaultAccountId, readOnly }: {
  accounts: AccountOpt[]; projects: ProjectOpt[]; initial: DLine[]; vatRate: number; readOnly?: boolean;
  accountTypes: readonly string[]; defaultAccountId: string;
  labels: Record<"description" | "qty" | "unit_price" | "vat" | "account" | "project" | "add_line" | "subtotal" | "total" | "delete", string> & { types: Record<string, string> };
}) {
  const blank = (): DLine => ({ description: "", quantity: "1", unitPrice: "", vatApplies: vatRate > 0, accountId: defaultAccountId, projectId: "" });
  const [lines, setLines] = useState<DLine[]>(initial.length ? initial : [blank()]);
  const set = <K extends keyof DLine>(i: number, k: K, v: DLine[K]) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const amounts = lines.map((l) => Math.round(num(l.quantity) * num(l.unitPrice) * 100) / 100);
  const subtotal = amounts.reduce((s, a) => s + a, 0);
  const vat = lines.reduce((s, l, i) => s + (l.vatApplies ? Math.round(amounts[i] * vatRate) / 100 : 0), 0);
  const payload = JSON.stringify(lines.map((l) => ({
    description: l.description, quantity: num(l.quantity), unitPrice: num(l.unitPrice), vatApplies: l.vatApplies, accountId: l.accountId, projectId: l.projectId || null,
  })));
  return (
    <div className="tbl-wrap">
      <input type="hidden" name="lines" value={payload} />
      <table className="lines">
        <thead><tr><th>{labels.description}</th><th className="num">{labels.qty}</th><th className="num">{labels.unit_price}</th><th>{labels.vat}</th><th>{labels.account}</th><th>{labels.project}</th><th className="num">{labels.total}</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td style={{ minWidth: 200 }}><input id={`d-${i}`} value={l.description} onChange={(e) => set(i, "description", e.target.value)} disabled={readOnly} aria-label={labels.description} /></td>
              <td><input id={`q-${i}`} className="num" style={{ minWidth: 70 }} inputMode="decimal" value={l.quantity} onChange={(e) => set(i, "quantity", e.target.value)} disabled={readOnly} aria-label={labels.qty} /></td>
              <td><input id={`p-${i}`} className="num" inputMode="decimal" value={l.unitPrice} onChange={(e) => set(i, "unitPrice", e.target.value)} disabled={readOnly} aria-label={labels.unit_price} /></td>
              <td style={{ textAlign: "center" }}><input id={`v-${i}`} type="checkbox" checked={l.vatApplies} onChange={(e) => set(i, "vatApplies", e.target.checked)} disabled={readOnly || vatRate === 0} aria-label={labels.vat} /></td>
              <td><AccountSelect id={`a-${i}`} accounts={accounts} only={accountTypes} value={l.accountId} onChange={(v) => set(i, "accountId", v)} typeLabels={labels.types} disabled={readOnly} /></td>
              <td><ProjectSelect id={`j-${i}`} projects={projects} value={l.projectId} onChange={(v) => set(i, "projectId", v)} disabled={readOnly} noneLabel="—" /></td>
              <td className="num">{fmt(amounts[i])}</td>
              <td>{readOnly ? null : <button type="button" className="x" aria-label={labels.delete} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>×</button>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={6}>{readOnly ? null : <button type="button" className="btn ghost" onClick={() => setLines((ls) => [...ls, blank()])}>+ {labels.add_line}</button>}</td><td /><td /></tr>
          <tr><td colSpan={6} className="num">{labels.subtotal}</td><td className="num">{fmt(subtotal)}</td><td /></tr>
          <tr><td colSpan={6} className="num">{labels.vat} {vatRate}%</td><td className="num">{fmt(vat)}</td><td /></tr>
          <tr className="total"><td colSpan={6} className="num">{labels.total}</td><td className="num">{fmt(subtotal + vat)}</td><td /></tr>
        </tfoot>
      </table>
    </div>
  );
}

/** A submit button that asks for a second click before it submits. */
export function ConfirmButton({ children, confirmLabel, className, formAction, name, value }: {
  children: React.ReactNode; confirmLabel: string; className?: string;
  formAction?: (fd: FormData) => void | Promise<void>; name?: string; value?: string;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="submit" className={className} formAction={formAction} name={name} value={value}
      onClick={(e) => { if (!armed) { e.preventDefault(); setArmed(true); } }}
      onBlur={() => setArmed(false)}>
      {armed ? confirmLabel : children}
    </button>
  );
}
