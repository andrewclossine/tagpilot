"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Item = { kind: string; label: string; help: string };
const KEY = "tagpilot_report_favourites";

/**
 * The reports centre: every report by group, a search box that filters as you type, and favourites marked with a
 * star that stay at the top. Favourites are kept in this browser only.
 */
export function ReportFinder({ groups, labels }: { groups: { title: string; items: Item[] }[]; labels: { search: string; favourites: string; star: string; unstar: string; none: string } }) {
  const [q, setQ] = useState("");
  const [fav, setFav] = useState<string[]>([]);
  useEffect(() => {
    try { setFav(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { /* storage unavailable: no favourites */ }
  }, []);
  const toggle = (kind: string) => {
    const next = fav.includes(kind) ? fav.filter((k) => k !== kind) : [...fav, kind];
    setFav(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  const needle = q.trim().toLowerCase();
  const fits = (i: Item) => !needle || i.label.toLowerCase().includes(needle) || i.help.toLowerCase().includes(needle);
  const all = groups.flatMap((g) => g.items);
  const favourites = fav.map((k) => all.find((i) => i.kind === k)).filter((i): i is Item => !!i && fits(i));
  const shown = groups.map((g) => ({ ...g, items: g.items.filter(fits) })).filter((g) => g.items.length);
  const row = (i: Item) => (
    <li key={i.kind}>
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <button type="button" className={`star${fav.includes(i.kind) ? " on" : ""}`} onClick={() => toggle(i.kind)} aria-pressed={fav.includes(i.kind)}
          aria-label={`${fav.includes(i.kind) ? labels.unstar : labels.star}: ${i.label}`} title={fav.includes(i.kind) ? labels.unstar : labels.star}>★</button>
        <Link href={`/reports/${i.kind}`}>{i.label}</Link>
      </div>
      <span className="small muted">{i.help}</span>
    </li>
  );
  return (
    <div className="stack">
      <div className="panel row" style={{ gap: 8 }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={labels.search} aria-label={labels.search} style={{ maxWidth: 420 }} />
      </div>
      {favourites.length ? (
        <section className="panel stack"><h2>★ {labels.favourites}</h2><ul className="report-list">{favourites.map(row)}</ul></section>
      ) : null}
      {shown.map((g) => <section key={g.title} className="panel stack"><h2>{g.title}</h2><ul className="report-list">{g.items.map(row)}</ul></section>)}
      {!shown.length ? <div className="panel small muted">{labels.none}</div> : null}
    </div>
  );
}
