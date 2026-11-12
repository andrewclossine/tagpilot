import { requireView } from "@/lib/auth";
import { isIsoDate, today } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { reportWorkbook } from "@/lib/financial-reports";
import { buildReport, isReportKind, REPORT_TITLES, reportArea } from "@/lib/reports";

/** A report as an Excel file. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isReportKind(kind)) return new Response("Not found", { status: 404 });
  const ctx = await requireView(reportArea(kind));
  const { t, accName } = await getI18n();
  const q = new URL(req.url).searchParams;
  const fromQ = q.get("from"), toQ = q.get("to");
  const from = isIsoDate(fromQ) ? fromQ : `${today().slice(0, 4)}-01-01`;
  const to = isIsoDate(toQ) ? toQ : today();
  const report = await buildReport(kind, { companyId: ctx.company.id, apAccount: ctx.company.settings.apAccount, arAccount: ctx.company.settings.arAccount, from, to, account: q.get("account") ?? undefined, t, accName });
  const buffer = await reportWorkbook(report, t(REPORT_TITLES[kind]), ctx.company.name, ctx.company.currency);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${kind}-${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
