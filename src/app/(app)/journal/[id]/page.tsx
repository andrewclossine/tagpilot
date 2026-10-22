import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { today } from "@/lib/format";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { EntryForm } from "../EntryForm";
import { addPartnerFromAi, reverseJournal } from "../actions";

export const metadata = { title: "Journal entry" };

export default async function EntryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const ctx = await requireView("journal");
  const { t, err, accName, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [e] = await db.select().from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.id, id), eq(schema.journalEntries.companyId, ctx.company.id)));
  if (!e) notFound();
  const lines = await db.select({ line: schema.journalLines, account: schema.accounts, project: schema.projects })
    .from(schema.journalLines).innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
    .leftJoin(schema.projects, eq(schema.projects.id, schema.journalLines.projectId))
    .where(eq(schema.journalLines.entryId, id)).orderBy(schema.journalLines.lineNo);
  const [att] = e.attachmentId ? await db.select().from(schema.attachments).where(eq(schema.attachments.id, e.attachmentId)) : [];
  const [partner] = e.partnerId ? await db.select().from(schema.partners).where(eq(schema.partners.id, e.partnerId)) : [];
  const [creator] = e.createdBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, e.createdBy)) : [];
  const [poster] = e.postedBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, e.postedBy)) : [];
  const editable = e.status === "draft" && ctx.can("journal", "write");
  const totalD = lines.reduce((s, l) => s + l.line.debit, 0), totalC = lines.reduce((s, l) => s + l.line.credit, 0);

  const aiBox = e.ai ? (
    <div className="panel stack">
      <div className="row"><span className="label">{t("ai_confidence")}</span>
        <span className="meter"><i style={{ width: `${Math.round(e.ai.confidence * 100)}%` }} /></span>
        <span className="num">{Math.round(e.ai.confidence * 100)}%</span>
        {e.ai.docType ? <Pill kind="">{e.ai.docType}</Pill> : null}
      </div>
      {e.ai.total ? <div className="small">{t("ai_doc_total")}: <b className="num">{money(e.ai.total)}</b>
        {Math.abs(Math.max(totalD, totalC) - e.ai.total) > 1 ? <span className="balance-bad"> · {t("ai_total_mismatch")}</span> : null}</div> : null}
      {e.ai.warnings.length ? <div className="note warn small"><b>{t("ai_notes")}</b><ul>{e.ai.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div> : null}
      {e.ai.newPartner && !e.partnerId && editable ? (
        <form action={addPartnerFromAi} className="note info small row">
          <input type="hidden" name="id" value={e.id} />
          <span style={{ flex: 1, minWidth: 0 }}>{t("ai_new_partner")} <b>{e.ai.newPartner.name}</b>{e.ai.newPartner.tin ? ` · ${t("tin")} ${e.ai.newPartner.tin}` : ""} · {t(e.ai.newPartner.kind)}</span>
          <button type="submit" className="btn sm">{t("ai_add_partner")}</button>
        </form>
      ) : null}
    </div>
  ) : null;

  const preview = att ? (
    <div className="panel preview stack">
      <div className="row"><h3 style={{ flex: 1, overflowWrap: "anywhere" }}>{att.fileName}</h3><a className="btn sm" href={`/api/files/${att.id}`} target="_blank" rel="noopener">{t("open_file")}</a></div>
      {att.mimeType === "application/pdf" ? <iframe src={`/api/files/${att.id}`} title={att.fileName} /> : <img src={`/api/files/${att.id}`} alt={att.fileName} />}
    </div>
  ) : null;

  const view = (
    <div className="panel stack">
      <div className="fields">
        <div><div className="label">{t("date")}</div>{e.date}</div>
        <div><div className="label">{t("reference")}</div>{e.reference || "—"}</div>
        <div><div className="label">{t("partner")}</div>{partner?.name ?? "—"}</div>
        <div><div className="label">{t("source")}</div>{t(`src_${e.source}`)}</div>
      </div>
      <div><div className="label">{t("memo")}</div><b>{e.memo}</b></div>
      <div className="tbl-wrap"><table>
        <thead><tr><th>{t("account")}</th><th>{t("description")}</th><th>{t("project")}</th><th className="num">{t("debit")}</th><th className="num">{t("credit")}</th></tr></thead>
        <tbody>
          {lines.map(({ line, account, project }) => (
            <tr key={line.id}>
              <td><code className="k">{account.code}</code> {accName(account)}</td><td>{line.description}</td><td>{project?.code ?? ""}</td>
              <td className="num">{line.debit ? money(line.debit, 2) : ""}</td><td className="num">{line.credit ? money(line.credit, 2) : ""}</td>
            </tr>
          ))}
          <tr className="total"><td colSpan={3}>{t("total")}</td><td className="num">{money(totalD, 2)}</td><td className="num">{money(totalC, 2)}</td></tr>
        </tbody>
      </table></div>
      <div className="small muted">
        {creator ? `${t("created_by")} ${creator.name}` : ""}{poster ? ` · ${t("posted_by")} ${poster.name} · ${e.postedAt?.toISOString().slice(0, 16).replace("T", " ")}` : ""}
      </div>
      {e.reversedById ? <div className="small"><Link href={`/journal/${e.reversedById}`}>{t("reversed_by")} →</Link></div> : null}
      {e.reversesId ? <div className="small"><Link href={`/journal/${e.reversesId}`}>{t("reverse_of")} →</Link></div> : null}
      {e.status === "posted" && ctx.can("journal", "write") && !e.reversedById ? (
        <form action={reverseJournal} className="row">
          <input type="hidden" name="id" value={e.id} />
          <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{t("date")}<input type="date" name="date" id="revDate" defaultValue={today()} style={{ width: "auto" }} /></label>
          <ConfirmButton className="btn" confirmLabel={t("confirm")}>{t("reverse")}</ConfirmButton>
        </form>
      ) : null}
    </div>
  );

  return (
    <div className="stack">
      <PageHead title={`${t("jr_entry")}${e.number ? ` #${e.number}` : ""}`}>
        <Pill kind={e.status}>{t(e.status === "posted" ? "st_posted" : "st_draft")}</Pill>
        <Link href="/journal" className="btn ghost">{t("back")}</Link>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {att || e.ai ? (
        <div className="grid-doc">
          <div className="stack">{preview}{aiBox}</div>
          <div className="stack">{editable ? <EntryForm ctx={ctx} entry={e} lines={lines.map(toJLine)} /> : view}</div>
        </div>
      ) : editable ? <EntryForm ctx={ctx} entry={e} lines={lines.map(toJLine)} /> : view}
    </div>
  );
}

function toJLine({ line }: { line: typeof schema.journalLines.$inferSelect }) {
  return { accountId: line.accountId, debit: line.debit ? String(line.debit) : "", credit: line.credit ? String(line.credit) : "", description: line.description, projectId: line.projectId ?? "" };
}
