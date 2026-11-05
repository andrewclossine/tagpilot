import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { budgetLines } from "@/lib/programs";
import { today } from "@/lib/format";
import { Empty } from "@/components/ui";
import { saveVoucher } from "./actions";

type Voucher = typeof schema.paymentVouchers.$inferSelect;
type Line = typeof schema.voucherLines.$inferSelect;

const ROWS = 8;

/** The request form: the staff member picks the budget lines the money leaves and describes the activity. */
export async function VoucherForm({ ctx, voucher, lines = [], project, line }: { ctx: Ctx; voucher?: Voucher; lines?: Line[]; project?: string; line?: string }) {
  const { t, money } = await getI18n();
  const db = await getDb();
  const [groups, partners, contracts] = await Promise.all([
    budgetLines(db, ctx.company.id),
    db.select().from(schema.partners).where(eq(schema.partners.companyId, ctx.company.id)).orderBy(schema.partners.name),
    ctx.can("contracts") ? db.select().from(schema.contracts).where(and(eq(schema.contracts.companyId, ctx.company.id), eq(schema.contracts.status, "active"))).orderBy(schema.contracts.number) : Promise.resolve([]),
  ]);
  const shown = (project ? groups.filter((g) => g.project.id === project) : groups);
  const offered = shown.length ? shown : groups;
  if (!groups.length) {
    return <div className="panel"><Empty>{t("pv_no_lines")}{ctx.can("projects", "write") ? <> <Link href="/projects">{t("nav_projects")}</Link></> : null}</Empty></div>;
  }
  const options = offered.map((g) => (
    <optgroup key={g.project.id} label={`${g.project.code} · ${g.project.name}`}>
      {g.lines.map((l) => <option key={l.id} value={l.id}>{l.taskCode || l.code} {l.title.slice(0, 70)} ({t("balance_left")}: {money(l.totalBudget - l.executed)})</option>)}
    </optgroup>
  ));
  return (
    <form action={saveVoucher} className="panel stack">
      {voucher ? <input type="hidden" name="id" value={voucher.id} /> : null}
      <div className="fields">
        <label className="f">{t("date")}<input id="v-date" name="date" type="date" required defaultValue={voucher?.date ?? today()} /></label>
        <label className="f">{t("pv_payee")}<input id="v-payee" name="payee" defaultValue={voucher?.payee} /></label>
        <label className="f">{t("supplier")}
          <select id="v-partner" name="partnerId" defaultValue={voucher?.partnerId ?? ""}>
            <option value="">{t("none")}</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        {contracts.length ? (
          <label className="f">{t("nav_contracts")}
            <select id="v-contract" name="contractId" defaultValue={voucher?.contractId ?? ""}>
              <option value="">{t("none")}</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.number} · {c.title}</option>)}
            </select></label>
        ) : null}
      </div>
      <label className="f">{t("pv_description")}<textarea id="v-description" name="description" rows={3} required defaultValue={voucher?.description} /></label>
      <div className="tbl-wrap"><table className="lines">
        <thead><tr><th>{t("pv_budget_line")}</th><th>{t("description")}</th><th className="num">{t("pv_amount_requested")} ({ctx.company.currency})</th></tr></thead>
        <tbody>{Array.from({ length: ROWS }, (_, i) => (
          <tr key={i}>
            <td><select id={`v-line-${i}`} name="lineItem" aria-label={t("pv_budget_line")} defaultValue={lines[i]?.budgetItemId ?? (i === 0 ? line ?? "" : "")}>
              <option value="">{t("none")}</option>
              {options}
            </select></td>
            <td><input id={`v-note-${i}`} name="lineNote" aria-label={t("description")} defaultValue={lines[i]?.description} /></td>
            <td><input id={`v-amount-${i}`} name="lineAmount" className="num" inputMode="decimal" aria-label={t("pv_amount_requested")} defaultValue={lines[i]?.amount || ""} /></td>
          </tr>
        ))}</tbody>
      </table></div>
      <label className="f">{t("pv_support")}<input id="v-file" name="file" type="file" accept="image/*,application/pdf" /></label>
      <div className="row">
        <button type="submit" name="intent" value="submit" className="btn primary">{t("pv_submit")}</button>
        <button type="submit" name="intent" value="draft" className="btn">{t("save_draft")}</button>
        <Link className="btn ghost" href={voucher ? `/vouchers/${voucher.id}` : "/vouchers"}>{t("cancel")}</Link>
      </div>
    </form>
  );
}
