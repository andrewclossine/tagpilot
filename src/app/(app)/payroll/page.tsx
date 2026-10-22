import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { round2, today } from "@/lib/format";
import { payrollConfig, readPayslip } from "@/lib/payroll";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead, Pill, Tabs } from "@/components/ui";
import { RulesEditor } from "./RulesEditor";
import { sendPayslipsEmail } from "../send-actions";
import { createRunFromEmployees, deletePayrollRun, loadRwandaPreset, saveEmployee, savePayrollRules, suggestRules, uploadPayroll } from "./actions";

export const metadata = { title: "Payroll" };

export default async function PayrollPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("payroll");
  const { t, err, accName, money } = await getI18n();
  const q = await sp(searchParams);
  const tab = ["employees", "rules"].includes(q("tab")) ? q("tab") : "run";
  const month = /^\d{4}-\d{2}$/.test(q("month")) ? q("month") : today().slice(0, 7);
  const cfg = payrollConfig(ctx.company.settings.payroll);
  const canEdit = ctx.can("payroll", "write");
  const db = await getDb();
  const [emps, projects, accounts] = await Promise.all([
    db.select().from(schema.employees).where(eq(schema.employees.companyId, ctx.company.id)).orderBy(schema.employees.name),
    db.select().from(schema.projects).where(eq(schema.projects.companyId, ctx.company.id)).orderBy(schema.projects.code),
    db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id)).orderBy(schema.accounts.code),
  ]);
  const projCode = (id: string | null) => projects.find((p) => p.id === id)?.code ?? "";

  let body: React.ReactNode;
  if (tab === "run") {
    const [run] = await db.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.companyId, ctx.company.id), eq(schema.payrollRuns.month, month)));
    const [entry] = run?.entryId ? await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, run.entryId)) : [];
    const comps = run ? payrollConfig(run.settings).components : cfg.components;
    const rows = run ? run.rows.map(readPayslip) : [];
    const sum = (f: (r: (typeof rows)[number]) => number) => round2(rows.reduce((s, r) => s + f(r), 0));
    const empComps = comps.filter((c) => c.kind === "employee"), erComps = comps.filter((c) => c.kind === "employer");
    const ready = cfg.components.length > 0 && cfg.reviewed;
    body = (
      <div className="stack">
        <form className="row" method="get" action="/payroll">
          <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{t("month")}<input type="month" id="month" name="month" defaultValue={month} style={{ width: "auto" }} /></label>
          <button type="submit" className="btn sm">{t("show")}</button>
        </form>
        {q("unknown") ? <div className="note warn small">{t("payroll_unknown_projects")}: {q("unknown")}</div> : null}
        {run ? (
          <div className="panel stack">
            <div className="row"><h2 style={{ flex: 1 }}>{t("run_title")} · {month}</h2><span className="small muted">{run.source === "employees" ? t("emp_title") : run.source}</span></div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>{t("emp_name")}</th><th>{t("project")}</th><th className="num">{t("gross")}</th>
                {empComps.map((c) => <th key={c.code} className="num">{c.name}</th>)}<th className="num">{t("deduction")}</th>
                <th className="num">{t("net")}</th>{erComps.map((c) => <th key={c.code} className="num">{c.name}</th>)}<th /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><b>{r.name}</b><div className="small muted">{[r.position, r.email].filter(Boolean).join(" · ")}</div></td><td>{projCode(r.projectId)}</td>
                    <td className="num">{money(r.gross)}</td>
                    {empComps.map((c) => <td key={c.code} className="num">{money(r.deductions[c.code] ?? 0)}</td>)}
                    <td className="num">{r.otherDeduction ? money(r.otherDeduction) : ""}</td>
                    <td className="num"><b>{money(r.net)}</b></td>
                    {erComps.map((c) => <td key={c.code} className="num">{money(r.employer[c.code] ?? 0)}</td>)}
                    <td style={{ whiteSpace: "nowrap" }}><a className="small" href={`/api/pdf/payslip?run=${run.id}&row=${i}`} target="_blank" rel="noopener">PDF</a></td>
                  </tr>
                ))}
                <tr className="total"><td colSpan={2}>{t("total")}</td><td className="num">{money(sum((r) => r.gross))}</td>
                  {empComps.map((c) => <td key={c.code} className="num">{money(sum((r) => r.deductions[c.code] ?? 0))}</td>)}
                  <td className="num">{money(sum((r) => r.otherDeduction))}</td><td className="num">{money(sum((r) => r.net))}</td>
                  {erComps.map((c) => <td key={c.code} className="num">{money(sum((r) => r.employer[c.code] ?? 0))}</td>)}<td /></tr>
              </tbody>
            </table></div>
            <div className="note ok small">{t("run_exists")}</div>
            {q("mailed") ? (() => {
              const [sent, skipped, failed] = q("mailed").split("/").map(Number);
              return <div className={`note small ${failed ? "warn" : "ok"}`}>{t("payslips_mailed").replace("{sent}", String(sent)).replace("{skipped}", String(skipped)).replace("{failed}", String(failed))}</div>;
            })() : null}
            {canEdit ? (
              <form action={sendPayslipsEmail} className="row">
                <input type="hidden" name="runId" value={run.id} />
                <span className="small muted" style={{ flex: 1 }}>{t("payslips_mail_help").replace("{n}", String(rows.filter((r) => r.email).length)).replace("{total}", String(rows.length))}</span>
                <button type="submit" className="btn" disabled={!rows.some((r) => r.email)}>{t("payslips_mail_btn")}</button>
              </form>
            ) : null}
            <form className="row">
              {entry ? <><Link className="btn primary" href={`/journal/${entry.id}`}>{t("open_entry")}</Link><Pill kind={entry.status}>{t(entry.status === "posted" ? "st_posted" : "st_draft")}</Pill></> : null}
              <span className="spacer" />
              {canEdit && (!entry || entry.status === "draft" || entry.reversedById)
                ? <><input type="hidden" name="id" value={run.id} /><ConfirmButton className="btn danger" formAction={deletePayrollRun} confirmLabel={t("confirm")}>{t("delete_run")}</ConfirmButton></> : null}
            </form>
            {entry?.status === "posted" && !entry.reversedById ? <div className="small muted">{t("run_locked")}</div> : null}
          </div>
        ) : !canEdit ? <div className="panel"><Empty>{t("nothing_yet")}</Empty></div> : !ready ? (
          <div className="note warn">{t(cfg.components.length ? "payroll_review_first" : "payroll_rules_first")} <Link href="/payroll?tab=rules">{t("payroll_rules")} →</Link></div>
        ) : (
          <div className="grid2">
            <form action={uploadPayroll} className="panel stack">
              <h2>{t("payroll_upload")}</h2>
              <div className="small muted">{t("payroll_upload_help")}</div>
              <input type="hidden" name="month" value={month} />
              <input id="file" name="file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required />
              <div className="tbl-wrap"><table className="small"><thead><tr><th>Name</th><th>Position</th><th>Project</th><th className="num">Gross</th><th className="num">Advance</th><th>Email</th></tr></thead>
                <tbody><tr><td>Jane Doe</td><td>Accountant</td><td>GEN</td><td className="num">550000</td><td className="num">0</td><td>jane@example.com</td></tr></tbody></table></div>
              <div><button type="submit" className="btn primary">{t("payroll_calculate")}</button></div>
            </form>
            <form action={createRunFromEmployees} className="panel stack">
              <h2>{t("payroll_from_list")}</h2>
              <input type="hidden" name="month" value={month} />
              {emps.filter((e) => e.isActive).length ? (
                <div className="tbl-wrap"><table>
                  <thead><tr><th>{t("emp_name")}</th><th className="num">{t("gross")}</th><th className="num">{t("bonus")}</th><th className="num">{t("deduction")}</th></tr></thead>
                  <tbody>{emps.filter((e) => e.isActive).map((e) => (
                    <tr key={e.id}><td>{e.name}</td><td className="num">{money(e.basic + e.transport + e.other)}</td>
                      <td className="num"><input name={`b_${e.id}`} id={`b_${e.id}`} className="num" style={{ width: 100 }} inputMode="decimal" aria-label={t("bonus")} /></td>
                      <td className="num"><input name={`d_${e.id}`} id={`d_${e.id}`} className="num" style={{ width: 100 }} inputMode="decimal" aria-label={t("deduction")} /></td></tr>
                  ))}</tbody>
                </table></div>
              ) : <Empty><Link href="/payroll?tab=employees">{t("add_emp")} →</Link></Empty>}
              {emps.some((e) => e.isActive) ? <div><button type="submit" className="btn">{t("payroll_calculate")}</button></div> : null}
            </form>
          </div>
        )}
      </div>
    );
  } else if (tab === "employees") {
    const editing = emps.find((e) => e.id === q("edit"));
    body = (
      <div className="stack">
        {emps.length ? (
          <div className="panel tbl-wrap"><table>
            <thead><tr><th>{t("emp_name")}</th><th>{t("project")}</th><th className="num">{t("basic")}</th><th className="num">{t("transport")}</th><th className="num">{t("allowances")}</th><th /></tr></thead>
            <tbody>{emps.map((e) => (
              <tr key={e.id}><td><b>{e.name}</b><div className="small muted">{[e.position, e.rssbNo].filter(Boolean).join(" · ")}{e.isActive ? "" : ` · ${t("inactive")}`}</div></td>
                <td>{projCode(e.projectId)}</td><td className="num">{money(e.basic)}</td><td className="num">{money(e.transport)}</td><td className="num">{money(e.other)}</td>
                <td>{canEdit ? <a className="btn ghost sm" href={`/payroll?tab=employees&edit=${e.id}#emp`}>{t("edit")}</a> : null}</td></tr>
            ))}</tbody>
          </table></div>
        ) : null}
        {canEdit ? (
          <form action={saveEmployee} className="panel stack" id="emp" key={editing?.id ?? "new"}>
            <h2>{editing ? `${t("edit")}: ${editing.name}` : t("add_emp")}</h2>
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <div className="fields">
              <label className="f">{t("emp_name")}<input id="e-name" name="name" defaultValue={editing?.name} required /></label>
              <label className="f">{t("position")}<input id="e-pos" name="position" defaultValue={editing?.position} /></label>
              <label className="f">{t("email")}<input id="e-email" name="email" type="email" defaultValue={editing?.email} /></label>
              <label className="f">{t("social_no")}<input id="e-rssb" name="rssbNo" defaultValue={editing?.rssbNo} /></label>
              <label className="f">{t("national_id")}<input id="e-nid" name="nationalId" defaultValue={editing?.nationalId} /></label>
              <label className="f">{t("project")}<select id="e-proj" name="projectId" defaultValue={editing?.projectId ?? ""}><option value="">{t("none")}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
              <label className="f">{t("basic")}<input id="e-basic" name="basic" className="num" defaultValue={editing?.basic ?? ""} inputMode="decimal" required /></label>
              <label className="f">{t("transport")}<input id="e-tr" name="transport" className="num" defaultValue={editing?.transport ?? ""} inputMode="decimal" /></label>
              <label className="f">{t("allowances")}<input id="e-oth" name="other" className="num" defaultValue={editing?.other ?? ""} inputMode="decimal" /></label>
              <label className="f">{t("status")}<select id="e-act" name="isActive" defaultValue={editing?.isActive === false ? "0" : "1"}><option value="1">{t("active")}</option><option value="0">{t("inactive")}</option></select></label>
            </div>
            <div className="row"><button type="submit" className="btn primary">{editing ? t("update") : t("add_emp")}</button>
              {editing ? <a className="btn ghost" href="/payroll?tab=employees">{t("cancel")}</a> : null}</div>
          </form>
        ) : null}
      </div>
    );
  } else {
    const accList = accounts.map((a) => ({ code: a.code, name: accName(a), type: a.type }));
    const accSel = (name: string, value: string, types: string[]) => (
      <select id={`pr-${name}`} name={name} defaultValue={value}>{accounts.filter((a) => types.includes(a.type)).map((a) => <option key={a.id} value={a.code}>{a.code} · {accName(a)}</option>)}</select>
    );
    body = (
      <div className="stack">
        {q("notes") ? <div className="note info small"><b>{t("ai_notes")}</b><ul>{q("notes").split("\n").filter(Boolean).map((n, i) => <li key={i}>{n}</li>)}</ul></div> : null}
        {!cfg.reviewed && cfg.components.length ? <div className="note warn">{t("payroll_unreviewed_note")}</div> : null}
        {canEdit ? (
          <div className="panel row">
            <form action={suggestRules} className="row" style={{ flex: 1 }}>
              <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{t("country")}<input id="ai-country" name="country" defaultValue={cfg.country || ctx.company.country} style={{ width: 180 }} required /></label>
              <button type="submit" className="btn primary">{t("payroll_ai_rules")}</button>
            </form>
            <form action={loadRwandaPreset}><button type="submit" className="btn ghost sm">{t("payroll_rwanda")}</button></form>
          </div>
        ) : null}
        <form action={savePayrollRules} className="panel stack">
          <h2>{t("payroll_rules")}{cfg.country ? ` · ${cfg.country}` : ""}</h2>
          <div className="small muted">{t("payroll_rules_help")}</div>
          <input type="hidden" name="country" value={cfg.country} />
          <RulesEditor initial={cfg.components} accounts={accList} disabled={!canEdit} labels={{
            code: t("code"), name: t("name"), kind: t("kind"), employee: t("rule_employee"), employer: t("rule_employer"), method: t("rule_method"),
            percent: t("rule_percent"), brackets: t("rule_brackets"), rate: t("rule_rate"), base: t("rule_base"), gross: t("gross"), remaining: t("rule_remaining"),
            liability: t("rule_liability"), expense: t("rule_expense"), add: t("add"), delete: t("delete"),
          }} />
          <div className="fields">
            <label className="f">{t("acc_salary")}{accSel("accSalary", cfg.accSalary, ["expense"])}</label>
            <label className="f">{t("acc_net")}{accSel("accNet", cfg.accNet, ["liability"])}</label>
            <label className="f">{t("acc_adv")}{accSel("accAdv", cfg.accAdv, ["asset", "liability"])}</label>
          </div>
          <label className="row small" style={{ gap: 8 }}><input type="checkbox" id="reviewed" name="reviewed" value="1" defaultChecked={cfg.reviewed} disabled={!canEdit} /> {t("payroll_reviewed")}</label>
          {canEdit ? <div><button type="submit" className="btn primary">{t("save")}</button></div> : null}
        </form>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead title={t("nav_payroll")} />
      <Tabs current={tab} items={[
        { key: "run", href: `/payroll?month=${month}`, label: t("run_title") },
        { key: "employees", href: "/payroll?tab=employees", label: t("emp_title") },
        { key: "rules", href: "/payroll?tab=rules", label: t("payroll_rules") },
      ]} />
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {body}
    </div>
  );
}
