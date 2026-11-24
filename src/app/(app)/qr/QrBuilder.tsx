"use client";
import { useMemo, useState } from "react";
import type { QrStyle, QrType } from "@/db/schema";
import { DEFAULT_STYLE, QR_FIELDS, QR_TYPES, qrContent, qrSvg } from "@/lib/qr";

export type QrLabels = {
  types: Record<string, string>; fields: Record<string, string>; name: string; content: string; design: string; dynamic: string; dynamic_help: string; static_help: string;
  static_locked: string; colors: string; fg: string; bg: string; eye_color: string; dots: string; eyes: string; logo: string; logo_help: string; remove: string;
  frame: string; frame_text: string; frame_color: string; ecc: string; save: string; download_png: string; download_svg: string; preview: string; file: string; file_help: string;
  file_current: string; security: string; hidden: string; shapes: Record<string, string>; frames: Record<string, string>; empty: string;
};

/**
 * Making a QR code, as on QR Code Generator: choose what it opens (a website, a contact card, Wi-Fi, a PDF...), fill
 * in the details, style it (colours, dot and eye shapes, a logo, a frame with "Scan me"), watch the preview change,
 * and download it as PNG or SVG.
 */
export function QrBuilder({ action, initial, shortLink, labels, locked }: {
  action: (fd: FormData) => void | Promise<void>; shortLink: string | null; labels: QrLabels; locked?: boolean;
  initial: { id?: string; name: string; type: QrType; data: Record<string, string>; dynamic: boolean; style: QrStyle };
}) {
  const [type, setType] = useState<QrType>(initial.type);
  const [data, setData] = useState<Record<string, string>>(initial.data);
  const [dynamic, setDynamic] = useState(initial.dynamic);
  const [name, setName] = useState(initial.name);
  const [style, setStyle] = useState<QrStyle>({ ...DEFAULT_STYLE, ...initial.style });
  const set = (k: string, v: string) => setData((d) => ({ ...d, [k]: v }));
  const st = <K extends keyof QrStyle>(k: K, v: QrStyle[K]) => setStyle((s) => ({ ...s, [k]: v }));
  const isDynamic = type === "file" || dynamic;
  // A dynamic code holds its short link; a new one shows a stand-in until it is saved and given its own.
  const encoded = isDynamic ? shortLink ?? "https://tagpilotsolution.com/q/preview" : qrContent(type, data);
  const svg = useMemo(() => qrSvg(encoded || " ", style, 320), [encoded, style]);

  const download = (kind: "png" | "svg") => {
    const big = qrSvg(encoded || " ", style, 1200);
    const file = (name || "qr-code").replace(/[\\/:*?"<>|]+/g, "-");
    if (kind === "svg") { save(new Blob([big], { type: "image/svg+xml" }), `${file}.svg`); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || 1200; c.height = img.naturalHeight || 1200;
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => b && save(b, `${file}.png`), "image/png");
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(big)}`;
  };
  const onLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    // Shrunk to 256 pixels so the code stays light.
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 256 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      st("logo", c.toDataURL("image/png"));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  const field = (k: string) => {
    const label = labels.fields[k] ?? k;
    if (k === "security") return (
      <label key={k} className="f">{labels.security}<select name={`d_${k}`} value={data[k] || "WPA"} onChange={(e) => set(k, e.target.value)} disabled={locked}><option value="WPA">WPA/WPA2</option><option value="WEP">WEP</option><option value="nopass">—</option></select></label>);
    if (k === "hidden") return (
      <label key={k} className="row small" style={{ gap: 6 }}><input type="checkbox" checked={data[k] === "1"} onChange={(e) => set(k, e.target.checked ? "1" : "")} style={{ width: "auto" }} disabled={locked} />{labels.hidden}<input type="hidden" name={`d_${k}`} value={data[k] ?? ""} /></label>);
    const long = k === "text" || k === "body" || k === "message" || k === "address";
    return (
      <label key={k} className="f">{label}
        {long ? <textarea name={`d_${k}`} rows={3} value={data[k] ?? ""} onChange={(e) => set(k, e.target.value)} maxLength={1000} disabled={locked} />
          : <input name={`d_${k}`} value={data[k] ?? ""} onChange={(e) => set(k, e.target.value)} maxLength={300} disabled={locked}
            type={k === "email" ? "email" : k === "url" || k === "website" ? "text" : "text"} inputMode={k === "lat" || k === "lng" ? "decimal" : k === "phone" || k === "mobile" ? "tel" : undefined} />}
      </label>
    );
  };
  return (
    <form action={action} className="qr-builder">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="style" value={JSON.stringify(style)} />
      <input type="hidden" name="dynamic" value={isDynamic ? "1" : ""} />
      {locked ? Object.entries(data).map(([k, v]) => <input key={k} type="hidden" name={`d_${k}`} value={v} />) : null}
      <div className="stack">
        <div className="qr-types">
          {QR_TYPES.map((t) => <button key={t} type="button" disabled={locked && t !== type} className={`qr-type${t === type ? " on" : ""}`} onClick={() => setType(t)}>{labels.types[t]}</button>)}
        </div>
        <div className="panel stack">
          <label className="f">{labels.name}<input name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></label>
          <b>{labels.content}</b>
          {locked ? <div className="note info small">{labels.static_locked}</div> : null}
          {type === "file" ? (
            <label className="f">{labels.file}<input name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required={!data.fileName} />
              <span className="small muted">{data.fileName ? `${labels.file_current}: ${data.fileName}` : labels.file_help}</span></label>
          ) : <div className="fields">{QR_FIELDS[type].map(field)}</div>}
          {type === "file" ? null : (
            <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={dynamic} onChange={(e) => setDynamic(e.target.checked)} disabled={!!initial.id} style={{ width: "auto", marginTop: 3 }} />
              <span><b>{labels.dynamic}</b><br /><span className="small muted">{dynamic ? labels.dynamic_help : labels.static_help}</span></span>
            </label>
          )}
        </div>
        <div className="panel stack">
          <b>{labels.design}</b>
          <div className="fields">
            <label className="f">{labels.fg}<input type="color" value={style.fg} onChange={(e) => setStyle((s) => ({ ...s, fg: e.target.value, eyeColor: s.eyeColor === s.fg ? e.target.value : s.eyeColor }))} /></label>
            <label className="f">{labels.bg}<input type="color" value={style.bg} onChange={(e) => st("bg", e.target.value)} /></label>
            <label className="f">{labels.eye_color}<input type="color" value={style.eyeColor} onChange={(e) => st("eyeColor", e.target.value)} /></label>
            <label className="f">{labels.dots}<select value={style.dots} onChange={(e) => st("dots", e.target.value as QrStyle["dots"])}>{(["square", "rounded", "dots"] as const).map((x) => <option key={x} value={x}>{labels.shapes[x]}</option>)}</select></label>
            <label className="f">{labels.eyes}<select value={style.eyes} onChange={(e) => st("eyes", e.target.value as QrStyle["eyes"])}>{(["square", "rounded", "circle"] as const).map((x) => <option key={x} value={x}>{labels.shapes[x]}</option>)}</select></label>
            <label className="f">{labels.ecc}<select value={style.ecc} onChange={(e) => st("ecc", e.target.value as QrStyle["ecc"])} disabled={!!style.logo}><option value="L">L · 7%</option><option value="M">M · 15%</option><option value="Q">Q · 25%</option><option value="H">H · 30%</option></select></label>
          </div>
          <div className="fields">
            <label className="f">{labels.logo}<input type="file" accept="image/png,image/jpeg" onChange={onLogo} /><span className="small muted">{labels.logo_help}</span></label>
            {style.logo ? <div className="row" style={{ gap: 8, alignItems: "center" }}><img src={style.logo} alt="" style={{ width: 40, height: 40, objectFit: "contain" }} /><button type="button" className="btn sm ghost" onClick={() => st("logo", null)}>{labels.remove}</button></div> : null}
          </div>
          <div className="fields">
            <label className="f">{labels.frame}<select value={style.frame} onChange={(e) => st("frame", e.target.value as QrStyle["frame"])}>{(["none", "box", "banner"] as const).map((x) => <option key={x} value={x}>{labels.frames[x]}</option>)}</select></label>
            {style.frame !== "none" ? <>
              <label className="f">{labels.frame_text}<input value={style.frameText} onChange={(e) => st("frameText", e.target.value.slice(0, 30))} /></label>
              <label className="f">{labels.frame_color}<input type="color" value={style.frameColor} onChange={(e) => st("frameColor", e.target.value)} /></label>
            </> : null}
          </div>
        </div>
      </div>
      <aside className="qr-preview panel stack">
        <b>{labels.preview}</b>
        {encoded ? <div className="qr-svg" data-content={encoded} dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="small muted">{labels.empty}</div>}
        {isDynamic && shortLink ? <code className="small" style={{ wordBreak: "break-all" }}>{shortLink}</code> : null}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn sm" onClick={() => download("png")} disabled={!encoded}>{labels.download_png}</button>
          <button type="button" className="btn sm" onClick={() => download("svg")} disabled={!encoded}>{labels.download_svg}</button>
        </div>
        <button type="submit" className="btn primary">{labels.save}</button>
      </aside>
    </form>
  );
}

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
