"use client";
import { useCallback, useState } from "react";
import { PdfPages } from "@/components/PdfPages";
import { SignaturePad } from "@/components/SignaturePad";

type Field = { id: string; type: "signature" | "initials" | "date" | "name" | "text" | "checkbox"; page: number; x: number; y: number; w: number; h: number; required: boolean; label: string };
export type SignLabels = Record<"start" | "next" | "done_fields" | "adopt" | "initials" | "initials_help" | "consent" | "finish" | "loading" | "sign_here" | "fill" | "pending", string>
  & { pad: { help: string; clear: string; upload: string; redraw: string; remember: string; required: string } };

/**
 * Signing in the browser: the document with this signer's fields marked, a "Next" button that walks from field to
 * field, one signature drawn once for every signature field, initials, and the agreement to sign electronically.
 */
export function SignView({ token, fileUrl, pages, fields, name, today, labels, action }: {
  token: string; fileUrl: string; pages: { w: number; h: number }[]; fields: Field[]; name: string; today: string;
  labels: SignLabels; action: (fd: FormData) => void | Promise<void>;
}) {
  const [sig, setSig] = useState("");
  const [initials, setInitials] = useState(() => name.split(/\s+/).filter(Boolean).map((p) => p[0]!.toUpperCase()).join("").slice(0, 4));
  const [values, setValues] = useState<Record<string, string>>({});
  const onSig = useCallback((v: string) => setSig(v), []);
  const filled = (f: Field) => f.type === "signature" ? !!sig : f.type === "initials" ? !!initials.trim() : f.type === "text" ? !!(values[f.id] ?? "").trim() || !f.required : f.type === "checkbox" ? values[f.id] === "1" || !f.required : true;
  const order = [...fields].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const left = order.filter((f) => !filled(f));
  const go = () => {
    const f = left[0];
    if (!f) { document.getElementById("sign-finish")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    if (f.type === "signature") { document.getElementById("sign-pad")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const el = document.getElementById(`sf-${f.id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el?.querySelector("input") as HTMLInputElement | null)?.focus();
  };
  return (
    <form action={action} className="sign-layout">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="values" value={JSON.stringify(values)} />
      <input type="hidden" name="initials" value={initials} />
      <div className="sign-bar">
        <span className="small">{left.length ? labels.pending.replace("{n}", String(left.length)) : labels.done_fields}</span>
        <button type="button" className="btn sm primary" onClick={go}>{left.length === order.length ? labels.start : labels.next}</button>
      </div>
      <PdfPages url={fileUrl} pages={pages} loadingLabel={labels.loading}
        overlay={(page) => fields.filter((f) => f.page === page).map((f) => (
          <div key={f.id} id={`sf-${f.id}`} className={`sign-field ${f.type}${filled(f) ? " ok" : ""}`}
            style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}>
            {f.type === "signature" ? (sig ? <img src={sig} alt="" /> : <button type="button" onClick={() => document.getElementById("sign-pad")?.scrollIntoView({ behavior: "smooth", block: "center" })}>{labels.sign_here}</button>)
              : f.type === "initials" ? <span className="sign-initials">{initials}</span>
              : f.type === "date" ? <span>{today}</span>
              : f.type === "name" ? <span>{name}</span>
              : f.type === "checkbox" ? <input type="checkbox" checked={values[f.id] === "1"} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.checked ? "1" : "" }))} aria-label={f.label || labels.fill} />
              : <input value={values[f.id] ?? ""} placeholder={f.label || labels.fill} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} maxLength={300} aria-label={f.label || labels.fill} />}
          </div>
        ))} />
      <div className="panel stack sign-finish">
        <div id="sign-pad" className="stack">
          <b>{labels.adopt}</b>
          <SignaturePad labels={labels.pad} onChange={onSig} noRemember />
        </div>
        {fields.some((f) => f.type === "initials") ? (
          <label className="f" style={{ maxWidth: 200 }}>{labels.initials}<input id="sign-initials" value={initials} onChange={(e) => setInitials(e.target.value.slice(0, 12))} required />
            <span className="small muted">{labels.initials_help}</span></label>
        ) : null}
        <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="consent" value="1" required style={{ width: "auto", marginTop: 3 }} /><span className="small">{labels.consent}</span></label>
        <div><button id="sign-finish" type="submit" className="btn primary" disabled={left.length > 0}>{labels.finish}</button></div>
      </div>
    </form>
  );
}
