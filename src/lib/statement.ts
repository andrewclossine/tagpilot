/** Reads bank or MoMo statement rows pasted from CSV or Excel into dated, signed amounts. */
export type StatementRow = { date: string; description: string; reference: string; amount: number };

function splitRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
    else if (ch === delim && !quoted) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseDate(s: string): string | null {
  const v = s.trim();
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); // Rwandan banks print day first
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function parseNum(s: string): number | null {
  const v = s.replace(/[\s  ]/g, "").replace(/(RWF|FRW|Frw)/gi, "");
  if (!v || !/^[-+(]?[\d.,]+\)?$/.test(v)) return null;
  const neg = v.startsWith("-") || v.startsWith("(");
  // "1,234,567.50" or "1.234.567,50": the last separator followed by 1-2 digits is the decimal point.
  const clean = v.replace(/[-+()]/g, "");
  const dec = clean.match(/[.,](\d{1,2})$/);
  const intPart = (dec ? clean.slice(0, -dec[0].length) : clean).replace(/[.,]/g, "");
  const n = Number(intPart + (dec ? "." + dec[1] : ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export function parseStatement(text: string): StatementRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const delim = first.includes("\t") ? "\t" : (first.split(";").length > first.split(",").length ? ";" : ",");
  const rows = lines.map((l) => splitRow(l, delim));
  const hasHeader = !rows[0].some((c) => parseDate(c));
  const header = hasHeader ? rows[0].map((h) => h.toLowerCase()) : [];
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const iDate = find(/date/), iDesc = find(/desc|narr|detail|libell|particular|motif/), iRef = find(/ref/);
  const iAmt = find(/^amount|montant/), iIn = find(/credit|deposit|money in|entr|paid in|received/), iOut = find(/debit|withdraw|money out|sortie|paid out/);

  const out: StatementRow[] = [];
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const di = iDate >= 0 ? iDate : r.findIndex((c) => parseDate(c));
    const date = di >= 0 ? parseDate(r[di] ?? "") : null;
    if (!date) continue;
    let amount: number | null = null;
    if (iAmt >= 0) amount = parseNum(r[iAmt] ?? "");
    else if (iIn >= 0 || iOut >= 0) amount = (parseNum(r[iIn] ?? "") ?? 0) - Math.abs(parseNum(r[iOut] ?? "") ?? 0);
    else amount = r.map((c, i) => (i === di ? null : parseNum(c))).find((n) => n !== null) ?? null;
    if (amount === null || amount === 0) continue;
    const description = iDesc >= 0 ? r[iDesc] ?? "" : r.filter((c, i) => i !== di && parseNum(c) === null).sort((a, b) => b.length - a.length)[0] ?? "";
    out.push({ date, description: description.slice(0, 300), reference: iRef >= 0 ? (r[iRef] ?? "").slice(0, 100) : "", amount: Math.round(amount * 100) / 100 });
  }
  return out;
}
