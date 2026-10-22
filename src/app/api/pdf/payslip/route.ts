import { requireView } from "@/lib/auth";
import { buildPayslipPdf } from "@/lib/pdf-data";
import { UserError } from "@/lib/ledger";

export async function GET(req: Request) {
  const ctx = await requireView("payroll");
  const url = new URL(req.url);
  try {
    const { pdf, filename } = await buildPayslipPdf(ctx, url.searchParams.get("run") ?? "", Number(url.searchParams.get("row")));
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof UserError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
