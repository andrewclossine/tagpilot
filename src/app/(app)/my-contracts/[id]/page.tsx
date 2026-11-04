import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import { myPartners } from "@/lib/bidding";
import { currentTerms, MAX_AMENDMENTS } from "@/lib/procurement";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { requestContractChange } from "../../adverts/actions";

export const metadata = { title: "Contract" };

export default async function MyContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("bidding");
  const { t, err, money } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const partners = await myPartners(db, ctx.company.id);
  if (!partners.length) notFound();
  const [row] = await db.select({ c: schema.contracts, buyer: schema.companies.name, currency: schema.companies.currency }).from(schema.contracts)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.contracts.companyId))
    .where(and(eq(schema.contracts.id, id), inArray(schema.contracts.partnerId, partners.map((p) => p.id))));
  if (!row) notFound();
  const { c, buyer, currency } = row;
  const [amendments, guarantees] = await Promise.all([
    db.select().from(schema.contractAmendments).where(eq(schema.contractAmendments.contractId, id)).orderBy(schema.contractAmendments.createdAt),
    db.select().from(schema.performanceGuarantees).where(eq(schema.performanceGuarantees.contractId, id)),
  ]);
  const terms = currentTerms(c, amendments);
  const pending = amendments.some((a) => a.status === "requested");
  const write = ctx.can("bidding", "write");
  return (
    <div className="stack">
      <PageHead title={`${c.number} · ${c.title}`}>
        <Link className="btn" href="/my-contracts">{t("back")}</Link>
        <Pill kind={c.status}>{t(`cs_${c.status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("adv_buyer")}</div><div>{buyer}</div></div>
        <div className="panel kpi"><div className="label">{t("ct_amount")} ({currency})</div><div className="v">{money(c.amount, 2)}</div></div>
        <div className="panel kpi"><div className="label">{t("ct_current_amount")} ({currency})</div><div className="v">{money(terms.amount, 2)}</div></div>
        <div className="panel kpi"><div className="label">{t("ct_end")}</div><div className="v">{terms.endDate}</div></div>
      </div>
      {c.attachmentId ? <div className="panel"><a href={`/api/files/${c.attachmentId}`} target="_blank" rel="noreferrer">{t("ct_signed_file")}</a></div> : null}
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
        {write && c.status === "active" && !pending && terms.approved < MAX_AMENDMENTS ? (
          <form action={requestContractChange} className="stack">
            <h3 style={{ margin: 0 }}>{t("ct_request_amendment")} ({t("ct_amendment_no")} {terms.approved + 1})</h3>
            <input type="hidden" name="contractId" value={c.id} />
            <label className="f">{t("ct_reason")}<textarea id="ma-reason" name="reason" rows={3} required /></label>
            <div className="fields">
              <label className="f">{t("ct_amount_change")}<input id="ma-change" name="amountChange" className="num" inputMode="decimal" /></label>
              <label className="f">{t("ct_new_end")}<input id="ma-end" name="newEndDate" type="date" /></label>
              <label className="f">{t("tn_file")}<input id="ma-file" name="file" type="file" accept="image/*,application/pdf" /></label>
            </div>
            <div><button type="submit" className="btn primary">{t("ct_request_amendment")}</button></div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
