import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { canSeeVoucher } from "@/lib/access";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid, today } from "@/lib/format";
import { moneyAccounts } from "@/lib/ledger";
import { DOC_TYPES, executionOn, NEXT_STEP } from "@/lib/programs";
import { savedSignature } from "@/lib/signature";
import { ConfirmButton } from "@/components/editors";
import { SignaturePad } from "@/components/SignaturePad";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import type { VoucherStep } from "@/db/schema";
import { decide, deleteVoucher, pay, saveDocuments, submitDraft } from "../actions";
import { VoucherForm } from "../VoucherForm";

export const metadata = { title: "Fund request" };

const SIGNATURES: VoucherStep[] = ["prepared", "reviewed", "approved", "authorized"];

export default async function VoucherPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("vouchers");
  const { t, err, money, accName } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const [row] = await db.select({ v: schema.paymentVouchers, project: schema.projects }).from(schema.paymentVouchers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.paymentVouchers.projectId))
    .where(and(eq(schema.paymentVouchers.id, id), eq(schema.paymentVouchers.companyId, ctx.company.id)));
  if (!row || !canSeeVoucher(ctx, row.v)) notFound();
  const { v, project } = row;
  const mine = v.requestedBy === ctx.user.id;
  const lines = await db.select({ l: schema.voucherLines, item: schema.logframeItems }).from(schema.voucherLines)
    .innerJoin(schema.logframeItems, eq(schema.logframeItems.id, schema.voucherLines.budgetItemId))
    .where(eq(schema.voucherLines.voucherId, id)).orderBy(schema.voucherLines.lineNo);

  if (q("edit") && v.status === "draft" && mine && ctx.can("vouchers", "write")) {
    return (
      <div className="stack">
        <PageHead title={`${t("edit")}: ${v.number}`} />
        <ErrorNote message={err(q("error"))} />
        <VoucherForm ctx={ctx} voucher={v} lines={lines.map((x) => x.l)} />
      </div>
    );
  }

  // A draft shows each budget line as it stands now; from preparation on, the figures frozen on the request.
  const figures = await Promise.all(lines.map(async ({ l, item }) => {
    const budget = v.status === "draft" ? item.budget : l.activityBudget;
    const previous = v.status === "draft" ? await executionOn(db, l.budgetItemId, v.id) : l.previousExecution;
    return { l, item, budget, previous, total: previous + l.amount };
  }));
  const [accounts, moneyAccs, steps, docs] = await Promise.all([
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), eq(schema.accounts.isActive, true))).orderBy(schema.accounts.code),
    moneyAccounts(db, ctx.company.id),
    db.select({ s: schema.voucherSteps, name: schema.users.name }).from(schema.voucherSteps).innerJoin(schema.users, eq(schema.users.id, schema.voucherSteps.userId))
      .where(eq(schema.voucherSteps.voucherId, id)).orderBy(schema.voucherSteps.at),
    db.select({ d: schema.voucherDocuments }).from(schema.voucherDocuments).where(eq(schema.voucherDocuments.voucherId, id)),
  ]);
  const next = NEXT_STEP[v.status];
  const signed = steps.map((x) => x.s).filter((s) => SIGNATURES.includes(s.step));
  const canSign = !!next && ctx.can(next.area, "write");
  const alreadySigned = signed.some((s) => s.userId === ctx.user.id) && !ctx.isAdmin;
  const canPay = ctx.can("voucher_pay", "write");
  const expense = accounts.filter((a) => a.type === "expense" || a.type === "asset");
  const needsAccount = lines.some((x) => !x.item.accountId);
  const docOf = (type: string) => docs.find((x) => x.d.docType === type)?.d;
  const canDocs = ctx.can("vouchers", "write") && (ctx.role !== "staff" || mine);
  const over = figures.some((f) => f.total > f.budget + 0.01);
  const canPrepare = v.status === "draft" && mine && ctx.can("vouchers", "write");
  const canSendBack = v.status === "authorized" && ctx.can("voucher_authorize", "write");
  const pad = canPrepare || (next && canSign && !alreadySigned) ? <SignaturePad saved={await savedSignature(db, ctx.user.id)} labels={{
    help: t("sig_help"), clear: t("sig_clear"), upload: t("sig_upload"), redraw: t("sig_redraw"), remember: t("sig_remember"), required: t("err_signature"),
  }} /> : null;
  return (
    <div className="stack">
      <PageHead title={`${t("pv_voucher")} ${v.number}`}>
        <Link className="btn" href="/vouchers">{t("back")}</Link>
        <a className="btn" href={`/api/pdf/voucher/${v.id}`} download={`FR-${v.number.replace(/[^A-Za-z0-9-]/g, "-")}.pdf`}>{t("pv_download_pdf")}</a>
        <Pill kind={v.status}>{t(`vs_${v.status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}

      <div className="panel stack">
        <div className="fields">
          <div><div className="label">{t("pv_fr_no")}</div><b>{v.number}</b></div>
          <div><div className="label">{t("pv_project_code")}</div><b>{project.code}</b></div>
          <div><div className="label">{t("date")}</div>{v.date}</div>
          <div><div className="label">{t("project")}</div><Link href={`/projects/${project.id}`}>{project.name}</Link></div>
          {v.payee ? <div><div className="label">{t("pv_payee")}</div>{v.payee}</div> : null}
          {v.paymentReference ? <div><div className="label">{t("pv_cheque")}</div>{v.paymentReference}</div> : null}
        </div>
        <div><div className="label">{t("pv_description")}</div><div style={{ whiteSpace: "pre-wrap" }}>{v.description}</div></div>
        {v.attachmentId ? <div><a href={`/api/files/${v.attachmentId}`} target="_blank" rel="noreferrer">{t("pv_support")}</a></div> : null}
        {v.entryId ? <div className="small"><Link href={`/journal/${v.entryId}`}>{t("pv_journal_entry")} →</Link></div> : null}
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("pv_budget_line")}</th><th className="num">{t("pv_activity_budget")}</th><th className="num">{t("pv_previous_execution")}</th><th className="num">{t("pv_amount_requested")}</th><th className="num">{t("pv_total_execution")}</th><th className="num">{t("balance_left")}</th></tr></thead>
          <tbody>
            {figures.map(({ l, item, budget, previous, total }) => (
              <tr key={l.id}>
                <td><code className="k">{item.taskCode || item.code}</code> {item.title}{l.description ? <div className="small muted">{l.description}</div> : null}</td>
                <td className="num">{money(budget, 2)}</td><td className="num">{money(previous, 2)}</td><td className="num"><b>{money(l.amount, 2)}</b></td><td className="num">{money(total, 2)}{budget ? <div className="small muted">{Math.round((total / budget) * 1000) / 10}%</div> : null}</td>
                <td className="num" style={{ color: budget - total < -0.01 ? "var(--bad)" : undefined }}>{money(budget - total, 2)}</td>
              </tr>
            ))}
            <tr className="total"><td colSpan={3}>{t("total")}</td><td className="num">{money(v.amount, 2)}</td><td colSpan={2} /></tr>
          </tbody>
        </table></div>
        {v.status === "draft" && over ? <div className="note bad small">{t("err_over_budget")}</div> : null}
      </div>

      <div className="panel stack">
        <h2>{t("pv_signatures")}</h2>
        <ol className="sign-steps">
          {SIGNATURES.map((s) => {
            const done = signed.find((x) => x.step === s);
            const who = steps.find((x) => x.s.id === done?.id)?.name;
            return (
              <li key={s} className={done ? "done" : next?.step === s ? "now" : ""}>
                <b>{t(`step_${s}`)}</b>
                {done?.signature ? <img src={done.signature} alt={`${t(`step_${s}`)}: ${who}`} className="sig-image small" /> : null}
                <span className="small">{done ? who : "—"}</span>
                <span className="small muted">{done ? done.at.toISOString().slice(0, 16).replace("T", " ") : ""}</span>
                {done?.note ? <span className="small muted">{done.note}</span> : null}
              </li>
            );
          })}
        </ol>
        {v.decisionNote && (v.status === "draft" || v.status === "rejected") ? <div className="note bad small">{v.decisionNote}</div> : null}
      </div>

      {v.status === "draft" && mine && ctx.can("vouchers", "write") ? (
        <div className="panel stack">
          <h2 id="sign">{t("step_do_prepared")}</h2>
          <form action={submitDraft} className="stack">
            <input type="hidden" name="id" value={v.id} />
            {pad}
            <div><button type="submit" className="btn primary">{t("pv_submit")}</button></div>
          </form>
          <div className="row">
            <Link className="btn" href={`/vouchers/${v.id}?edit=1`}>{t("edit")}</Link>
            <form action={deleteVoucher}><input type="hidden" name="id" value={v.id} /><ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
          </div>
        </div>
      ) : null}

      {next && canSign ? (
        alreadySigned ? <div className="note info small">{t("err_self_approval")}</div> : (
          <div className="panel stack">
            <form action={decide} className="stack">
              <h2 id="sign">{t(`step_do_${next.step}` as "step_do_reviewed")}</h2>
              <input type="hidden" name="id" value={v.id} />
              <input type="hidden" name="decision" value="sign" />
              {pad}
              <label className="f">{t("pv_decision_note")}<input id="v-note" name="note" /></label>
              <div><button type="submit" className="btn primary">{t(`step_do_${next.step}` as "step_do_reviewed")}</button></div>
            </form>
            <form action={decide} className="stack">
              <input type="hidden" name="id" value={v.id} />
              <label className="f">{t("pv_send_back_reason")}<input id="v-reason" name="note" required /></label>
              <div className="row">
                <button type="submit" name="decision" value="return" className="btn">{t("pv_return")}</button>
                <button type="submit" name="decision" value="cancel" className="btn danger">{t("pv_reject")}</button>
              </div>
            </form>
          </div>
        )
      ) : next ? <div className="note info small">{t("pv_waiting_for")}: {t(`step_${next.step}`)}</div> : null}

      {canSendBack ? (
        <form action={decide} className="panel stack">
          <input type="hidden" name="id" value={v.id} />
          <label className="f">{t("pv_send_back_reason")}<input id="v-reason" name="note" required /></label>
          <div className="row">
            <button type="submit" name="decision" value="return" className="btn">{t("pv_return")}</button>
            <button type="submit" name="decision" value="cancel" className="btn danger">{t("pv_reject")}</button>
          </div>
        </form>
      ) : null}

      {v.status === "authorized" && canPay && !ctx.has("accounting") ? (
        <form action={pay} className="panel stack">
          <h2>{t("pv_mark_paid")}</h2>
          <input type="hidden" name="id" value={v.id} />
          <div className="fields">
            <label className="f">{t("date")}<input id="p-date" name="date" type="date" required defaultValue={today()} /></label>
            <label className="f">{t("pv_cheque")}<input id="p-reference" name="reference" /></label>
          </div>
          <div><button type="submit" className="btn primary">{t("pv_mark_paid")}</button></div>
        </form>
      ) : null}

      {v.status === "authorized" && canPay && ctx.has("accounting") ? (
        <form action={pay} className="panel stack">
          <h2>{t("pv_pay")}</h2>
          <input type="hidden" name="id" value={v.id} />
          <div className="fields">
            <label className="f">{t("date")}<input id="p-date" name="date" type="date" required defaultValue={today()} /></label>
            <label className="f">{t("pv_cheque")}<input id="p-reference" name="reference" /></label>
            <label className="f">{t("paid_from")}
              <select id="p-money" name="moneyAccountId" required defaultValue="">
                <option value="" disabled>{t("none")}</option>
                {moneyAccs.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
              </select></label>
            {needsAccount ? (
              <label className="f">{t("expense_account")}
                <select id="p-expense" name="expenseAccountId" required defaultValue="">
                  <option value="" disabled>{t("none")}</option>
                  {expense.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
                </select></label>
            ) : null}
          </div>
          <div className="small muted">{t("pv_pay_note")}</div>
          <div><button type="submit" className="btn primary">{t("pv_pay")}</button></div>
        </form>
      ) : null}

      <form action={saveDocuments} className="panel stack">
        <h2>{t("pv_documents")}</h2>
        <input type="hidden" name="id" value={v.id} />
        <div className="tbl-wrap"><table>
          <tbody>{DOC_TYPES.map((d) => {
            const doc = docOf(d);
            return (
              <tr key={d}>
                <td>{t(`doc_${d}`)}{doc?.attachmentId ? <> · <a className="small" href={`/api/files/${doc.attachmentId}`} target="_blank" rel="noreferrer">{t("tn_file")}</a></> : null}</td>
                <td style={{ width: 170 }}><select id={`doc-${d}`} name={`doc_${d}`} defaultValue={doc?.status ?? "na"} disabled={!canDocs} aria-label={t(`doc_${d}`)}>
                  <option value="na">{t("pv_doc_na")}</option><option value="pending">{t("pv_doc_pending")}</option><option value="submitted">{t("pv_doc_submitted")}</option>
                </select></td>
                {canDocs ? <td style={{ width: 260 }}><input id={`docf-${d}`} name={`file_${d}`} type="file" accept="image/*,application/pdf" aria-label={t("tn_file")} /></td> : null}
              </tr>
            );
          })}</tbody>
        </table></div>
        {canDocs ? <div><button type="submit" className="btn">{t("save")}</button></div> : null}
      </form>
    </div>
  );
}
