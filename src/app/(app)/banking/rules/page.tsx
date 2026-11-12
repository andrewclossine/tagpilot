import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { moneyAccounts } from "@/lib/ledger";
import { rulesOf } from "@/lib/bank-rules";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead, Pill } from "@/components/ui";
import { runRules, saveRule, toggleRule } from "../actions";

export const metadata = { title: "Bank rules" };

/** Rules that recognise imported statement lines and suggest or book their account. */
export default async function BankRulesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("banking");
  const { t, err, accName, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [rules, accounts, banks, projects] = await Promise.all([
    rulesOf(db, ctx.company.id),
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), eq(schema.accounts.isActive, true))).orderBy(schema.accounts.code),
    moneyAccounts(db, ctx.company.id),
    db.select().from(schema.projects).where(and(eq(schema.projects.companyId, ctx.company.id), eq(schema.projects.isActive, true))).orderBy(schema.projects.code),
  ]);
  const name = (id: string | null) => { const a = accounts.find((x) => x.id === id) ?? banks.find((x) => x.id === id); return a ? `${a.code} · ${accName(a)}` : ""; };
  const targets = accounts.filter((a) => !a.currency && !["ar", "ap"].includes(a.subtype ?? ""));
  const write = ctx.can("banking", "write");
  return (
    <div className="stack">
      <PageHead title={t("rule_title")}>
        <Link className="btn" href="/banking">{t("back")}</Link>
        {write && rules.length ? <form action={runRules}><input type="hidden" name="back" value="/banking/rules" /><button type="submit" className="btn">{t("rule_run")}</button></form> : null}
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {q("suggested") ? <div className="note ok small">{t("rule_ran").replace("{booked}", q("ruled") || "0").replace("{suggested}", q("suggested") || "0")}</div> : null}
      <p className="muted" style={{ margin: 0, maxWidth: "75ch" }}>{t("rule_intro")}</p>
      <div className="panel">
        {rules.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("rule_name")}</th><th>{t("rule_contains")}</th><th>{t("rule_direction")}</th><th>{t("rule_amounts")}</th><th>{t("rule_account")}</th><th>{t("rule_action")}</th><th /></tr></thead>
            <tbody>{rules.map((r) => (
              <tr key={r.id} style={r.isActive ? undefined : { opacity: 0.55 }}>
                <td><b>{r.name}</b>{r.bankAccountId ? <div className="small muted">{name(r.bankAccountId)}</div> : null}</td>
                <td><code className="k">{r.contains}</code></td>
                <td>{t(`rule_dir_${r.direction}`)}</td>
                <td className="small">{r.minAmount || r.maxAmount ? `${r.minAmount ? money(r.minAmount) : "0"} – ${r.maxAmount ? money(r.maxAmount) : "∞"}` : "-"}</td>
                <td>{name(r.accountId)}{r.projectId ? <div className="small muted">{projects.find((p) => p.id === r.projectId)?.code}</div> : null}</td>
                <td><Pill kind={r.autoBook ? "posted" : "draft"}>{t(r.autoBook ? "rule_auto" : "rule_suggest")}</Pill></td>
                <td>{write ? <div className="row" style={{ gap: 6 }}>
                  <form action={toggleRule}><input type="hidden" name="ruleId" value={r.id} /><button type="submit" className="btn sm ghost">{t(r.isActive ? "rule_pause" : "rule_resume")}</button></form>
                  <form action={toggleRule}><input type="hidden" name="ruleId" value={r.id} /><input type="hidden" name="do" value="delete" /><ConfirmButton className="btn sm ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
                </div> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("rule_none")}</Empty>}
      </div>
      {write ? (
        <form action={saveRule} className="panel stack">
          <h2>{t("rule_new")}</h2>
          <div className="fields">
            <label className="f">{t("rule_name")}<input id="r-name" name="name" required placeholder={t("rule_name_example")} /></label>
            <label className="f">{t("rule_contains")}<input id="r-contains" name="contains" required placeholder={t("rule_contains_example")} /></label>
            <label className="f">{t("rule_direction")}
              <select id="r-direction" name="direction" defaultValue="any">{(["any", "in", "out"] as const).map((d) => <option key={d} value={d}>{t(`rule_dir_${d}`)}</option>)}</select></label>
            <label className="f">{t("rule_bank")}
              <select id="r-bank" name="bankAccountId" defaultValue=""><option value="">{t("rule_all_banks")}</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {accName(b)}</option>)}</select></label>
          </div>
          <div className="fields">
            <label className="f">{t("rule_min")}<input id="r-min" name="minAmount" className="num" inputMode="decimal" /></label>
            <label className="f">{t("rule_max")}<input id="r-max" name="maxAmount" className="num" inputMode="decimal" /></label>
            <label className="f">{t("rule_account")}
              <select id="r-account" name="accountId" required defaultValue=""><option value="" disabled>{t("choose")}</option>{targets.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}</select></label>
            <label className="f">{t("project")}
              <select id="r-project" name="projectId" defaultValue=""><option value="">{t("none")}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
          </div>
          <label className="row small" style={{ gap: 8 }}><input id="r-auto" type="checkbox" name="autoBook" style={{ width: "auto" }} /> {t("rule_auto_help")}</label>
          <div><button type="submit" className="btn primary">{t("rule_save")}</button></div>
        </form>
      ) : null}
    </div>
  );
}
