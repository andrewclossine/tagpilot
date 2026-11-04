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

/** The request form: the staff member picks the budget line the money leaves and describes the activity. */
export async function VoucherForm({ ctx, voucher, project, line }: { ctx: Ctx; voucher?: Voucher; project?: string; line?: string }) {
  const { t, money } = await getI18n();
  const db = await getDb();
  const [groups, partners, contracts] = await Promise.all([
    budgetLines(db, ctx.company.id),
    db.select().from(schema.partners).where(eq(schema.partners.companyId, ctx.company.id)).orderBy(schema.partners.name),
    ctx.can("contracts") ? db.select().from(schema.contracts).where(and(eq(schema.contracts.companyId, ctx.company.id), eq(schema.contracts.status, "active"))).orderBy(schema.contracts.number) : Promise.resolve([]),
  ]);
  const shown = project ? groups.filter((g) => g.project.id === project) : groups;
  if (!groups.length) {
    return <div className="panel"><Empty>{t("pv_no_lines")}{ctx.can("projects", "write") ? <> <Link href="/projects">{t("nav_projects")}</Link></> : null}</Empty></div>;
  }
  return (
    <form action={saveVoucher} className="panel stack">
      {voucher ? <input type="hidden" name="id" value={voucher.id} /> : null}
      <label className="f">{t("pv_budget_line")}
        <select id="v-line" name="budgetItemId" required defaultValue={voucher?.budgetItemId ?? line ?? ""}>
          <option value="" disabled>{t("none")}</option>
          {(shown.length ? shown : groups).map((g) => (
            <optgroup key={g.project.id} label={`${g.project.code} · ${g.project.name}`}>
              {g.lines.map((l) => <option key={l.id} value={l.id}>{l.code} {l.title} ({t("balance_left")}: {money(l.totalBudget - l.executed)})</option>)}
            </optgroup>
          ))}
        </select></label>
      <div className="fields">
        <label className="f">{t("date")}<input id="v-date" name="date" type="date" required defaultValue={voucher?.date ?? today()} /></label>
        <label className="f">{t("pv_amount_requested")} ({ctx.company.currency})<input id="v-amount" name="amount" className="num" inputMode="decimal" required defaultValue={voucher?.amount || ""} /></label>
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
      <label className="f">{t("pv_description")}<textarea id="v-description" name="description" rows={4} required defaultValue={voucher?.description} /></label>
      <label className="f">{t("pv_support")}<input id="v-file" name="file" type="file" accept="image/*,application/pdf" /></label>
      <div className="row">
        <button type="submit" name="intent" value="submit" className="btn primary">{t("pv_submit")}</button>
        <button type="submit" name="intent" value="draft" className="btn">{t("save_draft")}</button>
        <Link className="btn ghost" href={voucher ? `/vouchers/${voucher.id}` : "/vouchers"}>{t("cancel")}</Link>
      </div>
    </form>
  );
}
