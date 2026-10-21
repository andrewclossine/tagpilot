import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { parseAmount, today } from "@/lib/format";
import { payslip } from "@/lib/payroll";
import { PAYROLL_DEFAULTS } from "@/lib/template";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead, Pill } from "@/components/ui";
import type { PayslipRow } from "@/db/schema";
import { createPayrollRun, deletePayrollRun, saveEmployee, savePayrollSettings } from "./actions";

export const metadata = { title: "Payroll" };

export default async function PayrollPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getCtx();
  const { t, err, accName, money } = await getI18n();
  const q = await sp(searchParams);
  const month = /^\d{4}-\d{2}$/.test(q("month")) ? q("month") : today().slice(0, 7);
  const cfg = { ...PAYROLL_DEFAULTS, ...ctx.company.settings.payroll };
  const db = await getDb();
  const [emps, projects, accounts, [run]] = await Promise.all([
    db.select().from(schema.employees).where(eq(schema.employees.companyId, ctx.company.id)).orderBy(schema.employees.name),
    db.select().from(schema.projects).where(eq(schema.projects.companyId, ctx.company.id)).orderBy(schema.projects.code),
    db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id)).orderBy(schema.accounts.code),
    db.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.companyId, ctx.company.id), eq(schema.payrollRuns.month, month))),
  ]);
  const [entry] = run?.entryId ? await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, run.entryId)) : [];
  const active = emps.filter((e) => e.isActive);
  const rows: PayslipRow[] = run ? run.rows : active.map((e) => payslip(e, { bonus: parseAmount(q(`b_${e.id}`)), deduction: parseAmount(q(`d_${e.id}`)) }, cfg));
  const sum = (k: keyof PayslipRow) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const projCode = (id: string | null) => projects.find((p) => p.id === id)?.code ?? "";
  const editing = emps.find((e) => e.id === q("edit"));
  const canEditRun = !run && ctx.canWrite;
  const accSel = (name: keyof typeof cfg) => (
    <select id={`pr-${name}`} name={name} defaultValue={String(cfg[name])} disabled={!ctx.isOwner}>
      {accounts.map((a) => <option key={a.id} value={a.code}>{a.code} · {accName(a)}</option>)}
    </select>
  );
  const numIn = (name: keyof typeof cfg) => <input id={`pr-${name}`} name={name} className="num" defaultValue={String(cfg[name])} inputMode="decimal" disabled={!ctx.isOwner} />;
  const yn = (name: "payeTransport" | "rssbTransport") => (
    <select id={`pr-${name}`} name={name} defaultValue={cfg[name] ? "1" : "0"} disabled={!ctx.isOwner}><option value="1">{t("yes")}</option><option value="0">{t("no")}</option></select>
  );

  return (
    <div className="stack">
      <PageHead title={t("nav_payroll")} />
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}

      <form className="panel stack" method="get" action="/payroll">
        <div className="row">
          <h2 style={{ flex: 1 }}>{t("run_title")}</h2>
          <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{t("month")}
            <input type="month" id="month" name="month" defaultValue={month} style={{ width: "auto" }} /></label>
          <button type="submit" className="btn sm">{t("show")}</button>
        </div>
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("emp_name")}</th><th className="num">{t("bonus")}</th><th className="num">{t("gross")}</th><th className="num">{t("paye")}</th>
              <th className="num">{t("pension")}</th><th className="num">{t("maternity")}</th><th className="num">{t("cbhi")}</th><th className="num">{t("deduction")}</th>
              <th className="num">{t("net")}</th><th className="num">{t("er_cost")}</th>{run ? <th /> : null}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <td><b>{r.name}</b><div className="small muted">{projCode(r.projectId)}</div></td>
                  <td className="num">{canEditRun ? <input name={`b_${r.employeeId}`} id={`b_${r.employeeId}`} className="num" style={{ width: 100 }} defaultValue={q(`b_${r.employeeId}`)} inputMode="decimal" aria-label={t("bonus")} /> : r.bonus ? money(r.bonus) : ""}</td>
                  <td className="num">{money(r.gross)}</td><td className="num">{money(r.paye)}</td><td className="num">{money(r.penE)}</td>
                  <td className="num">{money(r.matE)}</td><td className="num">{money(r.cbhi)}</td>
                  <td className="num">{canEditRun ? <input name={`d_${r.employeeId}`} id={`d_${r.employeeId}`} className="num" style={{ width: 100 }} defaultValue={q(`d_${r.employeeId}`)} inputMode="decimal" aria-label={t("deduction")} /> : r.deduction ? money(r.deduction) : ""}</td>
                  <td className="num"><b>{money(r.net)}</b></td><td className="num">{money(r.employer)}</td>
                  {run ? <td><Link className="small" href={`/payroll/slip?run=${run.id}&emp=${r.employeeId}`} target="_blank">{t("payslip")}</Link></td> : null}
                </tr>
              ))}
              <tr className="total"><td>{t("total")}</td><td className="num">{money(sum("bonus"))}</td><td className="num">{money(sum("gross"))}</td><td className="num">{money(sum("paye"))}</td>
                <td className="num">{money(sum("penE"))}</td><td className="num">{money(sum("matE"))}</td><td className="num">{money(sum("cbhi"))}</td><td className="num">{money(sum("deduction"))}</td>
                <td className="num">{money(sum("net"))}</td><td className="num">{money(sum("employer"))}</td>{run ? <td /> : null}</tr>
            </tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
        {run ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="note ok small">{t("run_exists")}</div>
            <div className="row">
              {entry ? <><Link className="btn primary" href={`/journal/${entry.id}`}>{t("open_entry")}</Link><Pill kind={entry.status}>{t(entry.status === "posted" ? "st_posted" : "st_draft")}</Pill></> : null}
              <span className="spacer" />
              {ctx.canWrite && (!entry || entry.status === "draft" || entry.reversedById)
                ? <ConfirmButton className="btn danger" formAction={deletePayrollRun} name="id" value={run.id} confirmLabel={t("confirm")}>{t("delete_run")}</ConfirmButton> : null}
            </div>
            {entry?.status === "posted" && !entry.reversedById ? <div className="small muted">{t("run_locked")}</div> : null}
          </div>
        ) : ctx.canWrite && rows.length ? (
          <div className="row">
            <button type="submit" className="btn">{t("prepare")}</button>
            <button type="submit" className="btn primary" formAction={createPayrollRun} formMethod="post">{t("create_run")}</button>
          </div>
        ) : null}
      </form>

      <div className="grid2">
        <div className="panel stack">
          <h2>{t("emp_title")}</h2>
          {emps.length ? (
            <div className="tbl-wrap"><table>
              <thead><tr><th>{t("emp_name")}</th><th>{t("project")}</th><th className="num">{t("basic")}</th><th className="num">{t("transport")}</th><th className="num">{t("allowances")}</th><th /></tr></thead>
              <tbody>
                {emps.map((e) => (
                  <tr key={e.id}>
                    <td><b>{e.name}</b><div className="small muted">{[e.position, e.rssbNo].filter(Boolean).join(" · ")}{e.isActive ? "" : ` · ${t("inactive")}`}</div></td>
                    <td>{projCode(e.projectId)}</td><td className="num">{money(e.basic)}</td><td className="num">{money(e.transport)}</td><td className="num">{money(e.other)}</td>
                    <td>{ctx.canWrite ? <a className="btn ghost sm" href={`/payroll?month=${month}&edit=${e.id}#emp`}>{t("edit")}</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : null}
          {ctx.canWrite ? (
            <form action={saveEmployee} className="stack" id="emp" key={editing?.id ?? "new"} style={{ gap: 12 }}>
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <div className="fields">
                <label className="f">{t("emp_name")}<input id="e-name" name="name" defaultValue={editing?.name} required /></label>
                <label className="f">{t("position")}<input id="e-pos" name="position" defaultValue={editing?.position} /></label>
                <label className="f">{t("rssb_no")}<input id="e-rssb" name="rssbNo" defaultValue={editing?.rssbNo} /></label>
                <label className="f">{t("national_id")}<input id="e-nid" name="nationalId" defaultValue={editing?.nationalId} /></label>
                <label className="f">{t("project")}
                  <select id="e-proj" name="projectId" defaultValue={editing?.projectId ?? ""}><option value="">{t("none")}</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
                <label className="f">{t("basic")}<input id="e-basic" name="basic" className="num" defaultValue={editing?.basic ?? ""} inputMode="decimal" required /></label>
                <label className="f">{t("transport")}<input id="e-tr" name="transport" className="num" defaultValue={editing?.transport ?? ""} inputMode="decimal" /></label>
                <label className="f">{t("allowances")}<input id="e-oth" name="other" className="num" defaultValue={editing?.other ?? ""} inputMode="decimal" /></label>
                <label className="f">{t("status")}
                  <select id="e-act" name="isActive" defaultValue={editing?.isActive === false ? "0" : "1"}><option value="1">{t("active")}</option><option value="0">{t("inactive")}</option></select></label>
              </div>
              <div className="row"><button type="submit" className="btn">{editing ? t("update") : t("add_emp")}</button>
                {editing ? <a className="btn ghost" href={`/payroll?month=${month}`}>{t("cancel")}</a> : null}</div>
            </form>
          ) : null}
        </div>

        <form action={savePayrollSettings} className="panel stack">
          <h2>{t("pr_settings")}</h2>
          <div className="note warn small">{t("pr_help")}</div>
          <label className="f">{t("paye_brackets")}<input id="pr-brackets" name="brackets" defaultValue={cfg.brackets} disabled={!ctx.isOwner} /></label>
          <div className="fields">
            <label className="f">{t("pension_emp")}{numIn("pensionEmp")}</label><label className="f">{t("pension_er")}{numIn("pensionEr")}</label>
            <label className="f">{t("mat_emp")}{numIn("matEmp")}</label><label className="f">{t("mat_er")}{numIn("matEr")}</label>
            <label className="f">{t("oh_er")}{numIn("ohEr")}</label><label className="f">{t("cbhi_rate")}{numIn("cbhi")}</label>
            <label className="f">{t("paye_transport")}{yn("payeTransport")}</label><label className="f">{t("rssb_transport")}{yn("rssbTransport")}</label>
          </div>
          <div className="fields">
            <label className="f">{t("acc_salary")}{accSel("accSalary")}</label><label className="f">{t("acc_employer")}{accSel("accEmployer")}</label>
            <label className="f">{t("acc_paye")}{accSel("accPaye")}</label><label className="f">{t("acc_rssb")}{accSel("accRssb")}</label>
            <label className="f">{t("acc_net")}{accSel("accNet")}</label><label className="f">{t("acc_adv")}{accSel("accAdv")}</label>
          </div>
          {ctx.isOwner ? <div><button type="submit" className="btn primary">{t("save")}</button></div> : null}
        </form>
      </div>
    </div>
  );
}
