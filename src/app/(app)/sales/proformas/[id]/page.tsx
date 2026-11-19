import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid, localDateTime, timeZoneOf } from "@/lib/format";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { cancelProforma, convertProforma, markProformaSent, sendProformaEmail } from "../actions";
import { ProformaForm } from "../ProformaForm";

export const metadata = { title: "Proforma" };

/** Status colours: a draft, sent to the customer, invoiced, or cancelled. */
const PF_PILL: Record<string, string> = { draft: "draft", open: "draft", sent: "sent", converted: "paid", cancelled: "void" };

/**
 * One proforma and its steps: prepare it, submit it to the customer, revise it after negotiating, and turn it into an
 * invoice once the goods or services are delivered. Every earlier version stays in its history.
 */
export default async function ProformaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("sales");
  const { t, err, money } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const [row] = await db.select({ p: schema.proformas, customer: schema.partners }).from(schema.proformas)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.proformas.partnerId))
    .where(and(eq(schema.proformas.id, id), eq(schema.proformas.companyId, ctx.company.id)));
  if (!row) notFound();
  const { p, customer } = row;
  const [lines, revisions] = await Promise.all([
    db.select().from(schema.proformaLines).where(eq(schema.proformaLines.proformaId, id)).orderBy(schema.proformaLines.lineNo),
    db.select({ r: schema.proformaRevisions, by: schema.users.name }).from(schema.proformaRevisions).leftJoin(schema.users, eq(schema.users.id, schema.proformaRevisions.createdBy))
      .where(eq(schema.proformaRevisions.proformaId, id)).orderBy(desc(schema.proformaRevisions.revision)),
  ]);
  const live = ["draft", "open", "sent"].includes(p.status);
  const write = ctx.can("sales", "write") && live;
  const tz = timeZoneOf(ctx.company.country);
  const ref = p.revision ? `${p.number} Rev. ${p.revision}` : p.number;
  const status = p.status === "open" ? "draft" : p.status;
  if (q("edit") && write) {
    return (
      <div className="stack">
        <PageHead title={`${t(status === "sent" ? "pf_revise" : "edit")}: ${ref}`} />
        <ErrorNote message={err(q("error"))} />
        <ProformaForm ctx={ctx} proforma={p} lines={lines.map((l) => ({
          description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatApplies: l.vatApplies, accountId: l.accountId, projectId: l.projectId ?? "", itemId: l.itemId ?? "",
        }))} />
      </div>
    );
  }
  return (
    <div className="stack">
      <PageHead title={`${t("pf_proforma")} ${ref}`}>
        <Pill kind={PF_PILL[status] ?? "draft"}>{t(`pf_${status}` as never)}</Pill>
        <a className="btn" href={`/api/pdf/proforma/${p.id}`} target="_blank" rel="noreferrer">PDF</a>
        <Link className="btn ghost" href="/sales/proformas">{t("back")}</Link>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {q("sent") ? <div className="note ok small">{t("pf_sent_to")} {q("sent")}</div> : null}
      <ol className="pf-steps">
        {(["draft", "sent", "converted"] as const).map((s, i) => {
          const order = { draft: 0, sent: 1, converted: 2, cancelled: -1 } as Record<string, number>;
          const done = order[status] > i, now = order[status] === i;
          return <li key={s} className={done ? "done" : now ? "now" : ""}>{t(`pf_step_${s}` as never)}</li>;
        })}
      </ol>
      <div className="panel stack">
        <div className="fields">
          <div><div className="label">{t("customer")}</div><b>{customer.name}</b></div>
          <div><div className="label">{t("date")}</div>{p.date}</div>
          <div><div className="label">{t("pf_valid_until")}</div>{p.validUntil}</div>
          {p.sentAt ? <div><div className="label">{t("pf_submitted")}</div>{localDateTime(p.sentAt, tz)}{p.sentTo ? <div className="small muted">{p.sentTo}</div> : null}</div> : null}
          {p.invoiceId ? <div><div className="label">{t("inv_invoice")}</div><Link href={`/sales/invoices/${p.invoiceId}`}>{t("pf_open_invoice")} →</Link></div> : null}
        </div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("description")}</th><th className="num">{t("qty")}</th><th className="num">{t("unit_price")}</th><th>{t("vat")}</th><th className="num">{t("amount")}</th></tr></thead>
          <tbody>
            {lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitPrice, 2)}</td><td>{l.vatApplies ? "✓" : ""}</td><td className="num">{money(l.amount, 2)}</td></tr>)}
            <tr><td colSpan={4} className="num">{t("subtotal")}</td><td className="num">{money(p.subtotal, 2)}</td></tr>
            <tr><td colSpan={4} className="num">{t("vat")}</td><td className="num">{money(p.vat, 2)}</td></tr>
            <tr className="total"><td colSpan={4} className="num">{t("total")}</td><td className="num">{money(p.total, 2)}</td></tr>
          </tbody>
        </table></div>
        {p.notes ? <div className="small">{p.notes}</div> : null}
      </div>

      {write ? (
        <div className="grid2">
          <div className="panel stack">
            <h2>{t(status === "sent" ? "pf_send_again" : "pf_submit")}</h2>
            <form action={sendProformaEmail} className="stack">
              <input type="hidden" name="id" value={p.id} />
              <label className="f">{t("email")}<input id="pf-to" name="to" type="email" defaultValue={customer.email} required /></label>
              <label className="f">{t("pdf_message")}<textarea id="pf-msg" name="message" rows={2} placeholder={t("pf_message_default")} /></label>
              <div><button type="submit" className="btn primary">{t("pf_send_email")}</button></div>
            </form>
            <form action={markProformaSent} className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <input type="hidden" name="id" value={p.id} />
              <label className="f" style={{ flex: 1, minWidth: 180 }}>{t("pf_handed_how")}<input id="pf-how" name="how" placeholder={t("pf_handed_placeholder")} /></label>
              <button type="submit" className="btn">{t("pf_mark_sent")}</button>
            </form>
          </div>
          <div className="panel stack">
            <h2>{t("pf_next")}</h2>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Link className="btn" href={`/sales/proformas/${p.id}?edit=1`}>{t(status === "sent" ? "pf_revise" : "edit")}</Link>
              <form action={convertProforma}><input type="hidden" name="id" value={p.id} /><ConfirmButton className="btn primary" confirmLabel={t("confirm")}>{t("pf_convert")}</ConfirmButton></form>
              <form action={cancelProforma}><input type="hidden" name="id" value={p.id} /><ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("cancel")}</ConfirmButton></form>
            </div>
            <div className="small muted">{t(status === "sent" ? "pf_sent_help" : "pf_draft_help")}</div>
          </div>
        </div>
      ) : null}

      {revisions.length ? (
        <div className="panel stack">
          <h2>{t("pf_history")}</h2>
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("pf_version")}</th><th>{t("date")}</th><th className="num">{t("total")}</th><th>{t("pf_reason")}</th><th>{t("pf_changed")}</th></tr></thead>
            <tbody>
              <tr><td><b>{ref}</b> · {t("pf_current")}</td><td>{p.date}</td><td className="num"><b>{money(p.total, 2)}</b></td><td /><td /></tr>
              {revisions.map(({ r, by }) => (
                <tr key={r.id}>
                  <td>{r.revision ? `${p.number} Rev. ${r.revision}` : p.number}</td>
                  <td>{r.snapshot.date}</td>
                  <td className="num">{money(r.snapshot.total, 2)}</td>
                  <td className="small">{r.reason}</td>
                  <td className="small muted">{localDateTime(r.createdAt, tz)}{by ? ` · ${by}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      ) : null}
    </div>
  );
}
