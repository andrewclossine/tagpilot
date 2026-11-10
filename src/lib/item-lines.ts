/** Reads the lines an ItemLines editor sent. */
export function readItemLines(fd: FormData) {
  const all = (k: string) => fd.getAll(k).map((v) => String(v).trim());
  const d = all("line_desc"), u = all("line_unit"), q = all("line_qty"), c = all("line_cost");
  const num = (s: string | undefined) => { const n = Number((s ?? "").replace(/[\s,]/g, "")); return Number.isFinite(n) && n > 0 ? n : 0; };
  return d.map((description, i) => ({ description, unit: u[i] ?? "", quantity: num(q[i]), unitCost: num(c[i]) })).filter((l) => l.description || l.quantity);
}
