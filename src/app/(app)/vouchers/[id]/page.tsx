import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { canSeeVoucher } from "@/lib/access";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid, today } from "@/lib/format";
import { moneyAccounts } from "@/lib/ledger";
import { executionOn } from "@/lib/programs";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { decide, deleteVoucher, pay, submitDraft } from "../actions";
import { VoucherForm } from "../VoucherForm";

export const metadata = { title: "Payment voucher" };

export default async function VoucherPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("vouchers");
  const { t, err, money, accName } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const [row] = await db.select({ v: schema.paymentVouchers, project: schema.projects, line: schema.logframeItems })
    .from(schema.paymentVouchers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.paymentVouchers.projectId))
    .innerJoin(schema.logframeItems, eq(schema.logframeItems.id, schema.paymentVouchers.budgetItemId))
    .where(and(eq(schema.paymentVouchers.id, id), eq(schema.paymentVouchers.companyId, ctx.company.id)));
  if (!row || !canSeeVoucher(ctx, row.v)) notFound();
  const { v, project, line } = row;
  const mine = v.requestedBy === ctx.user.id;

  if (q("edit") && v.status === "draft" && mine && ctx.can("vouchers", "write")) {
    return (
      <div className="stack">
        <PageHead title={`${t("edit")}: ${v.number}`} />
        <ErrorNote message={err(q("error"))} />
        <VoucherForm ctx={ctx} voucher={v} />
      </div>
    );
  }

  // A draft shows the budget line as it stands now; from submission on, the figures frozen on the voucher.
  const budget = v.status === "draft" ? line.budget : v.activityBudget;
  const previous = v.status === "draft" ? await executionOn(db, v.budgetItemId, v.id) : v.previousExecution;
  const total = previous + v.amount;
  const [accounts, money_, names] = await Promise.all([
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), eq(schema.accounts.isActive, true))).orderBy(schema.accounts.code),
    moneyAccounts(db, ctx.company.id),
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
      .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.users.id)).where(eq(schema.memberships.companyId, ctx.company.id)),
  ]);
  const who = (uid: string | null) => names.find((n) => n.id === uid)?.name ?? "";
  const canDecide = ctx.can("voucher_approve", "write") && (ctx.isAdmin || !mine);
  const canPay = ctx.can("voucher_pay", "write");
  const expense = accounts.filter((a) => a.type === "expense" || a.type === "asset");

  return (
    <div className="stack">
      <PageHead title={`${t("pv_voucher")} ${v.number}`}>
        <Link className="btn" href="/vouchers">{t("back")}</Link>
        <a className="btn" href={`/api/pdf/voucher/${v.id}`} target="_blank" rel="noreferrer">PDF</a>
        <Pill kind={v.status}>{t(`vs_${v.status}`)}</Pill>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      <div className="grid2">
        <div className="panel stack">
          <div className="fields">
            <div><div className="label">{t("date")}</div>{v.date}</div>
            <div><div className="label">{t("project")}</div>{project.code} · {project.name}</div>
            <div><div className="label">{t("pv_requested_by")}</div>{who(v.requestedBy)}</div>
            {v.payee ? <div><div className="label">{t("pv_payee")}</div>{v.payee}</div> : null}
          </div>
          <div><div className="label">{t("pv_budget_line")}</div><code className="k">{line.code}</code> {line.title}</div>
          <div><div className="label">{t("pv_description")}</div><div style={{ whiteSpace: "pre-wrap" }}>{v.description}</div></div>
          {v.attachmentId ? <div><a href={`/api/files/${v.attachmentId}`} target="_blank" rel="noreferrer">{t("pv_support")}</a></div> : null}
          {v.decidedBy ? <div className={`note ${v.status === "rejected" ? "bad" : "info"} small`}><b>{t(v.status === "rejected" ? "vs_rejected" : "vs_approved")}</b> · {who(v.decidedBy)}{v.decisionNote ? <div>{v.decisionNote}</div> : null}</div> : null}
          {v.entryId ? <div className="small"><Link href={`/journal/${v.entryId}`}>{t("pv_journal_entry")} →</Link></div> : null}
        </div>
        <div className="panel">
          <table><tbody>
            <tr><td>{t("pv_activity_budget")}</td><td className="num">{money(budget, 2)}</td></tr>
            <tr><td>{t("pv_previous_execution")}</td><td className="num">{money(previous, 2)}</td></tr>
            <tr><td>{t("pv_amount_requested")}</td><td className="num"><b>{money(v.amount, 2)}</b></td></tr>
            <tr><td>{t("pv_total_execution")}</td><td className="num">{money(total, 2)}</td></tr>
            <tr className="total"><td>{t("balance_left")}</td><td className="num" style={{ color: budget - total < 0 ? "var(--bad)" : undefined }}>{money(budget - total, 2)}</td></tr>
          </tbody></table>
          {v.status === "draft" && budget - total < 0 ? <div className="note bad small" style={{ marginTop: 10 }}>{t("err_over_budget")}</div> : null}
        </div>
      </div>

      {v.status === "draft" && mine && ctx.can("vouchers", "write") ? (
        <div className="panel row">
          <form action={submitDraft}><input type="hidden" name="id" value={v.id} /><button type="submit" className="btn primary">{t("pv_submit")}</button></form>
          <Link className="btn" href={`/vouchers/${v.id}?edit=1`}>{t("edit")}</Link>
          <form action={deleteVoucher}><input type="hidden" name="id" value={v.id} /><ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
        </div>
      ) : null}

      {(v.status === "submitted" || v.status === "approved") && canDecide ? (
        <form action={decide} className="panel stack">
          <h2>{t("pv_decision")}</h2>
          <input type="hidden" name="id" value={v.id} />
          <label className="f">{t("pv_decision_note")}<input id="v-note" name="note" /></label>
          <div className="row">
            {v.status === "submitted" ? <button type="submit" name="decision" value="approve" className="btn primary">{t("pv_approve")}</button> : null}
            <button type="submit" name="decision" value="reject" className="btn danger">{t("pv_reject")}</button>
          </div>
        </form>
      ) : v.status === "submitted" && mine && ctx.can("voucher_approve", "write") ? <div className="note info small">{t("err_self_approval")}</div> : null}

      {v.status === "approved" && canPay ? (
        <form action={pay} className="panel stack">
          <h2>{t("pv_pay")}</h2>
          <input type="hidden" name="id" value={v.id} />
          <div className="fields">
            <label className="f">{t("date")}<input id="p-date" name="date" type="date" required defaultValue={today()} /></label>
            <label className="f">{t("paid_from")}
              <select id="p-money" name="moneyAccountId" required defaultValue="">
                <option value="" disabled>{t("none")}</option>
                {money_.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
              </select></label>
            <label className="f">{t("expense_account")}
              <select id="p-expense" name="expenseAccountId" required defaultValue={line.accountId ?? ""}>
                <option value="" disabled>{t("none")}</option>
                {expense.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
              </select></label>
          </div>
          <div className="small muted">{t("pv_pay_note")}</div>
          <div><button type="submit" className="btn primary">{t("pv_pay")}</button></div>
        </form>
      ) : null}
    </div>
  );
}
