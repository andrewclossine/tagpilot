"use client";
import { useRef, useState } from "react";
import { PdfPages } from "@/components/PdfPages";

type FieldType = "signature" | "initials" | "date" | "name" | "text" | "checkbox";
type Signer = { key: string; name: string; email: string; order: number };
type Field = { key: string; signer: string; type: FieldType; page: number; x: number; y: number; w: number; h: number; required: boolean; label: string };
export type PrepareLabels = Record<
  "title" | "signers" | "add_signer" | "name" | "email" | "email_help" | "order" | "ordered" | "ordered_help" | "message" | "message_help" | "fields" | "fields_help"
  | "placing" | "signer_for" | "required" | "delete" | "save" | "send" | "send_help" | "loading" | "remove" | "count" | "none_placed", string> & { types: Record<FieldType, string> };

const TYPES: FieldType[] = ["signature", "initials", "date", "name", "text", "checkbox"];
// Sizes as fractions of a portrait page: a signature is wide, a checkbox small.
const SIZE: Record<FieldType, [number, number]> = { signature: [0.24, 0.055], initials: [0.09, 0.04], date: [0.16, 0.03], name: [0.22, 0.03], text: [0.24, 0.03], checkbox: [0.028, 0.02] };
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
let seq = 0;
const key = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Preparing a document, as in DocuSign: the signers (in order, or any order), then each one's fields placed on the
 * pages by choosing a field and clicking where it goes. Fields can be moved, resized, given to another signer or
 * removed. The document is saved as a draft or sent.
 */
