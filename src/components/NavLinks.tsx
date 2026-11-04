"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string } | { group: string };

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  // When one link sits under another, only the most specific one is marked as current.
  const current = items.flatMap((i) => ("href" in i && (path === i.href || path.startsWith(i.href + "/")) ? [i.href] : []))
    .sort((a, b) => b.length - a.length)[0];
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
