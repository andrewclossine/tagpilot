import Link from "next/link";
import type { Cell, Report, Row } from "@/lib/financial-reports";

const CLASS: Record<Row["style"], string> = { head: "sub", group: "rgroup", line: "", sub: "rsub", total: "total" };

/** One report table. A row's label runs across the empty cells that follow it. */
export function ReportTable({ report, money }: { report: Report; money: (n: number) => string }) {
  const width = report.columns.length;
  const show = (v: Cell, i: number) => {
    if (v === null || v === "") return "";
    if (typeof v === "string") return v;
    const type = report.columns[i]?.type;
    if (type === "pct") return `${(v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    if (type === "money") return money(v);
    return String(v); // an entry number
  };
  return (
    <table>
      <thead><tr>{report.columns.map((c, i) => <th key={i} className={c.type === "text" ? undefined : "num"}>{c.label}</th>)}</tr></thead>
      <tbody>
        {report.rows.map((r, n) => {
          let span = 1;
          while (span < r.cells.length && r.cells[span] === null) span++;
          if (r.cells.length === 1) span = width;
          // Only text-column blanks merge: an empty amount keeps its own cell.
          while (span > 1 && report.columns[span - 1]?.type !== "text" && r.cells.length > 1) span--;
          const cells = r.cells.slice(span);
          const content = (v: Cell, i: number) => { const href = r.links?.[i]; return href ? <Link className="rowlink" href={href}>{show(v, i)}</Link> : show(v, i); };
          return (
            <tr key={n} className={CLASS[r.style] || undefined}>
              <td colSpan={span} className={r.indent ? "rindent" : undefined}>{content(r.cells[0], 0)}</td>
              {cells.map((v, i) => { const col = i + span; return <td key={col} className={report.columns[col]?.type === "text" ? undefined : "num"}>{content(v, col)}</td>; })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
