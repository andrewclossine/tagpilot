"use client";
import { useRef, useState, useTransition } from "react";
import { quickAddPartner } from "@/app/(app)/partners/quick-add";

const NEW = "__new__";

type Labels = { add: string; name: string; tin: string; phone: string; email: string; save: string; cancel: string; title: string };

/** Choose a customer or supplier, or add a new one right here without leaving the form. */
export function PartnerPicker({ kind, options, defaultValue, canAdd, labels }: {
  kind: "customer" | "supplier"; options: { id: string; name: string; terms?: number }[]; defaultValue?: string; canAdd: boolean; labels: Labels;
}) {
  const [list, setList] = useState(options);
  const [value, setValue] = useState(defaultValue ?? "");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const fields = useRef<HTMLDivElement>(null);

  const read = (n: string) => fields.current?.querySelector<HTMLInputElement>(`[data-f="${n}"]`)?.value ?? "";
  const save = () => {
    setError("");
    start(async () => {
      const res = await quickAddPartner(kind, { name: read("name"), tin: read("tin"), phone: read("phone"), email: read("email") });
      if (!res.ok) { setError(res.error); return; }
      setList((l) => (l.some((p) => p.id === res.id) ? l : [...l, { id: res.id, name: res.name }].sort((a, b) => a.name.localeCompare(b.name))));
      setValue(res.id);
      setAdding(false);
    });
  };
  // Enter in these boxes must add the customer, not send the whole invoice.
  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") setAdding(false); };

  return (
    <>
      <select id="partnerId" name="partnerId" value={value} required
        onChange={(e) => {
          if (e.target.value === NEW) { setAdding(true); setError(""); return; }
          setValue(e.target.value);
          // The due date follows the customer's payment terms.
          const terms = list.find((p) => p.id === e.target.value)?.terms;
          const form = e.target.form, date = form?.querySelector<HTMLInputElement>('input[name="date"]')?.value, due = form?.querySelector<HTMLInputElement>('input[name="dueDate"]');
          if (terms && date && due) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + terms); due.value = d.toISOString().slice(0, 10); }
        }}>
        <option value="">—</option>
        {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        {canAdd ? <option value={NEW}>{labels.add}</option> : null}
      </select>
      {adding ? (
        <div ref={fields} className="panel stack quick-add" role="group" aria-label={labels.title}>
          <b className="small">{labels.title}</b>
          <div className="fields">
            <label className="f small">{labels.name}<input data-f="name" autoFocus onKeyDown={onKey} /></label>
            <label className="f small">{labels.tin}<input data-f="tin" onKeyDown={onKey} /></label>
            <label className="f small">{labels.phone}<input data-f="phone" onKeyDown={onKey} /></label>
            <label className="f small">{labels.email}<input data-f="email" type="email" onKeyDown={onKey} /></label>
          </div>
          {error ? <div className="note bad small">{error}</div> : null}
          <div className="row">
            <button type="button" className="btn sm primary" onClick={save} disabled={pending}>{labels.save}</button>
            <button type="button" className="btn sm ghost" onClick={() => setAdding(false)}>{labels.cancel}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
