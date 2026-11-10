import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getI18n } from "@/lib/i18n";
import { LocalTime } from "./datetime";
import { itemsOf } from "@/lib/boq";

type Tender = typeof schema.tenders.$inferSelect;

/** What a request for quotation or tender asks: its number, dates, terms of reference and the forms bidders must fill. */
export async function TenderSummary({ tender, extra, formActions, showItems = true }: {
  tender: Tender; extra?: React.ReactNode; formActions?: (form: { id: string }) => React.ReactNode; showItems?: boolean;
}) {
  const { t } = await getI18n();
  const db = await getDb();
  const forms = await db.select({ f: schema.tenderForms, file: schema.attachments.fileName }).from(schema.tenderForms)
    .leftJoin(schema.attachments, eq(schema.attachments.id, schema.tenderForms.attachmentId))
    .where(eq(schema.tenderForms.tenderId, tender.id)).orderBy(asc(schema.tenderForms.sortOrder), asc(schema.tenderForms.createdAt));
  const items = showItems ? await itemsOf(db, tender.id) : [];
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
      {items.length ? (
        <div className="stack" style={{ gap: 6 }}>
          <div className="label">{t("boq_title")}</div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>#</th><th>{t("description")}</th><th>{t("rq_unit")}</th><th className="num">{t("rq_quantity")}</th></tr></thead>
            <tbody>{items.map((i) => <tr key={i.id}><td className="muted">{i.sortOrder}</td><td>{i.description}</td><td>{i.unit}</td><td className="num">{i.quantity}</td></tr>)}</tbody>
          </table></div>
        </div>
      ) : null}
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
