import { requireView } from "@/lib/auth";
import { buildStatementPdf } from "@/lib/statements";
import { UserError } from "@/lib/ledger";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireView("sales");
  const url = new URL(req.url);
  try {
    const { pdf, filename } = await buildStatementPdf(ctx, (await params).id, url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "");
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof UserError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
