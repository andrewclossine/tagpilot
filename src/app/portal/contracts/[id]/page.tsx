import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSupplier } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import { currentTerms, MAX_AMENDMENTS } from "@/lib/procurement";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { SupplierBillPanel } from "@/components/SupplierBillPanel";
import { sendPortalBill, supplierAmendment } from "../../actions";

export const metadata = { title: "Contract" };

export default async function PortalContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireSupplier();
  const { t, err, money } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const [c] = await db.select().from(schema.contracts).where(and(eq(schema.contracts.id, id), eq(schema.contracts.companyId, ctx.company.id), eq(schema.contracts.partnerId, ctx.partnerId)));
  if (!c) notFound();
  const [amendments, guarantees] = await Promise.all([
    db.select().from(schema.contractAmendments).where(eq(schema.contractAmendments.contractId, id)).orderBy(schema.contractAmendments.createdAt),
    db.select().from(schema.performanceGuarantees).where(eq(schema.performanceGuarantees.contractId, id)),
  ]);
  const terms = currentTerms(c, amendments);
  const pending = amendments.some((a) => a.status === "requested");
  const file = (attachmentId: string | null, label: string) => attachmentId ? <a href={`/api/files/${attachmentId}`} target="_blank" rel="noreferrer">{label}</a> : null;
  return (
    <div className="stack">
      <PageHead title={`${c.number} · ${c.title}`}>
        <Link className="btn" href="/portal/contracts">{t("back")}</Link>
        <Pill kind={c.status}>{t(`cs_${c.status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("ct_amount")}</div><div className="v">{money(c.amount, 2)}</div></div>
        <div className="panel kpi"><div className="label">{t("ct_current_amount")}</div><div className="v">{money(terms.amount, 2)}</div></div>
        <div className="panel kpi"><div className="label">{t("ct_end")}</div><div className="v">{terms.endDate}</div></div>
      </div>
      {c.attachmentId ? <div className="panel">{file(c.attachmentId, t("ct_signed_file"))}</div> : null}
      <SupplierBillPanel contractId={c.id} currency={ctx.company.currency} canSend={c.status === "active" && !ctx.locked} action={sendPortalBill} />
      {guarantees.length ? (
        <div className="panel stack">
          <h2>{t("ct_guarantees")}</h2>
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("type")}</th><th>{t("reference")}</th><th className="num">{t("amount")}</th><th>{t("ct_expiry")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{guarantees.map((g) => (
              <tr key={g.id}><td>{g.kind}</td><td>{g.reference}</td><td className="num">{money(g.amount, 2)}</td><td>{g.expiryDate}</td><td><Pill kind={g.status}>{t(`gs_${g.status}`)}</Pill></td></tr>
            ))}</tbody>
          </table></div>
        </div>
      ) : null}
      <div className="panel stack">
        <h2>{t("ct_amendments")} <span className="muted small">{terms.approved} / {MAX_AMENDMENTS}</span></h2>
        {amendments.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("ct_reason")}</th><th className="num">{t("ct_amount_change")}</th><th>{t("ct_new_end")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{amendments.map((a) => (
              <tr key={a.id}>
                <td>{a.no}</td><td style={{ whiteSpace: "pre-wrap" }}>{a.reason}{a.decisionNote ? <div className="small muted">{a.decisionNote}</div> : null}</td>
                <td className="num">{a.amountChange > 0 ? "+" : ""}{money(a.amountChange, 2)}</td><td>{a.newEndDate ?? ""}</td>
                <td><Pill kind={a.status}>{t(`as_${a.status}`)}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : null}
        {c.status === "active" && !pending && terms.approved < MAX_AMENDMENTS && !ctx.locked ? (
          <form action={supplierAmendment} className="stack">
            <h3 style={{ margin: 0 }}>{t("ct_request_amendment")} ({t("ct_amendment_no")} {terms.approved + 1})</h3>
            <input type="hidden" name="contractId" value={c.id} />
            <label className="f">{t("ct_reason")}<textarea id="pa-reason" name="reason" rows={3} required /></label>
            <div className="fields">
              <label className="f">{t("ct_amount_change")}<input id="pa-change" name="amountChange" className="num" inputMode="decimal" /></label>
              <label className="f">{t("ct_new_end")}<input id="pa-end" name="newEndDate" type="date" /></label>
              <label className="f">{t("tn_file")}<input id="pa-file" name="file" type="file" accept="image/*,application/pdf" /></label>
            </div>
            <div><button type="submit" className="btn primary">{t("ct_request_amendment")}</button></div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
