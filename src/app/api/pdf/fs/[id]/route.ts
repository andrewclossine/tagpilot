import { requireView } from "@/lib/auth";
import { fsFigures, fsTokens, loadDraft } from "@/lib/fs";
import { fsPdf } from "@/lib/pdf-fs";
import { printedCompany } from "@/lib/pdf-data";
import { isUuid } from "@/lib/format";

/** The financial statements as a PDF, with today's figures from the ledger. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireView("reports");
  const { id } = await params;
  const draft = isUuid(id) ? await loadDraft(ctx.company.id, id) : null;
  if (!draft) return new Response("Not found", { status: 404 });
  const { d, notes } = draft;
  const f = await fsFigures(ctx.company.id, d.periodFrom, d.periodTo, d.comparative, d.lang);
  const company = await printedCompany(ctx);
  const pdf = await fsPdf(d, notes, f, { name: company.name, currency: company.currency, registrationNo: company.registrationNo, tin: company.tin, logo: company.logo, orgType: company.orgType, place: company.city || company.country || "" }, fsTokens(d, company, f));
  const filename = `${d.title.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" },
  });
}
