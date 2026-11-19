import "server-only";
import type { Ctx } from "./auth";
import { isIsoDate, timeZoneOf } from "./format";
import type { Report, Row } from "./financial-reports";
import { AS_AT_KINDS } from "./financial-reports";
import { getI18n } from "./i18n";
import { isRange, rangeDates, rangeOf, type Range } from "./report-dates";
import { buildReport, REPORT_TITLES, type ReportKind } from "./reports";

/** Today in the organisation's own time zone, so "Today" in Kigali is not yesterday in UTC. */
export function companyToday(ctx: Ctx) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZoneOf(ctx.company.country), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export const fiscalStart = (ctx: Ctx) => ctx.company.settings.fiscalYearStart ?? 1;

/** What a report is asked for: its dates, the account it is limited to, the columns left out and a title of one's own. */
export type ReportQuery = { range: Range; from: string; to: string; account: string; hide: number[]; title: string };

/** Reads the query from the page address or a form. A named range wins over typed dates. */
export function readQuery(ctx: Ctx, get: (k: string) => string | null | undefined): ReportQuery {
  const today = companyToday(ctx), fy = fiscalStart(ctx);
  const r = get("range") ?? "";
  const picked = isRange(r) ? rangeDates(r, today, fy) : null;
  const fromQ = get("from") ?? "", toQ = get("to") ?? "";
  const from = picked?.from ?? (isIsoDate(fromQ) ? fromQ : `${today.slice(0, 4)}-01-01`);
  const to = picked?.to ?? (isIsoDate(toQ) ? toQ : today);
  const hide = [...new Set((get("hide") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 50))].sort((a, b) => a - b);
  return {
    range: isRange(r) && r !== "custom" ? r : rangeOf(from, to, today, fy),
    from: from <= to ? from : to, to, account: get("account") ?? "", hide, title: (get("title") ?? "").slice(0, 120),
  };
}

/** The query again as an address, for the export links and the email form. */
export function queryString(q: ReportQuery) {
  const p = new URLSearchParams();
  p.set("from", q.from); p.set("to", q.to);
  if (q.account) p.set("account", q.account);
  if (q.hide.length) p.set("hide", q.hide.join(","));
  if (q.title) p.set("title", q.title);
  return p.toString();
}

/** The report without the columns left out. The first column, the row names, always stays. */
export function hideColumns(report: Report, hide: number[]): Report {
  const gone = new Set(hide.filter((i) => i > 0 && i < report.columns.length));
  if (!gone.size) return report;
  const keep = report.columns.map((_, i) => i).filter((i) => !gone.has(i));
  const at = new Map(keep.map((old, i) => [old, i]));
  return {
    ...report,
    columns: keep.map((i) => report.columns[i]),
    rows: report.rows.map((r): Row => r.cells.length <= 1 ? r : {
      ...r,
      cells: r.cells.filter((_, i) => !gone.has(i)),
      links: r.links ? Object.fromEntries(Object.entries(r.links).flatMap(([k, v]) => (at.has(Number(k)) ? [[at.get(Number(k))!, v]] : []))) : undefined,
    }),
  };
}

/** Builds a report as it is asked for: the full one (for the column picker) and the one shown, printed and sent. */
export async function loadReport(ctx: Ctx, kind: ReportKind, q: ReportQuery) {
  const { t, accName } = await getI18n();
  const s = ctx.company.settings;
  const full = await buildReport(kind, { companyId: ctx.company.id, apAccount: s.apAccount, arAccount: s.arAccount, vatIn: s.vatIn, vatOut: s.vatOut, from: q.from, to: q.to, account: q.account || undefined, t, accName });
  const title = q.title || t(REPORT_TITLES[kind]);
  return { full, report: hideColumns(full, q.hide), title, asAt: AS_AT_KINDS.includes(kind) };
}

/** A file name from the title and the end date. */
export const reportFileName = (title: string, to: string, ext: string) => `${title.replace(/[\\/:*?"<>|]+/g, "-").trim()} ${to}.${ext}`;

/** The report as files, built the same way for the download buttons and for email. */
export async function reportFiles(ctx: Ctx, kind: ReportKind, q: ReportQuery, want: { pdf?: boolean; xlsx?: boolean }) {
  const { t, lang } = await getI18n();
  const { report, title } = await loadReport(ctx, kind, q);
  const files: { filename: string; content: Buffer; contentType: string }[] = [];
  if (want.pdf) {
    const { reportPdf } = await import("./pdf");
    const printed = new Intl.DateTimeFormat("en-GB", { timeZone: timeZoneOf(ctx.company.country), dateStyle: "medium", timeStyle: "short" }).format(new Date());
    files.push({
      filename: reportFileName(title, q.to, "pdf"), contentType: "application/pdf",
      content: await reportPdf({ company: ctx.company.name, title, period: report.period, currency: ctx.company.currency, lang, printed, pageLabel: t("r_page_of"), report }),
    });
  }
  if (want.xlsx) {
    const { reportWorkbook } = await import("./financial-reports");
    files.push({ filename: reportFileName(title, q.to, "xlsx"), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: await reportWorkbook(report, title, ctx.company.name, ctx.company.currency) });
  }
  return { files, title, report };
}

/** A download header that keeps accents and spaces in the name. */
export const attachmentHeader = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
