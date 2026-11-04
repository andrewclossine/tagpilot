import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { addDays, isUuid, today } from "@/lib/format";
import { currentTerms, MAX_AMENDMENTS } from "@/lib/procurement";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead, Pill } from "@/components/ui";
import { addGuarantee, askAmendment, decideOnAmendment, setContractStatus, setGuaranteeStatus } from "../actions";

export const metadata = { title: "Contract" };

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("contracts");
  const { t, err, money } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const [row] = await db.select({ c: schema.contracts, partner: schema.partners.name, tender: schema.tenders.number }).from(schema.contracts)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.contracts.partnerId))
    .leftJoin(schema.tenders, eq(schema.tenders.id, schema.contracts.tenderId))
    .where(and(eq(schema.contracts.id, id), eq(schema.contracts.companyId, ctx.company.id)));
  if (!row) notFound();
  const { c, partner, tender } = row;
  const [amendments, guarantees, [paid]] = await Promise.all([
    db.select().from(schema.contractAmendments).where(eq(schema.contractAmendments.contractId, id)).orderBy(schema.contractAmendments.createdAt),
    db.select().from(schema.performanceGuarantees).where(eq(schema.performanceGuarantees.contractId, id)).orderBy(schema.performanceGuarantees.expiryDate),
    db.select({ total: sql<string>`coalesce(sum(${schema.paymentVouchers.amount}), 0)` }).from(schema.paymentVouchers)
      .where(and(eq(schema.paymentVouchers.contractId, id), inArray(schema.paymentVouchers.status, ["paid"]))),
  ]);
  const terms = currentTerms(c, amendments);
  const write = ctx.can("contracts", "write");
  const pending = amendments.find((a) => a.status === "requested");
  const soon = addDays(today(), 30);
  const file = (attachmentId: string | null, label: string) => attachmentId ? <a href={`/api/files/${attachmentId}`} target="_blank" rel="noreferrer">{label}</a> : null;

  return (
    <div className="stack">
      <PageHead title={`${c.number} · ${c.title}`}>
        <Link className="btn" href="/contracts">{t("back")}</Link>
        <Pill kind={c.status}>{t(`cs_${c.status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("ct_amount")}</div><div className="v">{money(c.amount, 2)}</div></div>
        <div className="panel kpi"><div className="label">{t("ct_current_amount")}</div><div className="v">{money(terms.amount, 2)}</div></div>
        <div className="panel kpi"><div className="label">{t("ct_paid")}</div><div className="v">{money(Number(paid.total), 2)}</div></div>
        <div className="panel kpi"><div className="label">{t("ct_end")}</div><div className="v">{terms.endDate}</div></div>
      </div>
      <div className="panel stack">
        <div className="fields">
          <div><div className="label">{t("supplier")}</div>{partner}</div>
          <div><div className="label">{t("ct_signed_date")}</div>{c.signedDate}</div>
          <div><div className="label">{t("ct_start")}</div>{c.startDate}</div>
          {tender ? <div><div className="label">{t("tn_title")}</div><Link href={`/procurement/${c.tenderId}`}>{tender}</Link></div> : null}
        </div>
        {c.scope ? <div style={{ whiteSpace: "pre-wrap" }}>{c.scope}</div> : null}
        {file(c.attachmentId, t("ct_signed_file"))}
        {write ? (
          <form action={setContractStatus} className="row">
            <input type="hidden" name="id" value={c.id} />
            {c.status === "active" ? <>
              <button type="submit" name="status" value="completed" className="btn sm">{t("ct_complete")}</button>
              <button type="submit" name="status" value="terminated" className="btn sm danger">{t("ct_terminate")}</button>
            </> : <button type="submit" name="status" value="active" className="btn sm">{t("ct_reopen")}</button>}
          </form>
        ) : null}
      </div>

      <div className="panel stack">
        <h2>{t("ct_guarantees")}</h2>
        {guarantees.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("type")}</th><th>{t("ct_issuer")}</th><th>{t("reference")}</th><th className="num">{t("amount")}</th><th>{t("ct_expiry")}</th><th>{t("status")}</th><th /></tr></thead>
            <tbody>{guarantees.map((g) => (
              <tr key={g.id}>
                <td>{g.kind}</td><td>{g.issuer}</td><td>{g.reference}<div className="small">{file(g.attachmentId, t("tn_file"))}</div></td>
                <td className="num">{money(g.amount, 2)}</td>
                <td style={{ color: g.status === "active" && g.expiryDate <= soon ? "var(--bad)" : undefined }}>{g.expiryDate}</td>
                <td><Pill kind={g.status}>{t(`gs_${g.status}`)}</Pill></td>
                <td>{write && g.status === "active" ? (
                  <form action={setGuaranteeStatus} className="row" style={{ gap: 4 }}>
                    <input type="hidden" name="id" value={g.id} /><input type="hidden" name="contractId" value={c.id} />
                    <button type="submit" name="status" value="released" className="btn ghost sm">{t("ct_release")}</button>
                    <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")} name="status" value="called">{t("ct_call")}</ConfirmButton>
                  </form>
                ) : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
        {write ? (
          <form action={addGuarantee} className="stack">
            <input type="hidden" name="contractId" value={c.id} />
            <div className="fields">
              <label className="f">{t("type")}<input id="g-kind" name="kind" list="g-kinds" /></label>
              <datalist id="g-kinds"><option value={t("ct_bank_guarantee")} /><option value={t("ct_insurance_bond")} /></datalist>
              <label className="f">{t("ct_issuer")}<input id="g-issuer" name="issuer" /></label>
              <label className="f">{t("reference")}<input id="g-reference" name="reference" /></label>
              <label className="f">{t("amount")}<input id="g-amount" name="amount" className="num" inputMode="decimal" required /></label>
              <label className="f">{t("ct_issue")}<input id="g-issue" name="issueDate" type="date" required defaultValue={today()} /></label>
              <label className="f">{t("ct_expiry")}<input id="g-expiry" name="expiryDate" type="date" required /></label>
              <label className="f">{t("tn_file")}<input id="g-file" name="file" type="file" accept="image/*,application/pdf" /></label>
            </div>
            <div><button type="submit" className="btn">{t("ct_add_guarantee")}</button></div>
          </form>
        ) : null}
      </div>

      <div className="panel stack">
        <h2>{t("ct_amendments")} <span className="muted small">{terms.approved} / {MAX_AMENDMENTS}</span></h2>
        {amendments.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("ct_reason")}</th><th className="num">{t("ct_amount_change")}</th><th>{t("ct_new_end")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{amendments.map((a) => (
              <tr key={a.id}>
                <td>{a.no}</td>
                <td style={{ whiteSpace: "pre-wrap" }}>{a.reason}{a.fromSupplier ? <div className="small muted">{t("ct_from_supplier")}</div> : null}{a.decisionNote ? <div className="small muted">{a.decisionNote}</div> : null}<div className="small">{file(a.attachmentId, t("tn_file"))}</div></td>
                <td className="num">{a.amountChange > 0 ? "+" : ""}{money(a.amountChange, 2)}</td>
                <td>{a.newEndDate ?? ""}</td>
                <td><Pill kind={a.status}>{t(`as_${a.status}`)}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
        {write && pending ? (
          <form action={decideOnAmendment} className="stack">
            <h3 style={{ margin: 0 }}>{t("ct_amendment_no")} {pending.no}</h3>
            <input type="hidden" name="id" value={pending.id} /><input type="hidden" name="contractId" value={c.id} />
            <label className="f">{t("pv_decision_note")}<input id="a-note" name="note" /></label>
            <div className="row">
              <button type="submit" name="decision" value="approve" className="btn primary">{t("pv_approve")}</button>
              <button type="submit" name="decision" value="reject" className="btn danger">{t("pv_reject")}</button>
            </div>
          </form>
        ) : write && c.status === "active" && terms.approved < MAX_AMENDMENTS ? (
          <form action={askAmendment} className="stack">
            <h3 style={{ margin: 0 }}>{t("ct_request_amendment")} ({t("ct_amendment_no")} {terms.approved + 1})</h3>
            <input type="hidden" name="contractId" value={c.id} />
            <label className="f">{t("ct_reason")}<textarea id="a-reason" name="reason" rows={3} required /></label>
            <div className="fields">
              <label className="f">{t("ct_amount_change")}<input id="a-change" name="amountChange" className="num" inputMode="decimal" /></label>
              <label className="f">{t("ct_new_end")}<input id="a-end" name="newEndDate" type="date" /></label>
              <label className="f">{t("tn_file")}<input id="a-file" name="file" type="file" accept="image/*,application/pdf" /></label>
            </div>
            <div><button type="submit" className="btn">{t("ct_request_amendment")}</button></div>
          </form>
        ) : terms.approved >= MAX_AMENDMENTS ? <div className="note warn small">{t("err_amendment_limit")}</div> : null}
      </div>
    </div>
  );
}
