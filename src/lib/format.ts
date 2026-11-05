export type Lang = "en" | "fr";

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function parseAmount(v: FormDataEntryValue | string | number | null | undefined): number {
  const n = Number(String(v ?? "").replace(/[\s,  ]/g, ""));
  return Number.isFinite(n) ? round2(n) : 0;
}

export function money(n: number | null | undefined, lang: Lang = "en", decimals = 0): string {
  const v = Number(n) || 0;
  return v.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 2) });
}

export const today = () => new Date().toISOString().slice(0, 10);

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** A real calendar date written as YYYY-MM-DD: 2026-13-45 and 2026-02-30 are refused. */
export const isIsoDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

/** Usernames: 3 to 40 lowercase letters, digits, dots, dashes or underscores. */
export const isUsername = (u: string) => /^[a-z0-9._-]{3,40}$/.test(u);

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
