"use client";
import { useState } from "react";

/** Copies a signer's private link, to send by WhatsApp or SMS when there is no email. */
export function CopyLink({ link, label, done }: { link: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="btn sm" title={link} onClick={async () => {
      try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
      catch { window.prompt(label, link); }
    }}>{copied ? done : label}</button>
  );
}
