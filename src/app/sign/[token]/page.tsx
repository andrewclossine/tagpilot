import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { localDateTime, timeZoneOf } from "@/lib/format";
import { bySigningToken, loadDoc, whoseTurn } from "@/lib/esign";
import { Logo } from "@/components/Logo";
import { LanguagePicker } from "@/components/LanguagePicker";
import { declineEsign, markViewed, signEsign } from "../actions";
import { SignView } from "./SignView";

export const metadata = { title: "Sign", robots: { index: false, follow: false } };

/**
 * Where a signer lands from their private link, without a TAGPILOT account: the document, their fields, and the
 * signature. Afterwards the same link shows that they signed, and the signed copy once everyone has.
 */
export default async function SignPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SearchParams }) {
  const { token } = await params;
  const row = await bySigningToken(token);
  if (!row) notFound();
  const { t, lang, err } = await getI18n();
  const q = await sp(searchParams);
  const { d, s } = row;
  const db = await getDb();
  const loaded = (await loadDoc(db, d.companyId, d.id))!;
  const tz = timeZoneOf(row.country);
  const myTurn = whoseTurn(d, loaded.signers).some((x) => x.id === s.id);
  if (d.status === "sent" && myTurn && s.status !== "signed") await markViewed(token);
  const fileUrl = `/api/sign/${token}/file`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const shell = (body: React.ReactNode) => (
    <div className="sign-shell">
      <header className="launcher-top">
        <Logo size={26} />
        <span className="small muted" style={{ marginLeft: 8 }}>e-Signature</span>
        <span className="spacer" />
        <LanguagePicker lang={lang} />
      </header>
      <main className="sign-main stack">
        <div>
          <h1 style={{ margin: "0 0 4px" }}>{d.title}</h1>
          <div className="small muted">{t("es_from")} {row.company} · {d.number} · {s.name}</div>
        </div>
        {err(q("error")) ? <div className="note bad small">{err(q("error"))}</div> : null}
        {body}
      </main>
    </div>
  );

  if (d.status === "voided") return shell(<div className="note bad">{t("es_sign_voided")}</div>);
  if (s.status === "declined" || d.status === "declined") return shell(<div className="note bad">{t("es_sign_declined")}</div>);
  if (d.status === "completed") return shell(
    <div className="panel stack">
      <div className="note ok">{t("es_sign_all_done")}</div>
      <div><a className="btn primary" href={`${fileUrl}?kind=signed`} target="_blank" rel="noreferrer">{t("es_download_signed")}</a></div>
    </div>,
  );
  if (s.status === "signed") return shell(<div className="note ok">{t("es_sign_thanks")} {localDateTime(s.signedAt, tz)}. {t("es_sign_wait_others")}</div>);
  if (!myTurn) return shell(<div className="note info">{t("es_sign_not_turn")}</div>);

  const mine = loaded.fields.filter((f) => f.signerId === s.id).map((f) => ({ id: f.id, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label }));
  return shell(
    <>
      {d.message ? <div className="panel small" style={{ whiteSpace: "pre-wrap" }}>{d.message}</div> : null}
      <SignView token={token} fileUrl={fileUrl} pages={d.pages} fields={mine} name={s.name} today={today} action={signEsign}
        labels={{
          start: t("es_sign_start"), next: t("es_sign_next"), done_fields: t("es_sign_done_fields"), adopt: t("es_sign_adopt"), initials: t("es_f_initials"), initials_help: t("es_sign_initials_help"),
          consent: t("es_sign_consent"), finish: t("es_sign_finish"), loading: t("es_loading"), sign_here: t("es_sign_here"), fill: t("es_sign_fill"), pending: t("es_sign_pending"),
          pad: { help: t("sig_help"), clear: t("sig_clear"), upload: t("sig_upload"), redraw: t("sig_redraw"), remember: t("sig_remember"), required: t("err_signature") },
        }} />
      <details className="panel">
        <summary>{t("es_decline")}</summary>
        <form action={declineEsign} className="stack" style={{ marginTop: 10 }}>
          <input type="hidden" name="token" value={token} />
          <label className="f">{t("es_decline_reason")}<textarea id="es-decline" name="reason" rows={2} required maxLength={500} /></label>
          <div><button type="submit" className="btn ghost danger">{t("es_decline_btn")}</button></div>
        </form>
      </details>
    </>,
  );
}

