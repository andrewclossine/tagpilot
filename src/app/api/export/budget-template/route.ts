import { requireView } from "@/lib/auth";
import { budgetTemplate } from "@/lib/budget-template";
import { getI18n } from "@/lib/i18n";

/** The empty budget template, to fill in Excel and upload. */
export async function GET() {
  const ctx = await requireView("projects");
  const { t } = await getI18n();
  const buffer = await budgetTemplate(t, ctx.company.currency);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tagpilot-budget-template.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
