"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { quickAddAccount, type NewAccount } from "@/app/(app)/accounts/actions";
import { ACCOUNT_KINDS, KIND_SPEC, kindOf, kindsForTypes, nextCode, type AccountKind } from "@/lib/account-kinds";

export type PickAccount = { id: string; code: string; name: string; type: string; subtype?: string | null; note?: string };
export type PickerLabels = {
  kinds: Record<string, string>; add: string; title: string; kind: string; code: string; codeHelp: string; name: string;
  save: string; cancel: string; choose: string; errors: Record<string, string>;
};

const NEW = "__new__";
const EVENT = "tagpilot:account-added";

/**
 * Every account list in the books: each account shows its type (Bank, Accounts receivable, Fixed asset, Cost of
 * sales...), and "+ Add new account" opens a small form that creates one without leaving the page. A new account
 * appears in every list on the page, and is chosen in the one it was added from.
 */
export function AccountPicker({ accounts, name, id, value, defaultValue, onChange, required, disabled, placeholder, canAdd, onlyTypes, kinds: onlyKinds, by = "id", labels, style, className, form }: {
  accounts: PickAccount[]; name?: string; id: string; value?: string; defaultValue?: string; onChange?: (v: string) => void;
  required?: boolean; disabled?: boolean; placeholder?: string; canAdd: boolean; onlyTypes?: readonly string[]; /** The account types this list may create, when it holds only some (a bank list: Bank). */ kinds?: readonly AccountKind[]; /** What the field sends: the account id, or its code where the setting keeps codes. */ by?: "id" | "code"; labels: PickerLabels;
  style?: React.CSSProperties; className?: string; form?: string;
}) {
  const [added, setAdded] = useState<PickAccount[]>([]);
  const [own, setOwn] = useState(value ?? defaultValue ?? "");
  const current = value ?? own;
  const [open, setOpen] = useState(false);
  const types = useMemo(() => onlyTypes ?? [...new Set([...accounts.map((a) => a.type), ...(accounts.length ? [] : ["asset", "liability", "equity", "income", "expense"])])], [onlyTypes, accounts]);
  const kinds = onlyKinds ?? kindsForTypes(types);
  const list = useMemo(() => {
    const all = [...accounts, ...added.filter((a) => !accounts.some((b) => b.id === a.id) && kinds.includes(kindOf(a)))];
    return all.map((a) => ({ ...a, kind: kindOf(a) })).sort((x, y) => ACCOUNT_KINDS.indexOf(x.kind) - ACCOUNT_KINDS.indexOf(y.kind) || x.code.localeCompare(y.code, undefined, { numeric: true }));
  }, [accounts, added, kinds]);

  // An account added from another list on this page shows here too.
  useEffect(() => {
    const on = (e: Event) => { const a = (e as CustomEvent<PickAccount>).detail; setAdded((xs) => (xs.some((x) => x.id === a.id) ? xs : [...xs, a])); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  const choose = (v: string) => {
    if (v === NEW) { setOpen(true); return; }
    setOwn(v);
    onChange?.(v);
  };
  const groups = ACCOUNT_KINDS.filter((k) => list.some((a) => a.kind === k));
  return (
    <>
      <select id={id} name={name} value={current} onChange={(e) => choose(e.target.value)} required={required} disabled={disabled} style={style} className={className} form={form}>
        <option value="">{placeholder ?? "—"}</option>
        {canAdd && !disabled ? <option value={NEW}>{labels.add}</option> : null}
        {current && current !== NEW && !list.some((a) => a[by] === current) ? <option value={current}>{current}</option> : null}
        {groups.map((k) => (
          <optgroup key={k} label={labels.kinds[k]}>
            {list.filter((a) => a.kind === k).map((a) => (
              <option key={a.id} value={a[by]}>{a.code} · {a.name} — {labels.kinds[k]}{a.note ? ` (${a.note})` : ""}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {open ? (
        <NewAccountDialog
          kinds={kinds.length ? kinds : [...ACCOUNT_KINDS]} used={list.map((a) => a.code)} labels={labels}
          onClose={() => setOpen(false)}
          onAdded={(a) => {
            const pick: PickAccount = { id: a.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype };
            setAdded((xs) => [...xs, pick]);
            window.dispatchEvent(new CustomEvent(EVENT, { detail: pick }));
            setOpen(false);
            setOwn(a[by]);
            onChange?.(a[by]);
          }}
        />
      ) : null}
    </>
  );
}

function NewAccountDialog({ kinds, used, labels, onClose, onAdded }: {
  kinds: readonly AccountKind[]; used: string[]; labels: PickerLabels; onClose: () => void; onAdded: (a: NewAccount) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [kind, setKind] = useState<AccountKind>(kinds.includes("expense") ? "expense" : kinds[0]);
  const [code, setCode] = useState(() => nextCode(kinds.includes("expense") ? "expense" : kinds[0], used));
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const save = async () => {
    if (!name.trim()) { setError(labels.errors.err_acc_name); return; }
    setBusy(true); setError("");
    const r = await quickAddAccount({ kind, code, name }).catch(() => ({ ok: false as const, error: "err_generic" }));
    setBusy(false);
    if (r.ok) onAdded(r.account); else setError(labels.errors[r.error] ?? labels.errors.err_generic);
  };
  // A dialog, not a form: it sits inside the page's own form, which must not be submitted by it.
  return (
    <dialog ref={ref} className="acc-dialog" onClose={onClose} onCancel={onClose} aria-labelledby={`${uid}-t`}>
      <div className="stack" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}>
        <h2 id={`${uid}-t`}>{labels.title}</h2>
        <label className="f">{labels.kind}
          <select id={`${uid}-k`} value={kind} onChange={(e) => { const k = e.target.value as AccountKind; setKind(k); setCode(nextCode(k, used)); }}>
            {kinds.map((k) => <option key={k} value={k}>{labels.kinds[k]}</option>)}
          </select>
        </label>
        <label className="f">{labels.name}<input id={`${uid}-n`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus /></label>
        <label className="f">{labels.code}<input id={`${uid}-c`} value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} />
          <span className="small muted">{labels.codeHelp.replace("{from}", String(KIND_SPEC[kind].from)).replace("{to}", String(KIND_SPEC[kind].to))}</span></label>
        {error ? <div className="note bad small" role="alert">{error}</div> : null}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>{labels.save}</button>
          <button type="button" className="btn ghost" onClick={() => { ref.current?.close(); onClose(); }}>{labels.cancel}</button>
        </div>
      </div>
    </dialog>
  );
}
