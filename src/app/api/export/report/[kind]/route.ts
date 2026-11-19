import { requireView } from "@/lib/auth";
import { isReportKind, reportArea } from "@/lib/reports";
import { attachmentHeader, readQuery, reportFiles } from "@/lib/report-view";

/** Any report as an Excel file, with the dates, columns and title chosen on the page. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isReportKind(kind)) return new Response("Not found", { status: 404 });
  const ctx = await requireView(reportArea(kind));
  const q = new URL(req.url).searchParams;
  const { files } = await reportFiles(ctx, kind, readQuery(ctx, (k) => q.get(k)), { xlsx: true });
  const f = files[0];
  return new Response(new Uint8Array(f.content), {
    headers: { "Content-Type": f.contentType, "Content-Disposition": attachmentHeader(f.filename), "Cache-Control": "private, no-store" },
  });
}
