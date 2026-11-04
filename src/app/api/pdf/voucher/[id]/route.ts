import { requireView } from "@/lib/auth";
import { buildVoucherPdf } from "@/lib/pdf-programs";
import { UserError } from "@/lib/ledger";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireView("vouchers");
  try {
    const { pdf, filename } = await buildVoucherPdf(ctx, (await params).id);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof UserError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
