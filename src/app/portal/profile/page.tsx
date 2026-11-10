import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSupplier } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { DOC_KINDS, docState, EXPIRING } from "@/lib/suppliers";
import { LocalTime } from "@/components/datetime";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { uploadSupplierDocument } from "../actions";

export const metadata = { title: "My profile" };

/** The supplier's own standing with the organisation: approval, categories, and documents to keep up to date. */
export default async function PortalProfilePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireSupplier();
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [[p], docs, cats] = await Promise.all([
    db.select().from(schema.partners).where(eq(schema.partners.id, ctx.partnerId)),
    db.select().from(schema.supplierDocuments).where(eq(schema.supplierDocuments.partnerId, ctx.partnerId)).orderBy(desc(schema.supplierDocuments.uploadedAt)),
    db.select({ l: schema.partnerCategories, name: schema.supplierCategories.name }).from(schema.partnerCategories)
      .innerJoin(schema.supplierCategories, eq(schema.supplierCategories.id, schema.partnerCategories.categoryId))
      .where(eq(schema.partnerCategories.partnerId, ctx.partnerId)).orderBy(asc(schema.supplierCategories.name)),
  ]);
  const status = p?.supplierStatus ?? "approved";
  return (
    <div className="stack">
      <PageHead title={t("reg_my_profile")}><Pill kind={status}>{t(`sst_${status}`)}</Pill></PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {status === "registered" ? <div className="note info">{t("reg_under_review")}</div> : null}
      {status === "rejected" || status === "suspended" ? <div className="note bad">{t(`sst_${status}`)}{p?.statusNote ? `: ${p.statusNote}` : ""}</div> : null}

      {cats.length ? (
        <div className="panel stack">
          <h2>{t("reg_prequalification")}</h2>
          <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }}>
            {cats.map(({ l, name }) => <li key={l.categoryId} className="small">{name} · <b>{t(`pq_${l.status}`)}</b>{l.validUntil ? ` · ${t("reg_valid_until")} ${l.validUntil}` : ""}{l.note ? ` · ${l.note}` : ""}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="panel stack">
        <h2>{t("reg_documents")}</h2>
        {docs.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("sdoc_kind")}</th><th>{t("sdoc_reference")}</th><th>{t("sdoc_expires")}</th><th>{t("status")}</th><th>{t("sdoc_uploaded")}</th></tr></thead>
            <tbody>{docs.map((d) => {
              const st = docState(d);
              return (
                <tr key={d.id}>
                  <td><a href={`/api/files/${d.attachmentId}`} target="_blank" rel="noreferrer">{t(`sdoc_${d.kind}`)}{d.label ? ` · ${d.label}` : ""}</a></td>
                  <td>{d.reference}</td><td>{d.expiresOn ?? "-"}</td>
                  <td><span style={{ color: st === "valid" ? "var(--ok)" : st === "expired" || st === "rejected" ? "var(--bad)" : undefined }}>{t(`sdst_${st}`)}</span>{d.note ? <div className="small muted">{d.note}</div> : null}</td>
                  <td className="small"><LocalTime value={d.uploadedAt.toISOString()} /></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : null}
        <form action={uploadSupplierDocument} className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h3>{t("reg_add_document")}</h3>
          <div className="small muted">{t("reg_add_document_help").replace("{kinds}", EXPIRING.map((k) => t(`sdoc_${k}`)).join(", "))}</div>
          <div className="fields">
            <label className="f">{t("sdoc_kind")}
              <select name="kind" defaultValue="rra">{DOC_KINDS.map((k) => <option key={k} value={k}>{t(`sdoc_${k}`)}</option>)}</select></label>
            <label className="f">{t("sdoc_label")}<input name="label" /></label>
            <label className="f">{t("sdoc_reference")}<input name="reference" /></label>
            <label className="f">{t("sdoc_expires")}<input name="expiresOn" type="date" /></label>
          </div>
          <label className="f">{t("tn_file")}<input name="file" type="file" accept="application/pdf,image/*" required /></label>
          <div><button type="submit" className="btn primary">{t("reg_upload")}</button></div>
        </form>
      </div>
    </div>
  );
}
