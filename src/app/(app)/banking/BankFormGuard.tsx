"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Checks a cheque or deposit form before it is sent, so a missing payee or account is pointed out on the spot
 * and nothing typed is lost. The server checks the same things again.
 */
export function BankFormGuard({ needPayee, labels }: { needPayee: boolean; labels: { payee: string; lines: string; lineAccount: string } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const check = (e: SubmitEvent) => {
      const all = (name: string) => [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)];
      const accounts = all("lineAccount"), amounts = all("lineAmount");
      let problem = "", focus: HTMLElement | null = null;
      for (const el of [...accounts, ...amounts]) el.removeAttribute("aria-invalid");
      if (needPayee) {
        const payee = form.querySelector<HTMLInputElement>('[name="payee"]'), partner = form.querySelector<HTMLSelectElement>('[name="partnerId"]');
        if (payee && !payee.value.trim() && !(partner && partner.value)) { problem = labels.payee; focus = payee; payee.setAttribute("aria-invalid", "true"); }
      }
      let filled = 0;
      accounts.forEach((acc, i) => {
        const amt = amounts[i]; const has = !!amt?.value.trim();
        if (has && !acc.value) { if (!problem) { problem = labels.lineAccount; focus = acc; } acc.setAttribute("aria-invalid", "true"); }
        if (acc.value && has) filled++;
      });
      if (!problem && !filled) { problem = labels.lines; focus = accounts[0] ?? null; }
      if (problem) { e.preventDefault(); setMessage(problem); focus?.focus(); } else setMessage("");
    };
    form.addEventListener("submit", check);
    return () => form.removeEventListener("submit", check);
  }, [needPayee, labels]);
  return <div ref={ref} role="alert" aria-live="polite">{message ? <div className="note bad small">{message}</div> : null}</div>;
}
