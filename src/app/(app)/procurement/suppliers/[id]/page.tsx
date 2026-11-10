import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import { docState, ratingsOf } from "@/lib/suppliers";
import { LocalTime } from "@/components/datetime";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { decideCategoryAction, reviewDocumentAction, setStatusAction } from "../actions";

export const metadata = { title: "Supplier" };

/** One supplier: who they are, their documents, prequalification by category, ratings, and approval. */
export default async function SupplierProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("procurement");
  const { t, err } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const [p] = await db.select().from(schema.partners).where(and(eq(schema.partners.id, id), eq(schema.partners.companyId, ctx.company.id)));
  if (!p || p.kind === "customer") notFound();
  const [docs, cats, links, ratings, account] = await Promise.all([
    db.select().from(schema.supplierDocuments).where(eq(schema.supplierDocuments.partnerId, id)).orderBy(desc(schema.supplierDocuments.uploadedAt)),
    db.select().from(schema.supplierCategories).where(eq(schema.supplierCategories.companyId, ctx.company.id)).orderBy(asc(schema.supplierCategories.sortOrder), asc(schema.supplierCategories.name)),
    db.select().from(schema.partnerCategories).where(eq(schema.partnerCategories.partnerId, id)),
    db.select({ r: schema.supplierRatings, order: schema.purchaseOrders.number, by: schema.users.name }).from(schema.supplierRatings)
      .leftJoin(schema.purchaseOrders, eq(schema.purchaseOrders.id, schema.supplierRatings.orderId)).leftJoin(schema.users, eq(schema.users.id, schema.supplierRatings.ratedBy))
      .where(eq(schema.supplierRatings.partnerId, id)).orderBy(desc(schema.supplierRatings.createdAt)),
    db.select({ u: schema.users }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.companyId, ctx.company.id), eq(schema.memberships.partnerId, id))),
  ]);
  const avg = (await ratingsOf(db, [id])).get(id);
  const write = ctx.can("procurement", "write");
  const status = p.supplierStatus ?? "approved";
  const linkOf = (cId: string) => links.find((l) => l.categoryId === cId);
  return (
    <div className="stack">
      <PageHead title={p.name}>
        <Link className="btn" href="/procurement/suppliers/registry">{t("back")}</Link>
        <Pill kind={status}>{t(`sst_${status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />

      <div className="grid2">
        <div className="panel stack">
          <div className="fields">
            <div><div className="label">{t("tin")}</div>{p.tin || "-"}</div>
            <div><div className="label">{t("phone")}</div>{p.phone || "-"}</div>
            <div><div className="label">{t("email")}</div>{p.email || "-"}</div>
            <div><div className="label">{t("address")}</div>{p.address || "-"}</div>
            {p.website ? <div><div className="label">{t("website")}</div>{p.website}</div> : null}
            <div><div className="label">{t("reg_rating")}</div>{avg ? `${avg.avg} ★ (${avg.count})` : "-"}</div>
          </div>
          {account.length ? <div className="small muted">{t("reg_portal_account")}: {account.map((a) => `${a.u.name} (@${a.u.username})`).join(", ")}</div> : null}
          {p.statusNote ? <div className="note info small">{p.statusNote}</div> : null}
        </div>
        {write ? (
          <form action={setStatusAction} className="panel stack">
            <h2>{t("reg_decision")}</h2>
            <input type="hidden" name="partnerId" value={p.id} />
            <div className="small muted">{t("reg_decision_help")}</div>
            <label className="f">{t("notes")}<textarea id="st-note" name="note" rows={2} placeholder={t("rq_note_help")} /></label>
            <div className="row">
              {status !== "approved" ? <button type="submit" name="status" value="approved" className="btn primary">{t("reg_approve")}</button> : null}
              {status === "registered" ? <button type="submit" name="status" value="rejected" className="btn danger">{t("reg_reject")}</button> : null}
              {status === "approved" ? <button type="submit" name="status" value="suspended" className="btn danger">{t("reg_suspend")}</button> : null}
            </div>
          </form>
        ) : null}
      </div>

      <div className="panel stack" id="documents">
        <h2>{t("reg_documents")}</h2>
        {docs.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("sdoc_kind")}</th><th>{t("sdoc_reference")}</th><th>{t("sdoc_expires")}</th><th>{t("status")}</th><th>{t("sdoc_uploaded")}</th>{write ? <th /> : null}</tr></thead>
            <tbody>{docs.map((d) => {
              const st = docState(d);
              return (
                <tr key={d.id}>
                  <td><a href={`/api/files/${d.attachmentId}`} target="_blank" rel="noreferrer">{t(`sdoc_${d.kind}`)}{d.label ? ` · ${d.label}` : ""}</a></td>
                  <td>{d.reference}</td><td>{d.expiresOn ?? "-"}</td>
                  <td><span style={{ color: st === "valid" ? "var(--ok)" : st === "expired" || st === "rejected" ? "var(--bad)" : undefined }}>{t(`sdst_${st}`)}</span>{d.note ? <div className="small muted">{d.note}</div> : null}</td>
                  <td className="small"><LocalTime value={d.uploadedAt.toISOString()} /></td>
                  {write ? <td>{d.status === "pending" ? (
                    <form action={reviewDocumentAction} className="row" style={{ gap: 6 }}>
                      <input type="hidden" name="partnerId" value={p.id} /><input type="hidden" name="docId" value={d.id} />
                      <input name="note" placeholder={t("notes")} aria-label={t("notes")} style={{ width: 140 }} />
                      <button type="submit" name="decision" value="accept" className="btn sm primary">{t("sdoc_accept")}</button>
                      <button type="submit" name="decision" value="reject" className="btn sm danger">{t("sdoc_reject")}</button>
                    </form>
                  ) : null}</td> : null}
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <div className="small muted">{t("reg_no_documents")}</div>}
      </div>

      <div className="panel stack" id="categories">
        <h2>{t("reg_prequalification")}</h2>
        {cats.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("reg_category")}</th><th>{t("status")}</th><th>{t("reg_valid_until")}</th>{write ? <th /> : null}</tr></thead>
            <tbody>{cats.map((c) => {
              const l = linkOf(c.id);
              return (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{l ? <span style={{ color: l.status === "prequalified" ? "var(--ok)" : l.status === "rejected" ? "var(--bad)" : undefined }}>{t(`pq_${l.status}`)}</span> : <span className="muted">-</span>}{l?.note ? <div className="small muted">{l.note}</div> : null}</td>
                  <td>{l?.validUntil ?? "-"}</td>
                  {write ? <td>
                    <form action={decideCategoryAction} className="row" style={{ gap: 6 }}>
                      <input type="hidden" name="partnerId" value={p.id} /><input type="hidden" name="categoryId" value={c.id} />
                      <input name="note" placeholder={t("notes")} aria-label={t("notes")} style={{ width: 140 }} />
                      <button type="submit" name="decision" value="prequalify" className="btn sm">{t("pq_prequalify")}</button>
                      <button type="submit" name="decision" value="refuse" className="btn sm ghost danger">{t("pq_refuse")}</button>
                    </form>
                  </td> : null}
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <div className="small muted">{t("reg_no_categories")}</div>}
      </div>

      <div className="panel stack">
        <h2>{t("reg_ratings")}</h2>
        {ratings.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("nav_purchase_orders")}</th><th className="num">{t("rate_quality")}</th><th className="num">{t("rate_delivery")}</th><th className="num">{t("rate_service")}</th><th>{t("cm_comment")}</th><th>{t("date")}</th></tr></thead>
            <tbody>{ratings.map(({ r, order, by }) => (
              <tr key={r.id}><td>{order ? <Link href={`/procurement/orders/${r.orderId}`}>{order}</Link> : "-"}</td><td className="num">{r.quality}</td><td className="num">{r.delivery}</td><td className="num">{r.service}</td>
                <td className="small">{r.comment}{by ? <div className="muted">{by}</div> : null}</td><td className="small"><LocalTime value={r.createdAt.toISOString()} /></td></tr>
            ))}</tbody>
          </table></div>
        ) : <div className="small muted">{t("reg_no_ratings")}</div>}
      </div>
    </div>
  );
}
