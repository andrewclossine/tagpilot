import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead, Pill } from "@/components/ui";
import { changeRecurring, runDueNow } from "./actions";

export const metadata = { title: "Recurring transactions" };

/** Invoices, bills and journal entries made again on a schedule. */
export default async function RecurringPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getCtx();
  const see = { invoice: ctx.can("sales"), bill: ctx.can("purchases"), journal: ctx.can("journal") };
  if (!see.invoice && !see.bill && !see.journal) redirect("/no-access");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const rows = (await db.select().from(schema.recurringTemplates).where(eq(schema.recurringTemplates.companyId, ctx.company.id)).orderBy(asc(schema.recurringTemplates.nextDate)))
    .filter((r) => see[r.kind]);
  const canWrite = (k: "invoice" | "bill" | "journal") => ctx.can(k === "invoice" ? "sales" : k === "bill" ? "purchases" : "journal", "write");
  const amountOf = (r: (typeof rows)[number]) => r.kind === "journal"
    ? (r.payload.journalLines ?? []).reduce((s, l) => s + l.debit, 0)
    : (r.payload.docLines ?? []).reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  return (
    <div className="stack">
      <PageHead title={t("rec_title")}>
        {rows.some((r) => canWrite(r.kind)) ? <form action={runDueNow}><button type="submit" className="btn">{t("rec_run_now")}</button></form> : null}
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("rec_saved")}</div> : null}
      {q("made") ? <div className={`note small ${Number(q("failed")) ? "warn" : "ok"}`}>{t("rec_ran").replace("{made}", q("made")).replace("{failed}", q("failed") || "0")}</div> : null}
      <p className="muted" style={{ margin: 0, maxWidth: "75ch" }}>{t("rec_intro")}</p>
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("rec_name")}</th><th>{t("type")}</th><th>{t("rec_every")}</th><th>{t("rec_next")}</th><th className="num">{t("amount")}</th><th>{t("rec_made")}</th><th>{t("status")}</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b>{r.lastError ? <div className="small" style={{ color: "var(--bad)" }}>{err(r.lastError)}</div> : null}{r.sourceId ? <div className="small"><Link href={r.kind === "invoice" ? `/sales/invoices/${r.sourceId}` : r.kind === "bill" ? `/purchases/bills/${r.sourceId}` : `/journal/${r.sourceId}`}>{t("rec_source")}</Link></div> : null}</td>
                <td>{t(`rec_kind_${r.kind}`)}<div className="small muted">{t(r.autoPost ? "rec_posted" : "rec_drafts")}</div></td>
                <td>{t(`rec_every_${r.every}`)}{r.endDate ? <div className="small muted">{t("rec_until")} {r.endDate}</div> : null}</td>
                <td>{r.status === "ended" ? "-" : r.nextDate}</td>
                <td className="num">{money(amountOf(r), 2)}</td>
                <td>{r.made}{r.lastDate ? <div className="small muted">{r.lastDate}</div> : null}</td>
                <td><Pill kind={r.status === "active" ? "posted" : r.status === "paused" ? "draft" : "void"}>{t(`rec_st_${r.status}`)}</Pill></td>
                <td>{canWrite(r.kind) ? <div className="row" style={{ gap: 6 }}>
                  {r.status !== "ended" ? <form action={changeRecurring}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="do" value={r.status === "active" ? "pause" : "resume"} /><button type="submit" className="btn sm ghost">{t(r.status === "active" ? "rule_pause" : "rule_resume")}</button></form> : null}
                  <form action={changeRecurring}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="do" value="delete" /><ConfirmButton className="btn sm ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
                </div> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("rec_none")}</Empty>}
      </div>
    </div>
  );
}
