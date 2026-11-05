"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppIcon, type AppKey } from "./AppIcon";
import { NavLinks, type NavItem, type Workspace } from "./NavLinks";

const hrefs = (items: NavItem[]) => items.flatMap((i) => ("href" in i ? [i.href] : []));
const within = (path: string, href: string) => path === href || path.startsWith(href + "/");

type Menu = { label: string; href?: string; links: { href: string; label: string }[] };

/** Links before any group stand alone in the menu bar; each group becomes a dropdown. */
function toMenus(items: NavItem[]): Menu[] {
  const menus: Menu[] = [];
  let open: Menu | null = null;
  for (const i of items) {
    if ("group" in i) { open = { label: i.group, links: [] }; menus.push(open); }
    else if (open) open.links.push(i);
    else menus.push({ label: i.label, href: i.href, links: [] });
  }
  return menus;
}

/** The menu bar of an app that keeps its navigation on top. */
function TopMenu({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLElement>(null);
  const menus = toMenus(items);
  const current = hrefs(items).filter((h) => within(path, h)).sort((a, b) => b.length - a.length)[0];

  useEffect(() => setOpen(null), [path]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(null); };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(null);
      bar.current?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  return (
    <nav className="top-menu" ref={bar}>
      {menus.map((m) => m.href ? (
        <Link key={m.label} href={m.href} className="top-item" aria-current={m.href === current ? "page" : undefined}>{m.label}</Link>
      ) : (
        <div key={m.label} className={open === m.label ? "top-group open" : "top-group"}>
          <button type="button" className={`top-item${m.links.some((l) => l.href === current) ? " on" : ""}`} aria-expanded={open === m.label}
            onClick={() => setOpen(open === m.label ? null : m.label)}>
            {m.label} <span aria-hidden="true">▾</span>
          </button>
          <div className="top-panel" hidden={open !== m.label}>
            {m.links.map((l) => <Link key={l.href} href={l.href} aria-current={l.href === current ? "page" : undefined} onClick={() => setOpen(null)}>{l.label}</Link>)}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * The frame around every page of an app. Accounting has many pages, so its menus run along the top; the other apps
 * keep a sidebar. A page that belongs to no app, such as Settings, stays in the last app. A page in two apps stays in
 * the one the person came from.
 */
export function AppShell({ workspaces, common, allAppsLabel, brand, account, children }: {
  workspaces: Workspace[]; common: NavItem[]; allAppsLabel: string; brand: React.ReactNode; account: React.ReactNode; children: React.ReactNode;
}) {
  const path = usePathname();
  const [last, setLast] = useState<string | null>(null);
  const matching = workspaces.filter((w) => hrefs(w.items).some((h) => within(path, h)));
  const active = matching.find((w) => w.key === last) ?? matching[0] ?? workspaces.find((w) => w.key === last) ?? workspaces[0];

  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem("tagpilot_workspace"); } catch { /* private window: the frame still works */ }
    setLast(stored);
  }, []);
  useEffect(() => {
    if (!active || !matching.length) return;
    setLast(active.key);
    try { localStorage.setItem("tagpilot_workspace", active.key); } catch { /* private window: the frame still works */ }
  }, [active?.key, matching.length]);

  const allApps = <Link href="/apps" className="all-apps">← {allAppsLabel}</Link>;
  const title = active ? <div className="workspace-title"><AppIcon app={active.key as AppKey} size={26} />{active.label}</div> : null;

  if (active?.key === "accounting") {
    return (
      <div className="top-shell">
        <header className="topbar">
          <div className="topbar-row">{brand}{allApps}<span className="spacer" />{account}</div>
          <div className="topbar-row">{title}<TopMenu items={[...active.items, ...common]} /></div>
        </header>
        <main className="main">{children}</main>
      </div>
    );
  }
  return (
    <div className="shell">
      <aside className="side">
        {brand}
        {allApps}
        {title}
        {active ? <NavLinks items={active.items} /> : null}
        {common.length ? <NavLinks items={common} /> : null}
        {account}
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
