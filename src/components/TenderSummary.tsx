import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getI18n } from "@/lib/i18n";
import { LocalTime } from "./datetime";

type Tender = typeof schema.tenders.$inferSelect;

/** What a request for quotation or tender asks: its number, dates, terms of reference and the forms bidders must fill. */
export async function TenderSummary({ tender, extra, formActions }: {
  tender: Tender; extra?: React.ReactNode; formActions?: (form: { id: string }) => React.ReactNode;
}) {
  const { t } = await getI18n();
  const db = await getDb();
  const forms = await db.select({ f: schema.tenderForms, file: schema.attachments.fileName }).from(schema.tenderForms)
    .leftJoin(schema.attachments, eq(schema.attachments.id, schema.tenderForms.attachmentId))
    .where(eq(schema.tenderForms.tenderId, tender.id)).orderBy(asc(schema.tenderForms.sortOrder), asc(schema.tenderForms.createdAt));
  const rfq = tender.kind === "rfq";
  return (
    <>
      <div className="fields">
        <div><div className="label">{t(rfq ? "tn_rfq_no" : "tn_tender_no")}</div><b>{tender.number}</b></div>
        <div><div className="label">{t("type")}</div>{t(rfq ? "tn_rfq" : "tn_tender")}</div>
        <div><div className="label">{t("tn_issue_date")}</div>{tender.publishedAt ? <LocalTime value={tender.publishedAt.toISOString()} /> : <span className="muted">{t("tn_not_issued")}</span>}</div>
        <div><div className="label">{t("tn_deadline")}</div><LocalTime value={tender.deadline?.toISOString() ?? null} /></div>
        {extra}
      </div>
      {tender.description ? <div><div className="label">{t("tn_description")}</div><div style={{ whiteSpace: "pre-wrap" }}>{tender.description}</div></div> : null}
      {tender.requirements ? <div><div className="label">{t("tn_requirements")}</div><div style={{ whiteSpace: "pre-wrap" }}>{tender.requirements}</div></div> : null}
      {tender.attachmentId ? <div><a href={`/api/files/${tender.attachmentId}`} target="_blank" rel="noreferrer">{t("tn_document_file")}</a></div> : null}
      {forms.length ? (
        <div className="stack" style={{ gap: 6 }}>
          <div className="label">{t("tn_forms")}</div>
          <ol className="tender-forms">
            {forms.map(({ f, file }) => (
              <li key={f.id}>
                <span style={{ flex: 1 }}>{f.description}</span>
                <a className="btn sm" href={`/api/files/${f.attachmentId}`} target="_blank" rel="noreferrer" title={file ?? undefined}>{t("tn_form_download")}</a>
                {formActions ? formActions({ id: f.id }) : null}
              </li>
            ))}
          </ol>
          <div className="small muted">{t("tn_forms_help")}</div>
        </div>
      ) : null}
    </>
  );
}
