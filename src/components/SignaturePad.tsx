"use client";
import { useEffect, useRef, useState } from "react";

const WIDTH = 840, HEIGHT = 280;

type Labels = { help: string; clear: string; upload: string; redraw: string; remember: string; required: string };

/**
 * Where a person signs: draw with a finger or mouse, upload a picture of the signature, or reuse the one kept from last time.
 * The drawing is sent as a PNG in the "signature" field. The field is required, so the browser stops a form with no signature.
 */
export function SignaturePad({ saved, labels }: { saved?: string | null; labels: Labels }) {
  const [value, setValue] = useState(saved ?? "");
  const [usingSaved, setUsingSaved] = useState(!!saved);
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);

  useEffect(() => { field.current?.setCustomValidity(value ? "" : labels.required); }, [value, labels.required]);

  const blank = () => {
    const c = canvas.current?.getContext("2d");
    if (!c) return;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, WIDTH, HEIGHT);
    c.strokeStyle = "#10203f"; c.lineWidth = 4; c.lineCap = "round"; c.lineJoin = "round";
  };
  useEffect(() => { if (!usingSaved) blank(); }, [usingSaved]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) * (WIDTH / r.width), (e.clientY - r.top) * (HEIGHT / r.height)] as const;
  };
  const save = () => setValue(canvas.current?.toDataURL("image/png") ?? "");

  const clear = () => { blank(); setValue(""); };
  const redraw = () => { setUsingSaved(false); setValue(""); };

  const upload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      blank();
      const scale = Math.min(WIDTH / img.width, HEIGHT / img.height);
      const w = img.width * scale, h = img.height * scale;
      canvas.current?.getContext("2d")?.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
      URL.revokeObjectURL(url);
      save();
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  return (
    <div className="sig-pad">
      <div className="small muted">{labels.help}</div>
      {usingSaved && saved ? (
        <img src={saved} alt="" className="sig-image" />
      ) : (
        <canvas
          ref={canvas} width={WIDTH} height={HEIGHT}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const c = e.currentTarget.getContext("2d"), [x, y] = at(e);
            if (!c) return;
            drawing.current = true;
            c.beginPath(); c.moveTo(x, y); c.lineTo(x + 0.1, y); c.stroke();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const c = e.currentTarget.getContext("2d"), [x, y] = at(e);
            c?.lineTo(x, y); c?.stroke();
          }}
          onPointerUp={() => { if (drawing.current) { drawing.current = false; save(); } }}
          onPointerCancel={() => { drawing.current = false; }}
        />
      )}
      <input ref={field} className="sig-value" name="signature" value={value} onChange={() => undefined} required tabIndex={-1} aria-hidden="true" autoComplete="off" />
      <div className="row">
        {usingSaved && saved ? (
          <button type="button" className="btn sm" onClick={redraw}>{labels.redraw}</button>
        ) : (
          <>
            <button type="button" className="btn sm" onClick={clear}>{labels.clear}</button>
            <label className="btn sm">{labels.upload}<input type="file" accept="image/png,image/jpeg" onChange={upload} hidden /></label>
          </>
        )}
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="rememberSignature" defaultChecked={!!saved} style={{ width: "auto" }} />{labels.remember}</label>
      </div>
    </div>
  );
}
