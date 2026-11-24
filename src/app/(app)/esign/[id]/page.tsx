import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid, localDateTime, timeZoneOf } from "@/lib/format";
import { loadDoc, SIGNER_COLORS, signLink, whoseTurn } from "@/lib/esign";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { deleteEsign, remindSigner, saveEsignDraft, voidEsign } from "../actions";
import { EsignPrepare } from "../EsignPrepare";
import { CopyLink } from "../CopyLink";

export const metadata = { title: "Document" };

const PILL: Record<string, string> = { draft: "draft", sent: "sent", completed: "paid", declined: "void", voided: "void" };

/** A document: prepared while a draft, then followed as each signer signs, with its audit trail and signed copy. */
export default async function EsignDocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("esign");
  const { t, err } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const loaded = await loadDoc(db, ctx.company.id, id);
  if (!loaded) notFound();
  const { doc, signers, fields } = loaded;
  const write = ctx.can("esign", "write");
  const tz = timeZoneOf(ctx.company.country);
  const fileUrl = `/api/esign/${doc.id}/file`;
  const notes = (
    <>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {q("sent") ? <div className="note ok small">{t("es_sent_note")}</div> : null}
      {q("reminded") ? <div className="note ok small">{t("es_reminded")}</div> : null}
    </>
  );

  if (doc.status === "draft" && write) {
    const types = { signature: t("es_f_signature"), initials: t("es_f_initials"), date: t("es_f_date"), name: t("es_f_name"), text: t("es_f_text"), checkbox: t("es_f_checkbox") };
    return (
      <div className="stack">
        <PageHead title={`${t("es_prepare")}: ${doc.title}`}>
          <Pill kind="draft">{t("es_st_draft")}</Pill>
          <form action={deleteEsign}><input type="hidden" name="id" value={doc.id} /><ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
          <Link className="btn ghost" href="/esign">{t("back")}</Link>
        </PageHead>
        {notes}
        <EsignPrepare id={doc.id} fileUrl={fileUrl} pages={doc.pages} colors={SIGNER_COLORS} action={saveEsignDraft}
          initial={{
            title: doc.title, message: doc.message, ordered: doc.ordered,
            signers: signers.map((s) => ({ key: s.id, name: s.name, email: s.email, order: s.order })),
            fields: fields.map((f) => ({ key: f.id, signer: f.signerId, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label })),
          }}
          labels={{
            title: t("es_doc_title"), signers: t("es_signers"), add_signer: t("es_add_signer"), name: t("name"), email: t("email"), email_help: t("es_email_help"),
            order: t("es_order"), ordered: t("es_ordered"), ordered_help: t("es_ordered_help"), message: t("es_message"), message_help: t("es_message_help"),
            fields: t("es_fields"), fields_help: t("es_fields_help"), placing: t("es_placing"), signer_for: t("es_signer_for"), required: t("es_required"),
            delete: t("delete"), save: t("es_save_draft"), send: t("es_send"), send_help: t("es_send_help"), loading: t("es_loading"), remove: t("remove"),
            count: t("es_field_count"), none_placed: t("es_none_placed"), types,
          }} />
      </div>
    );
  }

  const events = await db.select({ e: schema.esignEvents, user: schema.users.name }).from(schema.esignEvents).leftJoin(schema.users, eq(schema.users.id, schema.esignEvents.userId))
    .where(eq(schema.esignEvents.documentId, doc.id)).orderBy(asc(schema.esignEvents.at));
  const turn = new Set(whoseTurn(doc, signers).map((s) => s.id));
  const names = new Map(signers.map((s) => [s.id, s.name]));
  return (
    <div className="stack">
      <PageHead title={doc.title}>
        <Pill kind={PILL[doc.status]}>{t(`es_st_${doc.status}` as Key)}</Pill>
        {doc.finalAttachmentId ? <a className="btn primary" href={`${fileUrl}?kind=signed`} target="_blank" rel="noreferrer">{t("es_download_signed")}</a> : null}
        <a className="btn" href={fileUrl} target="_blank" rel="noreferrer">{t("es_original")}</a>
        <Link className="btn ghost" href="/esign">{t("back")}</Link>
      </PageHead>
      {notes}
      {doc.status === "voided" ? <div className="note bad small">{t("es_voided_note")} {doc.voidReason}</div> : null}
      {doc.status === "declined" ? <div className="note bad small">{t("es_declined_note")} {signers.filter((s) => s.status === "declined").map((s) => `${s.name}: ${s.declineReason}`).join(" · ")}</div> : null}
      {doc.status === "completed" ? <div className="note ok small">{t("es_completed_note")} <code className="k">{doc.finalHash?.slice(0, 16)}…</code></div> : null}
      <div className="panel stack">
        <h2>{t("es_signers")} <span className="small muted">· {doc.number} · {t(doc.ordered ? "es_in_order" : "es_any_order")}</span></h2>
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("es_order")}</th><th>{t("name")}</th><th>{t("status")}</th><th>{t("es_opened")}</th><th>{t("es_signed_at")}</th><th /></tr></thead>
          <tbody>{signers.map((s, i) => (
            <tr key={s.id}>
              <td><span className="es-dot" style={{ background: SIGNER_COLORS[i % SIGNER_COLORS.length] }} />{s.order}</td>
              <td><b>{s.name}</b><div className="small muted">{s.email || t("es_no_email")}</div></td>
              <td><Pill kind={s.status === "signed" ? "paid" : s.status === "declined" ? "void" : s.status === "waiting" ? "" : "sent"}>{t(`es_ss_${s.status}` as Key)}</Pill></td>
              <td className="small">{localDateTime(s.viewedAt, tz)}</td>
              <td className="small">{localDateTime(s.signedAt, tz)}{s.ip ? <div className="muted">IP {s.ip}</div> : null}</td>
              <td>{doc.status === "sent" && write && turn.has(s.id) ? (
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <CopyLink link={signLink(s.token)} label={t("es_copy_link")} done={t("es_copied")} />
                  {s.email ? <form action={remindSigner}><input type="hidden" name="id" value={doc.id} /><input type="hidden" name="signerId" value={s.id} /><button type="submit" className="btn sm">{t("es_remind")}</button></form> : null}
                </div>
              ) : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {doc.status === "sent" ? <div className="small muted">{t("es_links_help")}</div> : null}
      </div>
      <div className="panel stack">
        <h2>{t("es_audit")}</h2>
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("date")}</th><th>{t("es_event")}</th><th>{t("es_who")}</th><th>IP</th><th>{t("es_detail")}</th></tr></thead>
          <tbody>{events.map(({ e, user }) => (
            <tr key={e.id}><td className="small">{localDateTime(e.at, tz)}</td><td>{t(`es_ev_${e.action}` as Key)}</td><td>{e.signerId ? names.get(e.signerId) : user ?? ""}</td><td className="small muted">{e.ip}</td><td className="small muted">{e.detail}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
      {write && doc.status === "sent" ? (
        <form action={voidEsign} className="panel row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input type="hidden" name="id" value={doc.id} />
          <label className="f" style={{ flex: 1, minWidth: 220 }}>{t("es_void_reason")}<input id="es-void" name="reason" maxLength={300} /></label>
          <ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("es_void")}</ConfirmButton>
        </form>
      ) : null}
      {write && (doc.status === "voided" || doc.status === "declined") ? (
        <form action={deleteEsign}><input type="hidden" name="id" value={doc.id} /><ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
      ) : null}
    </div>
  );
}
