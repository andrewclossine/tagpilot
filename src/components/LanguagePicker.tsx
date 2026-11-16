"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { setLang } from "@/app/session-actions";

type Lang = "en" | "fr";

/** Drawn flags: emoji flags show as two letters on Windows. */
function Flag({ lang }: { lang: Lang }) {
  if (lang === "fr") {
    return (
      <svg className="lang-flag" viewBox="0 0 3 2" aria-hidden="true">
        <rect width="1" height="2" fill="#002654" /><rect x="1" width="1" height="2" fill="#fff" /><rect x="2" width="1" height="2" fill="#ce1126" />
      </svg>
    );
  }
  return (
    <svg className="lang-flag" viewBox="0 0 60 30" aria-hidden="true">
      <clipPath id="lang-uk"><path d="M0,0 v30 h60 v-30 z" /></clipPath>
      <clipPath id="lang-uk-t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" /></clipPath>
      <g clipPath="url(#lang-uk)">
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#lang-uk-t)" stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}

const LANGS: { code: Lang; name: string }[] = [{ code: "en", name: "English" }, { code: "fr", name: "Français" }];

/**
 * Shows the language in use with its flag; opening it lists the other languages. Choosing one comes back to the same page.
 * Works without JavaScript too (a details element and a plain form).
 */
export function LanguagePicker({ lang, dark, compact }: { lang: Lang; dark?: boolean; compact?: boolean }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];
  // Close the list when clicking elsewhere or pressing Escape.
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", close); };
  }, []);
  return (
    <details ref={ref} className={`lang-pick${dark ? " dark" : ""}${compact ? " compact" : ""}`}>
      <summary aria-label={`Language: ${current.name}`}>
        <Flag lang={current.code} /><span className="lang-name">{current.name}</span><span className="lang-caret" aria-hidden="true">▾</span>
      </summary>
      <form action={setLang} className="lang-menu"
        onSubmit={(e) => { const back = e.currentTarget.elements.namedItem("back"); if (back instanceof HTMLInputElement) back.value = window.location.pathname + window.location.search; }}>
        <input type="hidden" name="back" defaultValue={pathname} />
        {LANGS.map((l) => (
          <button key={l.code} type="submit" name="lang" value={l.code} aria-current={l.code === lang ? "true" : undefined} lang={l.code}>
            <Flag lang={l.code} /><span>{l.name}</span>{l.code === lang ? <span className="lang-check" aria-hidden="true">✓</span> : null}
          </button>
        ))}
      </form>
    </details>
  );
}
