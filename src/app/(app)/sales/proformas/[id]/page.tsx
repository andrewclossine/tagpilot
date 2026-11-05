import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { cancelProforma, convertProforma } from "../actions";
import { ProformaForm } from "../ProformaForm";

export const metadata = { title: "Proforma" };

export default async function ProformaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("sales");
  const { t, err, money } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const [row] = await db.select({ p: schema.proformas, customer: schema.partners.name }).from(schema.proformas)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.proformas.partnerId))
    .where(and(eq(schema.proformas.id, id), eq(schema.proformas.companyId, ctx.company.id)));
  if (!row) notFound();
  const { p, customer } = row;
  const lines = await db.select().from(schema.proformaLines).where(eq(schema.proformaLines.proformaId, id)).orderBy(schema.proformaLines.lineNo);
  const write = ctx.can("sales", "write") && p.status === "open";
  if (q("edit") && write) {
    return (
      <div className="stack">
        <PageHead title={`${t("edit")}: ${p.number}`} />
        <ErrorNote message={err(q("error"))} />
        <ProformaForm ctx={ctx} proforma={p} lines={lines.map((l) => ({
          description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatApplies: l.vatApplies, accountId: l.accountId, projectId: l.projectId ?? "", itemId: l.itemId ?? "",
        }))} />
      </div>
    );
  }
  return (
    <div className="stack">
      <PageHead title={`${t("pf_proforma")} ${p.number}`}>
        <Link className="btn" href="/sales/proformas">{t("back")}</Link>
        <a className="btn" href={`/api/pdf/proforma/${p.id}`} target="_blank" rel="noreferrer">PDF</a>
        <Pill kind={p.status === "open" ? "open" : p.status === "converted" ? "paid" : "void"}>{t(`pf_${p.status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      <div className="panel stack">
        <div className="fields">
          <div><div className="label">{t("customer")}</div><b>{customer}</b></div>
          <div><div className="label">{t("date")}</div>{p.date}</div>
          <div><div className="label">{t("pf_valid_until")}</div>{p.validUntil}</div>
          {p.invoiceId ? <div><div className="label">{t("inv_invoice")}</div><Link href={`/sales/invoices/${p.invoiceId}`}>{t("pf_open_invoice")} →</Link></div> : null}
        </div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("description")}</th><th className="num">{t("qty")}</th><th className="num">{t("unit_price")}</th><th>{t("vat")}</th><th className="num">{t("amount")}</th></tr></thead>
          <tbody>
            {lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitPrice, 2)}</td><td>{l.vatApplies ? "✓" : ""}</td><td className="num">{money(l.amount, 2)}</td></tr>)}
            <tr><td colSpan={4} className="num">{t("subtotal")}</td><td className="num">{money(p.subtotal, 2)}</td></tr>
            <tr><td colSpan={4} className="num">{t("vat")}</td><td className="num">{money(p.vat, 2)}</td></tr>
            <tr className="total"><td colSpan={4} className="num">{t("total")}</td><td className="num">{money(p.total, 2)}</td></tr>
          </tbody>
        </table></div>
        {p.notes ? <div className="small">{p.notes}</div> : null}
      </div>
      {write ? (
        <div className="panel row">
          <form action={convertProforma}><input type="hidden" name="id" value={p.id} /><button type="submit" className="btn primary">{t("pf_convert")}</button></form>
          <Link className="btn" href={`/sales/proformas/${p.id}?edit=1`}>{t("edit")}</Link>
          <form action={cancelProforma}><input type="hidden" name="id" value={p.id} /><ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("cancel")}</ConfirmButton></form>
        </div>
      ) : null}
    </div>
  );
}
