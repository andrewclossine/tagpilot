"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return pending
    ? <div className="row"><span className="dot" /> <span>{busy}</span></div>
    : <button type="submit" className="btn primary">{label}</button>;
}

export function ScanForm({ action, labels }: {
  action: (fd: FormData) => Promise<void>;
  labels: { drop: string; choose: string; read: string; reading: string };
}) {
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);
  return (
    <form action={action} className="stack">
      <label htmlFor="file" className={`drop${over ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false);
          const input = document.getElementById("file") as HTMLInputElement;
          if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; setName(e.dataTransfer.files[0].name); }
        }}>
        <strong style={{ display: "block", fontFamily: "var(--f-display)", fontSize: 16 }}>{name || labels.choose}</strong>
        <span className="muted small">{labels.drop}</span>
      </label>
      <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" required hidden
        onChange={(e) => setName(e.target.files?.[0]?.name ?? "")} />
      <Submit label={labels.read} busy={labels.reading} />
    </form>
  );
}
