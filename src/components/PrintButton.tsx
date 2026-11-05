"use client";

/** Opens the browser's print window, which can also save the page as a PDF. */
export function PrintButton({ label }: { label: string }) {
  return <button type="button" className="btn sm" onClick={() => window.print()}>{label}</button>;
}
