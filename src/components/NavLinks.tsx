"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; top?: boolean } | { group: string };
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

/** A select that submits its form as soon as the choice changes. */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