export function EsignPrepare({ id, fileUrl, pages, initial, colors, labels, action }: {
  id: string; fileUrl: string; pages: { w: number; h: number }[]; colors: string[]; labels: PrepareLabels;
  initial: { title: string; message: string; ordered: boolean; signers: Signer[]; fields: Field[] };
  action: (fd: FormData) => void | Promise<void>;
}) {
  const [title, setTitle] = useState(initial.title);
  const [message, setMessage] = useState(initial.message);
  const [ordered, setOrdered] = useState(initial.ordered);
  const [signers, setSigners] = useState<Signer[]>(initial.signers.length ? initial.signers : [{ key: key(), name: "", email: "", order: 1 }]);
  const [fields, setFields] = useState<Field[]>(initial.fields);
  const [active, setActive] = useState(signers[0]?.key ?? "");
  const [arming, setArming] = useState<FieldType | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<{ key: string; mode: "move" | "size"; sx: number; sy: number; f: Field; rect: DOMRect } | null>(null);

  const colorOf = (k: string) => colors[Math.max(0, signers.findIndex((s) => s.key === k)) % colors.length];
  const nameOf = (k: string) => { const s = signers.find((x) => x.key === k); return s?.name || s?.email || `#${signers.findIndex((x) => x.key === k) + 1}`; };
  const setSigner = (k: string, patch: Partial<Signer>) => setSigners((xs) => xs.map((s) => (s.key === k ? { ...s, ...patch } : s)));
  const addSigner = () => { const s = { key: key(), name: "", email: "", order: signers.length + 1 }; setSigners((xs) => [...xs, s]); setActive(s.key); };
  const removeSigner = (k: string) => {
    setSigners((xs) => xs.filter((s) => s.key !== k));
    setFields((fs) => fs.filter((f) => f.signer !== k));
    if (active === k) setActive(signers.find((s) => s.key !== k)?.key ?? "");
  };
  const place = (page: number, x: number, y: number) => {
    if (!arming || !active) { setSelected(null); return; }
    const [w, h] = SIZE[arming];
    const f: Field = { key: key(), signer: active, type: arming, page, x: clamp(x - w / 2, 0, 1 - w), y: clamp(y - h / 2, 0, 1 - h), w, h, required: arming !== "checkbox", label: "" };
    setFields((fs) => [...fs, f]);
    setSelected(f.key);
    setArming(null);
  };
  const patch = (k: string, p: Partial<Field>) => setFields((fs) => fs.map((f) => (f.key === k ? { ...f, ...p } : f)));

  const startDrag = (e: React.PointerEvent, f: Field, mode: "move" | "size") => {
    e.stopPropagation(); e.preventDefault();
    const rect = (e.currentTarget.closest(".pdf-page") as HTMLElement).getBoundingClientRect();
    drag.current = { key: f.key, mode, sx: e.clientX, sy: e.clientY, f, rect };
    setSelected(f.key);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.rect.width, dy = (e.clientY - d.sy) / d.rect.height;
    if (d.mode === "move") patch(d.key, { x: clamp(d.f.x + dx, 0, 1 - d.f.w), y: clamp(d.f.y + dy, 0, 1 - d.f.h) });
    else patch(d.key, { w: clamp(d.f.w + dx, 0.015, 1 - d.f.x), h: clamp(d.f.h + dy, 0.012, 1 - d.f.y) });
  };
  const endDrag = () => { drag.current = null; };

  const draft = JSON.stringify({ title, message, ordered, signers: signers.map((s, i) => ({ ...s, order: ordered ? s.order || i + 1 : 1 })), fields });
  const sel = fields.find((f) => f.key === selected);
  return (
    <form action={action} className="es-prepare">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="draft" value={draft} />
      <aside className="es-side stack">
        <label className="f">{labels.title}<input id="es-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></label>
        <div className="stack" style={{ gap: 8 }}>
          <b>{labels.signers}</b>
          {signers.map((s, i) => (
            <div key={s.key} className={`es-signer${active === s.key ? " on" : ""}`} style={{ borderLeftColor: colorOf(s.key) }} onClick={() => setActive(s.key)}>
              <div className="row" style={{ gap: 6 }}>
                {ordered ? <input aria-label={labels.order} className="num" style={{ width: 46 }} inputMode="numeric" value={s.order} onChange={(e) => setSigner(s.key, { order: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })} /> : null}
                <input id={`es-n-${i}`} placeholder={labels.name} value={s.name} onChange={(e) => setSigner(s.key, { name: e.target.value })} maxLength={120} />
                {signers.length > 1 ? <button type="button" className="x" aria-label={labels.remove} onClick={(e) => { e.stopPropagation(); removeSigner(s.key); }}>×</button> : null}
              </div>
              <input id={`es-e-${i}`} type="email" placeholder={labels.email} value={s.email} onChange={(e) => setSigner(s.key, { email: e.target.value })} maxLength={200} />
              <span className="small muted">{labels.count.replace("{n}", String(fields.filter((f) => f.signer === s.key).length))}</span>
            </div>
          ))}
          <button type="button" className="btn sm" onClick={addSigner}>{labels.add_signer}</button>
          <span className="small muted">{labels.email_help}</span>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={ordered} onChange={(e) => setOrdered(e.target.checked)} style={{ width: "auto" }} />{labels.ordered}</label>
          <span className="small muted">{labels.ordered_help}</span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b>{labels.fields}</b>
          <span className="small muted">{labels.signer_for} <b style={{ color: colorOf(active) }}>{nameOf(active)}</b></span>
          <div className="es-palette">
            {TYPES.map((t) => (
              <button key={t} type="button" className={`btn sm${arming === t ? " primary" : ""}`} onClick={() => setArming(arming === t ? null : t)} style={{ borderColor: colorOf(active) }}>{labels.types[t]}</button>
            ))}
          </div>
          <span className="small muted">{arming ? labels.placing.replace("{field}", labels.types[arming]) : labels.fields_help}</span>
        </div>
        {sel ? (
          <div className="es-selected stack" style={{ gap: 6, borderColor: colorOf(sel.signer) }}>
            <b>{labels.types[sel.type]} · {labels.signer_for}</b>
            <select value={sel.signer} onChange={(e) => patch(sel.key, { signer: e.target.value })} aria-label={labels.signer_for}>
              {signers.map((s) => <option key={s.key} value={s.key}>{nameOf(s.key)}</option>)}
            </select>
            {sel.type === "text" ? <input placeholder={labels.name} value={sel.label} onChange={(e) => patch(sel.key, { label: e.target.value })} maxLength={80} aria-label="label" /> : null}
            {sel.type === "text" || sel.type === "checkbox" ? (
              <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={sel.required} onChange={(e) => patch(sel.key, { required: e.target.checked })} style={{ width: "auto" }} />{labels.required}</label>
            ) : null}
            <button type="button" className="btn sm ghost danger" onClick={() => { setFields((fs) => fs.filter((f) => f.key !== sel.key)); setSelected(null); }}>{labels.delete}</button>
          </div>
        ) : null}
        <label className="f">{labels.message}<textarea id="es-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={labels.message_help} maxLength={2000} /></label>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="submit" name="intent" value="save" className="btn">{labels.save}</button>
          <button type="submit" name="intent" value="send" className="btn primary">{labels.send}</button>
        </div>
        <span className="small muted">{labels.send_help}</span>
      </aside>
      <div className={`es-doc${arming ? " arming" : ""}`} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {!fields.length ? <div className="note info small">{labels.none_placed}</div> : null}
        <PdfPages url={fileUrl} pages={pages} loadingLabel={labels.loading} onPageClick={place}
          overlay={(page) => fields.filter((f) => f.page === page).map((f) => (
            <div key={f.key} className={`es-field ${f.type}${selected === f.key ? " sel" : ""}`}
              style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, borderColor: colorOf(f.signer), background: `${colorOf(f.signer)}22` }}
              onPointerDown={(e) => startDrag(e, f, "move")} onClick={(e) => e.stopPropagation()}>
              <span className="es-field-label" style={{ color: colorOf(f.signer) }}>{f.type === "checkbox" ? "" : `${labels.types[f.type]}${f.required ? "" : " ?"}`}</span>
              <span className="es-field-size" onPointerDown={(e) => startDrag(e, f, "size")} />
            </div>
          ))} />
      </div>
    </form>
  );
}
