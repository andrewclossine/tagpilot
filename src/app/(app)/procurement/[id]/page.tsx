import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid, today } from "@/lib/format";
import { biddingOpen, countBids, isSealed, standstillEnds } from "@/lib/procurement";
import type { TenderStage } from "@/db/schema";
import { ConfirmButton } from "@/components/editors";
import { LocalTime } from "@/components/datetime";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { addTenderForm, cancelTender, evaluateBids, publishTender, recordStage, removeTenderForm } from "../actions";
import { TenderSummary } from "@/components/TenderSummary";
import { TenderForm } from "../TenderForm";

export const metadata = { title: "Procurement" };

const ORDER: TenderStage[] = ["opening", "evaluation", "provisional", "final", "negotiation", "minutes", "draft_contract", "signed"];

export default async function TenderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("procurement");
  const { t, err, money } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const [tender] = await db.select().from(schema.tenders).where(and(eq(schema.tenders.id, id), eq(schema.tenders.companyId, ctx.company.id)));
  if (!tender) notFound();
  const write = ctx.can("procurement", "write");
  if (q("edit") && tender.status === "draft" && write) {
    return (
      <div className="stack">
        <PageHead title={`${t("edit")}: ${tender.number}`} />
        <ErrorNote message={err(q("error"))} />
        <TenderForm ctx={ctx} kind={tender.kind} tender={tender} />
      </div>
    );
  }

  const sealed = isSealed(tender);
  const [stages, invites, suppliers, bidCount] = await Promise.all([
    db.select().from(schema.tenderStages).where(eq(schema.tenderStages.tenderId, id)),
    db.select().from(schema.tenderInvites).where(eq(schema.tenderInvites.tenderId, id)),
    db.select().from(schema.partners).where(and(eq(schema.partners.companyId, ctx.company.id), inArray(schema.partners.kind, ["supplier", "both"]))).orderBy(schema.partners.name),
    countBids(db, id),
  ]);
  // Sealed bids are never read here: only how many have arrived.
  const bids = sealed ? [] : await db.select({ b: schema.bids, partner: schema.partners.name }).from(schema.bids)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.bids.partnerId)).where(eq(schema.bids.tenderId, id));
  const accounts = await db.select({ partnerId: schema.memberships.partnerId }).from(schema.memberships)
    .where(and(eq(schema.memberships.companyId, ctx.company.id), eq(schema.memberships.role, "supplier")));
  const hasAccount = (partnerId: string) => accounts.some((a) => a.partnerId === partnerId);
  const stageOf = (s: TenderStage) => stages.find((x) => x.stage === s);
  const winner = bids.find((x) => x.b.isWinner);
  const sorted = [...bids].sort((a, b) => (a.b.rank ?? 999) - (b.b.rank ?? 999) || a.b.amount - b.b.amount);
  const closed = !!tender.deadline && tender.deadline.getTime() <= Date.now();
  const provisional = stageOf("provisional");
  const finalFrom = provisional ? standstillEnds(provisional.date, tender.standstillDays) : "";

  // The step that comes next, with the wording it starts from.
  const next: TenderStage | null = ({
    published: closed ? "opening" : null, opened: "evaluation", evaluated: "provisional", provisional: "final", final: "negotiation",
    negotiation: "minutes", negotiated: "draft_contract", draft_contract: "signed",
  } as Partial<Record<typeof tender.status, TenderStage>>)[tender.status] ?? null;
  const fill = (s: string) => s.replace("{number}", tender.number).replace("{title}", tender.title)
    .replace("{winner}", winner?.partner ?? "").replace("{amount}", `${money(winner?.b.amount ?? 0, 2)} ${ctx.company.currency}`).replace("{date}", finalFrom);
  const draftBody: Partial<Record<TenderStage, string>> = {
    opening: fill(t("tpl_opening")), provisional: fill(t("tpl_provisional")), final: fill(t("tpl_final")),
    negotiation: fill(t("tpl_negotiation")), minutes: "", draft_contract: fill(t("tpl_draft_contract")), signed: "",
  };
  const fileLink = (attachmentId: string | null, label: string) => attachmentId ? <a href={`/api/files/${attachmentId}`} target="_blank" rel="noreferrer">{label}</a> : null;

  return (
    <div className="stack">
      <PageHead title={`${tender.number} · ${tender.title}`}>
        <Link className="btn" href="/procurement">{t("back")}</Link>
        <a className="btn" href={`/api/pdf/tender/${id}`} target="_blank" rel="noreferrer">PDF</a>
        <Pill kind={tender.status}>{t(`ts_${tender.status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />

      {tender.status !== "cancelled" ? (
        <ol className="steps">
          {ORDER.map((s) => <li key={s} className={stageOf(s) ? "done" : s === next ? "now" : ""}>{t(`stage_${s}`)}</li>)}
        </ol>
      ) : null}

      <div className="grid2">
        <div className="panel stack">
          <TenderSummary tender={tender}
            formActions={tender.status === "draft" && write ? (f) => (
              <form action={removeTenderForm}><input type="hidden" name="id" value={tender.id} /><input type="hidden" name="formId" value={f.id} /><ConfirmButton className="btn sm ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
            ) : undefined} />
          {tender.status === "draft" && write ? (
            <form action={addTenderForm} className="stack" id="forms" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <h3>{t("tn_add_form")}</h3>
              <div className="small muted">{t("tn_add_form_help")}</div>
              <input type="hidden" name="id" value={tender.id} />
              <label className="f">{t("tn_form_description")}<input id="tf-description" name="description" required placeholder={t("tn_form_example")} /></label>
              <label className="f">{t("tn_form_file")}<input id="tf-file" name="file" type="file" required accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,image/*" /></label>
              <div><button type="submit" className="btn">{t("tn_add_form")}</button></div>
            </form>
          ) : null}
          {tender.status === "draft" && write ? <div><Link className="btn" href={`/procurement/${id}?edit=1`}>{t("edit")}</Link></div> : null}
        </div>

        {tender.status === "draft" && write ? (
          <form action={publishTender} className="panel stack">
            <h2>{t("tn_invite")}</h2>
            <input type="hidden" name="id" value={id} />
            {tender.openToAll ? <div className="note info small">{t("tn_open_to_all")}</div> : null}
            {suppliers.length ? suppliers.map((p) => (
              <label key={p.id} className="row small" style={{ gap: 8 }}>
                <input id={`inv-${p.id}`} name="invite" value={p.id} type="checkbox" style={{ width: "auto" }} defaultChecked={invites.some((i) => i.partnerId === p.id)} />
                {p.name}{hasAccount(p.id) ? null : <span className="muted"> · {t("tn_no_account")}</span>}
              </label>
            )) : <div className="small muted">{t("nothing_yet")}</div>}
            <div className="small"><Link href="/procurement/suppliers">{t("nav_supplier_accounts")} →</Link></div>
            <div><button type="submit" className="btn primary">{t("tn_publish")}</button></div>
          </form>
        ) : (
          <div className="panel stack">
            <h2>{t("tn_bids")}</h2>
            {sealed ? (
              <div className="note info small">
                <b>{t("tn_sealed")}</b> {t("tn_sealed_help").replace("{n}", String(bidCount))}
                {tender.status === "published" && biddingOpen(tender) ? null : tender.status === "published" ? <div>{t("tn_ready_to_open")}</div> : null}
              </div>
            ) : (
              <div className="tbl-wrap"><table>
                <thead><tr><th>{t("supplier")}</th><th className="num">{t("amount")}</th><th className="num">{t("tn_tech")}</th><th className="num">{t("tn_fin")}</th><th className="num">{t("total")}</th><th className="num">{t("tn_rank")}</th></tr></thead>
                <tbody>{sorted.map(({ b, partner }) => (
                  <tr key={b.id} style={b.isWinner ? { background: "var(--ok-soft)" } : undefined}>
                    <td><b>{partner}</b>{b.note ? <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>{b.note}</div> : null}
                      {b.attachmentId ? <div className="small">{fileLink(b.attachmentId, t("tn_bid_file"))}</div> : null}
                      {b.responsive === false ? <div className="small" style={{ color: "var(--bad)" }}>{t("tn_not_responsive")}{b.evaluationNote ? `: ${b.evaluationNote}` : ""}</div> : null}</td>
                    <td className="num">{money(b.amount, 2)}</td>
                    <td className="num">{b.technicalScore ?? ""}</td><td className="num">{b.financialScore ?? ""}</td>
                    <td className="num">{b.totalScore ?? ""}</td><td className="num">{b.rank ?? ""}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        )}
      </div>

      {ORDER.filter((s) => stageOf(s)).map((s) => {
        const st = stageOf(s)!;
        return (
          <div key={s} className="panel stack">
            <div className="row">
              <h2 style={{ flex: 1 }}>{t(`stage_${s}`)}</h2>
              <span className="small muted">{st.date}</span>
              {fileLink(st.attachmentId, t("tn_file"))}
              <a className="btn sm" href={`/api/pdf/tender/${id}?stage=${s}`} target="_blank" rel="noreferrer">PDF</a>
            </div>
            {st.body ? <div style={{ whiteSpace: "pre-wrap" }}>{st.body}</div> : null}
          </div>
        );
      })}

      {write && (tender.status === "opened" || tender.status === "evaluated") ? (
        <form action={evaluateBids} className="panel stack">
          <h2>{t("stage_evaluation")}</h2>
          <div className="small muted">{t("tn_eval_help").replace("{w}", String(tender.technicalWeight))}</div>
          <input type="hidden" name="id" value={id} />
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("supplier")}</th><th className="num">{t("amount")}</th><th>{t("tn_responsive")}</th><th>{t("tn_tech")}</th><th>{t("notes")}</th><th>{t("tn_winner")}</th></tr></thead>
            <tbody>{sorted.map(({ b, partner }) => (
              <tr key={b.id}>
                <td><b>{partner}</b></td><td className="num">{money(b.amount, 2)}</td>
                <td><input id={`r-${b.id}`} name={`responsive_${b.id}`} type="checkbox" style={{ width: "auto" }} defaultChecked={b.responsive ?? true} aria-label={t("tn_responsive")} /></td>
                <td><input id={`t-${b.id}`} name={`technical_${b.id}`} className="num" style={{ width: 90 }} inputMode="decimal" defaultValue={b.technicalScore ?? (tender.technicalWeight ? "" : 0)} aria-label={t("tn_tech")} /></td>
                <td><input id={`n-${b.id}`} name={`note_${b.id}`} defaultValue={b.evaluationNote} aria-label={t("notes")} /></td>
                <td><input id={`w-${b.id}`} name="winnerId" value={b.id} type="radio" style={{ width: "auto" }} defaultChecked={b.isWinner} aria-label={t("tn_winner")} /></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="small muted">{t("tn_winner_help")}</div>
          <div className="fields">
            <label className="f">{t("date")}<input id="e-date" name="date" type="date" required defaultValue={stageOf("evaluation")?.date ?? today()} /></label>
            <label className="f">{t("tn_file")}<input id="e-file" name="file" type="file" accept="image/*,application/pdf" /></label>
          </div>
          <label className="f">{t("tn_eval_report")}<textarea id="e-body" name="body" rows={4} defaultValue={stageOf("evaluation")?.body} /></label>
          <div><button type="submit" className="btn primary">{t("tn_save_evaluation")}</button></div>
        </form>
      ) : null}

      {write && next && next !== "evaluation" ? (
        <form action={recordStage} className="panel stack" key={next}>
          <h2>{t(`stage_${next}`)}</h2>
          <input type="hidden" name="id" value={id} /><input type="hidden" name="stage" value={next} />
          {next === "final" && finalFrom > today() ? <div className="note warn small">{t("tn_standstill_wait").replace("{date}", finalFrom)}</div> : null}
          <div className="fields">
            <label className="f">{t("date")}<input id="s-date" name="date" type="date" required defaultValue={today()} /></label>
            <label className="f">{t("tn_file")}{next === "signed" || next === "draft_contract" ? " *" : ""}<input id="s-file" name="file" type="file" accept="image/*,application/pdf" required={next === "signed" || next === "draft_contract"} /></label>
            {next === "signed" ? <>
              <label className="f">{t("ct_start")}<input id="s-start" name="startDate" type="date" required defaultValue={today()} /></label>
              <label className="f">{t("ct_end")}<input id="s-end" name="endDate" type="date" required /></label>
              <label className="f">{t("ct_amount")}<input id="s-amount" name="amount" className="num" inputMode="decimal" required defaultValue={winner?.b.amount || ""} /></label>
            </> : null}
          </div>
          <label className="f">{t(next === "minutes" ? "tn_minutes_text" : "tn_text")}<textarea id="s-body" name="body" rows={6} defaultValue={draftBody[next]} /></label>
          <div className="row">
            <button type="submit" className="btn primary">{t("tn_record")}: {t(`stage_${next}`)}</button>
            {next === "negotiation" ? <SkipNegotiation id={id} label={t("tn_skip_negotiation")} /> : null}
          </div>
        </form>
      ) : null}

      {write && tender.status === "final" ? (
        <form action={recordStage} className="panel stack" key="skip">
          <h2>{t("stage_draft_contract")}</h2>
          <div className="small muted">{t("tn_skip_negotiation")}</div>
          <input type="hidden" name="id" value={id} /><input type="hidden" name="stage" value="draft_contract" />
          <div className="fields">
            <label className="f">{t("date")}<input id="d-date" name="date" type="date" required defaultValue={today()} /></label>
            <label className="f">{t("tn_file")} *<input id="d-file" name="file" type="file" accept="image/*,application/pdf" required /></label>
          </div>
          <label className="f">{t("tn_text")}<textarea id="d-body" name="body" rows={3} defaultValue={draftBody.draft_contract} /></label>
          <div><button type="submit" className="btn">{t("tn_record")}: {t("stage_draft_contract")}</button></div>
        </form>
      ) : null}

      {write && tender.status !== "signed" && tender.status !== "cancelled" ? (
        <form action={cancelTender}>
          <input type="hidden" name="id" value={id} />
          <ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("tn_cancel")}</ConfirmButton>
        </form>
      ) : null}
    </div>
  );
}

function SkipNegotiation({ id, label }: { id: string; label: string }) {
  return <a className="btn ghost" href={`/procurement/${id}#d-date`}>{label}</a>;
}
