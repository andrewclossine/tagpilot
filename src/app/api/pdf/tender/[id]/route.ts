import { getCtx } from "@/lib/auth";
import { buildTenderPdf } from "@/lib/pdf-programs";
import { UserError } from "@/lib/ledger";

/** The tender document, or one of its later documents with ?stage=. Who may read which is checked when it is built. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  try {
    const { pdf, filename } = await buildTenderPdf(ctx, (await params).id, new URL(req.url).searchParams.get("stage"));
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof UserError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
