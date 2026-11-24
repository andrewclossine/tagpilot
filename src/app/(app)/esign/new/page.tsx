import Link from "next/link";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote, PageHead } from "@/components/ui";
import { createEsign } from "../actions";

export const metadata = { title: "New document to sign" };

/** Step one: the PDF to be signed. */
export default async function NewEsignPage({ searchParams }: { searchParams: SearchParams }) {
  await requireView("esign");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="stack">
      <PageHead title={t("es_new")}><Link className="btn ghost" href="/esign">{t("back")}</Link></PageHead>
      <ErrorNote message={err(q("error"))} />
      <form action={createEsign} className="panel stack" style={{ maxWidth: 640 }}>
        <ol className="es-steps small muted"><li className="on">{t("es_step_upload")}</li><li>{t("es_step_prepare")}</li><li>{t("es_step_send")}</li></ol>
        <label className="f">{t("es_doc_title")}<input id="es-title" name="title" maxLength={200} placeholder={t("es_doc_title_help")} /></label>
        <label className="f">{t("es_pdf")}<input id="es-file" name="file" type="file" accept="application/pdf" required /></label>
        <span className="small muted">{t("es_pdf_help")}</span>
        <div><button type="submit" className="btn primary">{t("es_upload")}</button></div>
      </form>
    </div>
  );
}
