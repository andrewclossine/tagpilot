// Report date ranges, as in QuickBooks: "This month-to-date", "Last fiscal quarter", "Next 4 weeks" and so on.
// Pure date arithmetic on YYYY-MM-DD strings, shared by the server and the date picker in the browser.

export const RANGE_GROUPS = [
  ["custom", "all"],
  ["today", "this-week", "this-week-td", "this-month", "this-month-td", "this-quarter", "this-quarter-td", "this-year", "this-year-td"],
  ["yesterday", "last-week", "last-week-td", "last-month", "last-month-td", "last-quarter", "last-quarter-td", "last-year", "last-year-td"],
  ["next-week", "next-4-weeks", "next-month", "next-quarter", "next-year"],
  ["last-7", "last-30", "last-90", "last-365"],
] as const;
export type Range = (typeof RANGE_GROUPS)[number][number];
export const RANGES: readonly Range[] = RANGE_GROUPS.flat();
export const isRange = (s: string): s is Range => (RANGES as readonly string[]).includes(s);

const parse = (d: string) => new Date(d + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => { const x = parse(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
/** The first day of the month `n` months after the month of `d`. */
const monthStart = (d: string, n = 0) => { const x = parse(d); return iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1))); };
const monthEnd = (d: string, n = 0) => plusDays(monthStart(d, n + 1), -1);
/** The same day of the month, `n` months away, held to that month's last day (31 March less a month is 28 February). */
const sameDay = (d: string, n: number) => { const s = monthStart(d, n), e = monthEnd(d, n); const day = String(parse(d).getUTCDate()).padStart(2, "0"); return `${s.slice(0, 8)}${day}` > e ? e : `${s.slice(0, 8)}${day}`; };
/** Weeks start on Monday. */
const weekStart = (d: string) => plusDays(d, -((parse(d).getUTCDay() + 6) % 7));
/** The first day of the fiscal year holding `d`, for a year that starts in month `fy` (1 = January). */
const yearStart = (d: string, fy: number) => { const x = parse(d); const y = x.getUTCMonth() + 1 >= fy ? x.getUTCFullYear() : x.getUTCFullYear() - 1; return `${y}-${String(fy).padStart(2, "0")}-01`; };
/** The first day of the fiscal quarter holding `d`. */
const quarterStart = (d: string, fy: number) => { const ys = yearStart(d, fy); const months = (parse(d).getUTCFullYear() - parse(ys).getUTCFullYear()) * 12 + parse(d).getUTCMonth() - parse(ys).getUTCMonth(); return monthStart(ys, months - (months % 3)); };

/**
 * The dates of a range, counted from `today`. `fy` is the month the fiscal year starts (1 to 12). "To date" ranges
 * end today, or on the same day of the earlier period for the "last" ones. Custom returns nothing: the dates typed stand.
 */
export function rangeDates(range: Range, today: string, fy = 1): { from: string; to: string } | null {
  const f = fy >= 1 && fy <= 12 ? Math.trunc(fy) : 1;
  const ws = weekStart(today), qs = quarterStart(today, f), ys = yearStart(today, f);
  switch (range) {
    case "custom": return null;
    case "all": return { from: "2000-01-01", to: today };
    case "today": return { from: today, to: today };
    case "this-week": return { from: ws, to: plusDays(ws, 6) };
    case "this-week-td": return { from: ws, to: today };
    case "this-month": return { from: monthStart(today), to: monthEnd(today) };
    case "this-month-td": return { from: monthStart(today), to: today };
    case "this-quarter": return { from: qs, to: monthEnd(qs, 2) };
    case "this-quarter-td": return { from: qs, to: today };
    case "this-year": return { from: ys, to: monthEnd(ys, 11) };
    case "this-year-td": return { from: ys, to: today };
    case "yesterday": { const y = plusDays(today, -1); return { from: y, to: y }; }
    case "last-week": return { from: plusDays(ws, -7), to: plusDays(ws, -1) };
    case "last-week-td": return { from: plusDays(ws, -7), to: plusDays(today, -7) };
    case "last-month": return { from: monthStart(today, -1), to: monthEnd(today, -1) };
    case "last-month-td": return { from: monthStart(today, -1), to: sameDay(today, -1) };
    case "last-quarter": return { from: monthStart(qs, -3), to: plusDays(qs, -1) };
    case "last-quarter-td": return { from: monthStart(qs, -3), to: sameDay(today, -3) };
    case "last-year": return { from: monthStart(ys, -12), to: plusDays(ys, -1) };
    case "last-year-td": return { from: monthStart(ys, -12), to: sameDay(today, -12) };
    case "next-week": return { from: plusDays(ws, 7), to: plusDays(ws, 13) };
    case "next-4-weeks": return { from: plusDays(ws, 7), to: plusDays(ws, 34) };
    case "next-month": return { from: monthStart(today, 1), to: monthEnd(today, 1) };
    case "next-quarter": return { from: monthStart(qs, 3), to: monthEnd(qs, 5) };
    case "next-year": return { from: monthStart(ys, 12), to: monthEnd(ys, 23) };
    case "last-7": return { from: plusDays(today, -6), to: today };
    case "last-30": return { from: plusDays(today, -29), to: today };
    case "last-90": return { from: plusDays(today, -89), to: today };
    case "last-365": return { from: plusDays(today, -364), to: today };
  }
}

/** Which range a pair of dates is, so a report opened with plain dates still shows "This month" when it is. */
export function rangeOf(from: string, to: string, today: string, fy = 1): Range {
  for (const r of RANGES) { if (r === "custom" || r === "all") continue; const d = rangeDates(r, today, fy); if (d && d.from === from && d.to === to) return r; }
  return "custom";
}
