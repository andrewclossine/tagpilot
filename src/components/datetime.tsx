"use client";
import { useEffect, useState } from "react";

/** Picks a moment in the person's own time zone and sends it to the server as an exact instant. */
export function DeadlineInput({ name, defaultValue, id, required }: { name: string; defaultValue?: string | null; id: string; required?: boolean }) {
  const [iso, setIso] = useState(defaultValue ?? "");
  const [local, setLocal] = useState("");
  useEffect(() => {
    if (!defaultValue) return;
    const d = new Date(defaultValue);
    setLocal(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  }, [defaultValue]);
  return (
    <>
      <input id={id} type="datetime-local" value={local} required={required}
        onChange={(e) => { setLocal(e.target.value); setIso(e.target.value ? new Date(e.target.value).toISOString() : ""); }} />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}

/** Shows an instant in the reader's own time zone. */
export function LocalTime({ value }: { value: string | null }) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (value) setText(new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  }, [value]);
  return <span>{text || (value ? `${value.slice(0, 16).replace("T", " ")} UTC` : "-")}</span>;
}
