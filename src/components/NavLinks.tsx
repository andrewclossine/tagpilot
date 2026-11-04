"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string } | { group: string };
export type Workspace = { key: string; label: string; items: NavItem[] };

const hrefs = (items: NavItem[]) => items.flatMap((i) => ("href" in i ? [i.href] : []));
const within = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  // When one link sits under another, only the most specific one is marked as current.
  const current = hrefs(items).filter((h) => within(path, h)).sort((a, b) => b.length - a.length)[0];
  return (
    <nav>
      {items.map((i, n) => "group" in i
        ? <div key={n} className="group">{i.group}</div>
        : <Link key={i.href} href={i.href} className="link" aria-current={i.href === current ? "page" : undefined}>{i.label}</Link>)}
    </nav>
  );
}

/**
 * The sidebar: one tab per module, and only the links of the open one. A page that belongs to no module, such as
 * Settings, leaves the last module open. A page in two modules stays in the one the person came from.
 */
export function WorkspaceNav({ workspaces, common }: { workspaces: Workspace[]; common: NavItem[] }) {
  const path = usePathname();
  const [last, setLast] = useState<string | null>(null);
  const matching = workspaces.filter((w) => hrefs(w.items).some((h) => within(path, h)));
  const active = matching.find((w) => w.key === last) ?? matching[0] ?? workspaces.find((w) => w.key === last) ?? workspaces[0];

  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem("tagpilot_workspace"); } catch { /* private window: the sidebar still works */ }
    setLast(stored);
  }, []);
  useEffect(() => {
    if (!active || !matching.length) return;
    setLast(active.key);
    try { localStorage.setItem("tagpilot_workspace", active.key); } catch { /* private window: the sidebar still works */ }
  }, [active?.key, matching.length]);

  return (
    <>
      {workspaces.length > 1 ? (
        <div className="workspaces" role="tablist">
          {workspaces.map((w) => {
            const first = hrefs(w.items)[0];
            return (
              <Link key={w.key} href={first} role="tab" aria-selected={w.key === active?.key} onClick={() => setLast(w.key)}
                className={w.key === active?.key ? "workspace on" : "workspace"}>{w.label}</Link>
            );
          })}
        </div>
      ) : workspaces.length === 1 ? <div className="workspace-title">{workspaces[0].label}</div> : null}
      {active ? <NavLinks items={active.items} /> : null}
      {common.length ? <NavLinks items={common} /> : null}
    </>
  );
}

/** A select that submits its form as soon as the choice changes. */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
