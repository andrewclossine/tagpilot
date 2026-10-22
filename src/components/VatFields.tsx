"use client";
import { useState } from "react";

/** Asks whether the company charges VAT, and its rate only when it does. */
export function VatFields({ labels, registered = false, rate = 0 }: { labels: { vat: string; rate: string; yes: string; no: string }; registered?: boolean; rate?: number }) {
  const [on, setOn] = useState(registered);
  return (
    <div className="fields">
      <label className="f">{labels.vat}
        <select id="vat" name="vat" value={on ? "1" : "0"} onChange={(e) => setOn(e.target.value === "1")}>
          <option value="0">{labels.no}</option><option value="1">{labels.yes}</option>
        </select>
      </label>
      {on ? <label className="f">{labels.rate}<input id="vatRate" name="vatRate" className="num" defaultValue={rate || ""} inputMode="decimal" required /></label> : null}
    </div>
  );
}
