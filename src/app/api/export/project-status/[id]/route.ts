import { requireView } from "@/lib/auth";
import { isIsoDate, isUuid } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { statusWorkbook } from "@/lib/project-status";

/** The project implementation status as an Excel file. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireView("projects");
  const { id } = await params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const { t } = await getI18n();
  const to = new URL(req.url).searchParams.get("to");
  const file = await statusWorkbook(ctx, id, t, isIsoDate(to) ? to : undefined);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
