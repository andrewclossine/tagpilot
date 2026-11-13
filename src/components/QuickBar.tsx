"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NewGroup = { label: string; links: { href: string; label: string }[] };

/**
 * "+ New" and search, always in reach: everything a person can create, grouped like the menus, and one box that
 * finds invoices, bills, customers, suppliers, entries and accounts. "/" puts the cursor in the search box.
 */
export function QuickBar({ groups, labels }: { groups: NewGroup[]; labels: { new: string; search: string; placeholder: string } }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if (e.key === "/" && !typing) { e.preventDefault(); input.current?.focus(); }
    };
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); };
  }, []);
  const shown = groups.filter((g) => g.links.length);
  return (
    <div className="quickbar" ref={box}>
      {shown.length ? (
        <div className="quick-new">
          <button type="button" className="btn sm primary" aria-expanded={open} onClick={() => setOpen(!open)}>+ {labels.new}</button>
          <div className="quick-panel" hidden={!open}>
            {shown.map((g) => (
              <div key={g.label} className="quick-col">
                <div className="quick-head">{g.label}</div>
                {g.links.map((l) => <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</Link>)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <form action="/search" method="get" className="quick-search" role="search">
        <input ref={input} name="q" type="search" placeholder={labels.placeholder} aria-label={labels.search} autoComplete="off" />
      </form>
    </div>
  );
}
