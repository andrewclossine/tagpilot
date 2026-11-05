import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { isUuid, money as fmtMoney } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { letterPdf } from "@/lib/pdf";
import { printedCompany } from "@/lib/pdf-data";

/** The purchase order to send to the supplier. Procurement and Accounting can both print it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  const { id } = await params;
  const full = ctx.can("procurement");
  if (!isUuid(id) || (!full && !ctx.can("purchases"))) return new Response("Not found", { status: 404 });
  const { t, lang } = await getI18n();
  const db = await getDb();
  const [row] = await db.select({ o: schema.purchaseOrders, vendor: schema.partners, project: schema.projects }).from(schema.purchaseOrders)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.purchaseOrders.partnerId)).innerJoin(schema.projects, eq(schema.projects.id, schema.purchaseOrders.projectId))
    .where(and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.companyId, ctx.company.id), ...(full ? [] : [inArray(schema.purchaseOrders.status, ["issued", "closed"] as ("issued" | "closed")[])])));
  if (!row) return new Response("Not found", { status: 404 });
  const { o, vendor, project } = row;
  const lines = await db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.orderId, id)).orderBy(asc(schema.purchaseOrderLines.lineNo));
  const amount = (n: number) => fmtMoney(n, lang, 2).replace(/[  ]/g, " ");
  const pdf = await letterPdf({
    company: await printedCompany(ctx), title: t("po_title"), footer: t("pdf_footer"), subject: `${t("supplier")}: ${vendor.name}`,
    addressee: [vendor.address, vendor.tin ? `${t("tin")}: ${vendor.tin}` : ""].filter(Boolean).join("\n") || undefined,
    lines: [[t("number"), o.number], [t("po_project_short"), project.code], [t("date"), o.date], ...(o.expectedDate ? [[t("po_expected"), o.expectedDate] as [string, string]] : [])],
    body: [`${t("po_project")}: ${project.code} - ${project.name}`, o.notes].filter(Boolean).join("\n\n"),
    columns: [{ label: t("description"), width: 225 }, { label: t("qty"), width: 60, align: "right" }, { label: t("unit_price"), width: 105, align: "right" }, { label: t("amount"), width: 105, align: "right" }],
    rows: [
      ...lines.map((l) => [l.description, String(l.quantity), amount(l.unitPrice), amount(l.amount)]),
      ...(o.vat ? [["", "", t("vat"), amount(o.vat)]] : []),
      ["", "", `${t("total")} ${ctx.company.currency}`, amount(o.total)],
    ],
  });
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${o.number}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
