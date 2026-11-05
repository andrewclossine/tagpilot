import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "@/lib/auth";
import { isSchedule, loadReportLines, periodOf, SCHEDULES, type Schedule } from "@/lib/achievement-reports";
import { addDays, isIsoDate, round2, today } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { childLevel, projectTotals, type LogRow } from "@/lib/programs";
import { lineFlags, loadStatus, quartersOf } from "@/lib/project-status";
import { ConfirmButton } from "@/components/editors";
import { PrintButton } from "@/components/PrintButton";
import { Empty } from "@/components/ui";
import { addFunds, deleteProject, removeAchievementReport, removeLogItem, saveAchievementReport, saveProjectDetails, saveWorkplan } from "../actions";

type Project = typeof schema.projects.$inferSelect;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

function Meter({ value }: { value: number }) {
  const p = Math.round(value * 100);
  return <><span className={`meter${p > 100 ? " over" : ""}`}><i style={{ width: `${Math.min(p, 100)}%` }} /></span> <span className="small num">{pct(value)}</span></>;
}

async function RowActions({ r, base, projectId, view, write }: { r: LogRow; base: string; projectId: string; view: string; write: boolean }) {
  const { t } = await getI18n();
  if (!write) return null;
  const next = childLevel(r.level);
  return (
    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
      <Link className="btn ghost sm" href={`${base}&edit=${r.id}#item-form`}>{t("edit")}</Link>
      {next ? <Link className="btn ghost sm" href={`${base}&add=${r.id}#item-form`}>+ {t(`lv_${next}`)}</Link> : null}
      {!r.hasChildren ? (
        <form action={removeLogItem}>
          <input type="hidden" name="id" value={r.id} /><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="view" value={view} />
          <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton>
        </form>
      ) : null}
    </div>
  );
}

const Title = async ({ r }: { r: LogRow }) => {
  const { t } = await getI18n();
  return (
    <div style={{ paddingLeft: r.depth * 14 }}>
      <div className="small muted">{t(`lv_${r.level}`)} <code className="k">{r.isLine && r.taskCode ? r.taskCode : r.code}</code></div>
      {r.title}
    </div>
  );
};

/** The activity-based budget, as in the project document, with the summary by output and year. */
export async function BudgetView({ ctx, project, rows }: { ctx: Ctx; project: Project; rows: LogRow[] }) {
  const { t, money } = await getI18n();
  const write = ctx.can("projects", "write"), base = `/projects/${project.id}?view=budget`;
  const lines = rows.filter((r) => r.isLine);
  const years = [...new Set(lines.flatMap((r) => Object.keys(r.plan).map((k) => k.slice(0, 2))))].sort();
  const inYear = (r: LogRow, y: string) => Object.entries(r.plan).filter(([k]) => k.startsWith(y)).reduce((s, [, v]) => s + v.amount, 0);
  // Each budget line counts once, under the output it belongs to.
  const under = (o: LogRow) => { const i = rows.indexOf(o); const out: LogRow[] = []; for (let j = i + 1; j < rows.length && rows[j].depth > o.depth; j++) if (rows[j].isLine) out.push(rows[j]); return out; };
  const outputs = rows.filter((r) => r.level === "goal" || r.level === "outcome" || r.level === "output");
  const total = lines.reduce((s, r) => s + r.totalBudget, 0), own = lines.reduce((s, r) => s + r.ownContribution, 0);
  const totals = projectTotals(rows);
  return (
    <div className="stack">
      {rows.length ? (
        <div className="kpis">
          <div className="panel kpi"><div className="label">{t("bg_total_cost")} · {ctx.company.currency}</div><div className="v">{money(totals.budget)}</div></div>
          <div className="panel kpi"><div className="label">{t("st_requested")}</div><div className="v">{money(totals.requested)}</div><div className="small muted">{t("balance_left")} {money(totals.balance)}</div></div>
          <div className="panel kpi"><div className="label">{t("st_budget_exec")}</div><div className="v">{pct(totals.budgetExecution)}</div></div>
          <div className="panel kpi"><div className="label">{t("rp_project_execution")}</div><div className="v">{pct(totals.activityExecution)}</div><div className="small muted">{t("rp_weight_help")}</div></div>
        </div>
      ) : null}
      {outputs.length ? (
        <div className="panel stack">
          <h2>{t("bs_title")}</h2>
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("prj_result")}</th>{years.map((y) => <th key={y} className="num">{t("year")} {y.slice(1)}</th>)}<th className="num">{t("bg_total_cost")}</th><th className="num">{t("bs_share")}</th><th className="num">{t("st_requested")}</th><th>{t("st_budget_exec")}</th><th>{t("rp_project_execution")}</th></tr></thead>
            <tbody>
              {outputs.map((o) => {
                const ls = under(o);
                return (
                  <tr key={o.id} className={`lf-${o.level}`}>
                    <td><div style={{ paddingLeft: o.depth * 14 }}><div className="small muted">{t(`lv_${o.level}`)} <code className="k">{o.code}</code></div>{o.title}</div></td>
                    {years.map((y) => <td key={y} className="num">{money(ls.reduce((s, r) => s + inYear(r, y), 0))}</td>)}
                    <td className="num"><b>{money(o.totalBudget)}</b></td><td className="num">{total ? pct(o.totalBudget / total) : ""}</td>
                    <td className="num">{money(o.executed)}</td><td style={{ whiteSpace: "nowrap" }}><Meter value={o.budgetExecution} /></td><td style={{ whiteSpace: "nowrap" }}><Meter value={o.activityExecution} /></td>
                  </tr>
                );
              })}
              <tr className="total"><td>{t("total")}</td>{years.map((y) => <td key={y} className="num">{money(lines.reduce((s, r) => s + inYear(r, y), 0))}</td>)}<td className="num">{money(total)}</td><td className="num">100%</td><td className="num">{money(totals.requested)}</td><td className="num">{pct(totals.budgetExecution)}</td><td className="num">{pct(totals.activityExecution)}</td></tr>
            </tbody>
          </table></div>
          <div className="small muted">{t("bs_funding")}: {project.donor || t("bs_donor")} {money(total - own)} · {t("bs_own")} {money(own)}</div>
        </div>
      ) : null}
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("prj_result")}</th><th>{t("bg_unit")}</th><th className="num">{t("bg_units")}</th><th className="num">{t("st_unit_cost")}</th><th className="num">{t("bg_total_cost")}</th><th className="num">{t("st_requested")}</th><th className="num">{t("balance_left")}</th><th>{t("st_budget_exec")}</th><th>{t("rp_achieved_pct")}</th><th className="num">{t("st_weight")}</th><th className="num">{t("rp_weighted")}</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={`lf-${r.level}`}>
                <td><Title r={r} /></td>
                <td className="small">{r.unit}</td>
                <td className="num">{r.isLine && r.quantity ? money(r.quantity) : ""}</td><td className="num">{r.isLine && r.unitCost ? money(r.unitCost) : ""}</td>
                <td className="num">{r.isLine ? money(r.totalBudget) : <b>{money(r.totalBudget)}</b>}</td>
                <td className="num">{r.isLine ? <Link href={`/vouchers?line=${r.id}`}>{money(r.executed)}</Link> : money(r.executed)}</td>
                <td className="num" style={{ color: r.totalBudget - r.executed < 0 ? "var(--bad)" : undefined }}>{money(r.totalBudget - r.executed)}</td>
                <td style={{ whiteSpace: "nowrap" }}><Meter value={r.budgetExecution} /></td>
                <td style={{ whiteSpace: "nowrap" }}><Meter value={r.activityExecution} /></td>
                <td className="num">{pct(r.weight)}</td><td className="num">{pct(r.performance)}</td>
                <td><RowActions r={r} base={base} projectId={project.id} view="budget" write={write} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : (
          <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
            <Empty>{t("prj_empty")}</Empty>
            {write ? <Link className="btn primary" href={`/projects/import?project=${project.id}`}>{t("tm_use")}</Link> : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** The workplan, built on the budget: every budget line is here, and people say who does it and when. */
export async function WorkplanView({ ctx, project, rows }: { ctx: Ctx; project: Project; rows: LogRow[] }) {
  const { t, money } = await getI18n();
  const write = ctx.can("projects", "write");
  const quarters = quartersOf(project, rows);
  const now = today();
  if (!rows.some((r) => r.isLine)) return <div className="panel"><Empty>{t("wp_no_budget")}</Empty></div>;
  const table = (
    <div className="tbl-wrap"><table>
      <thead><tr><th>{t("st_activity")}</th><th>{t("rp_target")}</th><th className="num">{t("st_achieved")}</th><th>{t("wp_responsible")}</th><th>{t("wp_start")}</th><th>{t("wp_end")}</th><th>{t("wp_done")}</th>{quarters.map((q) => <th key={q.key} className="small" style={{ textAlign: "center", whiteSpace: "nowrap" }} title={q.from ? `${q.from} → ${q.to}` : undefined}>{q.label}</th>)}</tr></thead>
      <tbody>{rows.map((r) => {
        const late = r.isLine && !!r.endDate && r.endDate < now && r.activityExecution < 1;
        return (
          <tr key={r.id} className={`lf-${r.level}`}>
            <td style={{ minWidth: 260 }}><div style={{ paddingLeft: r.depth * 14 }}><code className="k">{r.isLine && r.taskCode ? r.taskCode : r.code}</code> {r.title}</div></td>
            <td className="num small" style={{ whiteSpace: "nowrap" }}>{r.isLine ? `${money(r.quantity)} ${r.unit}` : ""}</td>
            <td className="num small">{r.isLine ? money(r.achieved) : ""}</td>
            {r.isLine ? (
              write ? (
                <>
                  <td><input id={`wp-r-${r.id}`} name={`resp_${r.id}`} defaultValue={r.responsible} aria-label={t("wp_responsible")} style={{ minWidth: 130 }} /></td>
                  <td><input id={`wp-s-${r.id}`} name={`start_${r.id}`} type="date" defaultValue={r.startDate ?? ""} aria-label={t("wp_start")} /></td>
                  <td><input id={`wp-e-${r.id}`} name={`end_${r.id}`} type="date" defaultValue={r.endDate ?? ""} aria-label={t("wp_end")} style={{ color: late ? "var(--bad)" : undefined }} /></td>
                </>
              ) : (
                <>
                  <td className="small">{r.responsible}</td><td className="small" style={{ whiteSpace: "nowrap" }}>{r.startDate ?? ""}</td>
                  <td className="small" style={{ whiteSpace: "nowrap", color: late ? "var(--bad)" : undefined }}>{r.endDate ?? ""}</td>
                </>
              )
            ) : <td colSpan={3} />}
            <td style={{ whiteSpace: "nowrap" }}><Meter value={r.activityExecution} /></td>
            {quarters.map((q) => {
              const on = !!(r.isLine && r.startDate && r.endDate && q.from && q.to && r.startDate <= q.to && r.endDate >= q.from);
              return <td key={q.key} style={{ padding: 2 }}><div className={on ? `wp-bar${r.activityExecution >= 1 ? " done" : late ? " late" : ""}` : ""} style={{ height: 14 }} /></td>;
            })}
          </tr>
        );
      })}</tbody>
    </table></div>
  );
  if (!write) return <div className="panel stack">{table}</div>;
  return (
    <form action={saveWorkplan} className="panel stack">
      <input type="hidden" name="projectId" value={project.id} />
      <div className="small muted">{t("wp_help")}</div>
      <div className="fields">
        <label className="f">{t("wp_project_start")}<input id="wp-start" name="startDate" type="date" defaultValue={project.startDate ?? ""} /></label>
        <label className="f">{t("wp_project_end")}<input id="wp-end" name="endDate" type="date" defaultValue={project.endDate ?? ""} /></label>
      </div>
      {!project.startDate ? <div className="note warn small">{t("wp_no_start")}</div> : null}
      {table}
      <div><button type="submit" className="btn primary">{t("save")}</button></div>
    </form>
  );
}

/** The progress report: for the chosen period, each budget line's previous achievement, this period's, and the total against its target. */
export async function AchievementsView({ ctx, project, rows, schedule: wantedSchedule, date: wantedDate }: { ctx: Ctx; project: Project; rows: LogRow[]; schedule: string; date: string }) {
  const { t, money } = await getI18n();
  const write = ctx.can("achievements", "write");
  if (!rows.some((r) => r.isLine)) return <div className="panel"><Empty>{t("wp_no_budget")}</Empty></div>;
  const schedule: Schedule = isSchedule(wantedSchedule) ? wantedSchedule : "monthly";
  const date = isIsoDate(wantedDate) ? wantedDate : today();
  const { from, to } = periodOf(schedule, date);
  const db = await getDb();
  const reports = await db.select({ r: schema.achievementReports, who: schema.users.name }).from(schema.achievementReports)
    .leftJoin(schema.users, eq(schema.users.id, schema.achievementReports.createdBy))
    .where(eq(schema.achievementReports.projectId, project.id)).orderBy(desc(schema.achievementReports.periodFrom));
  const current = reports.find(({ r }) => r.schedule === schedule && r.periodFrom === from && r.periodTo === to)?.r;
  const overlap = reports.find(({ r }) => r !== current && r.periodFrom <= to && r.periodTo >= from)?.r;
  const { byId, before, after } = await loadReportLines(db, ctx.company.id, project.id, current?.id ?? null, to, rows);
  const totals = projectTotals(rows);
  const canSave = write && !overlap && from <= today() && (!current || ctx.role !== "staff" || current.createdBy === ctx.user.id);
  // A row above the budget lines shows the weighted achievement of the lines under it.
  const underShare = (i: number) => {
    const out = { budget: 0, done: 0 };
    for (let j = i + 1; j < rows.length && rows[j].depth > rows[i].depth; j++) if (rows[j].isLine) { const l = byId.get(rows[j].id); out.budget += rows[j].budget; out.done += rows[j].budget * (l?.share ?? 0); }
    return out.budget ? out.done / out.budget : 0;
  };
  const table = (
    <div className="tbl-wrap"><table>
      <thead><tr><th>{t("st_activity")}</th><th>{t("bg_unit")}</th><th className="num">{t("rp_target")}</th><th className="num">{t("rp_previous")}</th><th className="num">{t("rp_this_period")}</th><th className="num">{t("rp_total")}</th><th className="num">{t("rp_achieved_pct")}</th><th className="num">{t("bg_total_cost")}</th><th className="num">{t("st_weight")}</th><th className="num">{t("rp_weighted")}</th><th>{t("description")}</th></tr></thead>
      <tbody>{rows.map((r, i) => {
        const l = byId.get(r.id);
        if (!r.isLine) {
          const share = underShare(i);
          return <tr key={r.id} className={`lf-${r.level}`}><td style={{ minWidth: 260 }}><div style={{ paddingLeft: r.depth * 14 }}><code className="k">{r.code}</code> <b>{r.title}</b></div></td><td colSpan={5} /><td className="num"><b>{pct(share)}</b></td><td className="num"><b>{money(r.totalBudget)}</b></td><td className="num">{pct(r.weight)}</td><td className="num">{pct(share * r.weight)}</td><td /></tr>;
        }
        return (
          <tr key={r.id} className={`lf-${r.level}`}>
            <td style={{ minWidth: 260 }}><div style={{ paddingLeft: r.depth * 14 }}><code className="k">{r.taskCode || r.code}</code> {r.title}</div></td>
            <td className="small">{r.unit}</td>
            <td className="num">{money(r.quantity)}</td>
            <td className="num">{money(l?.previous ?? 0)}</td>
            <td className="num" style={{ minWidth: 100 }}>{canSave ? <input id={`rp-q-${r.id}`} name={`qty_${r.id}`} className="num" inputMode="decimal" defaultValue={l?.current || ""} aria-label={t("rp_this_period")} /> : money(l?.current ?? 0)}</td>
            <td className="num">{money(l?.total ?? 0)}</td>
            <td style={{ whiteSpace: "nowrap" }}><Meter value={r.quantity > 0 ? (l?.total ?? 0) / r.quantity : 0} /></td>
            <td className="num">{money(r.budget)}</td>
            <td className="num">{pct(r.weight)}</td>
            <td className="num">{pct(l?.weighted ?? 0)}</td>
            <td>{canSave ? <input id={`rp-n-${r.id}`} name={`note_${r.id}`} defaultValue={l?.note} aria-label={t("description")} style={{ minWidth: 140 }} /> : <span className="small">{l?.note}</span>}</td>
          </tr>
        );
      })}
        <tr className="total"><td colSpan={7}>{t("rp_project_execution")}</td><td className="num">{money(totals.budget)}</td><td className="num">100%</td><td className="num">{pct(after)}</td><td /></tr>
      </tbody>
    </table></div>
  );
  return (
    <div className="stack">
      <form method="get" className="panel row noprint">
        <input type="hidden" name="view" value="achievements" />
        <label className="f">{t("rp_schedule")}
          <select id="rp-schedule" name="schedule" defaultValue={schedule}>{SCHEDULES.map((s) => <option key={s} value={s}>{t(`rp_${s}`)}</option>)}</select></label>
        <label className="f">{t(schedule === "biweekly" ? "rp_first_day" : "rp_date_in_period")}<input id="rp-date" name="date" type="date" defaultValue={date} /></label>
        <button type="submit" className="btn">{t("show")}</button>
        <span className="spacer" />
        <PrintButton label={t("r_print")} />
      </form>
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("rp_previous_execution")}</div><div className="v">{pct(before)}</div></div>
        <div className="panel kpi"><div className="label">{t("rp_this_execution")}</div><div className="v">+{pct(after - before)}</div></div>
        <div className="panel kpi"><div className="label">{t("rp_project_execution")}</div><div className="v">{pct(after)}</div><div className="small muted">{t("rp_weight_help")}</div></div>
        <div className="panel kpi"><div className="label">{t("st_budget_exec")}</div><div className="v">{pct(totals.budgetExecution)}</div><div className="small muted">{money(totals.requested)} / {money(totals.budget)}</div></div>
      </div>
      {canSave ? (
        <form action={saveAchievementReport} className="panel stack">
          <h2>{t(`rp_${schedule}`)} · {from} → {to}{current ? <span className="small muted"> · {t("rp_editing")}</span> : null}</h2>
          <input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="schedule" value={schedule} /><input type="hidden" name="date" value={date} />
          {table}
          <label className="f">{t("ac_evidence")}<input id="rp-file" name="file" type="file" accept="image/*,application/pdf" /></label>
          <div><button type="submit" className="btn primary">{t("rp_save")}</button></div>
        </form>
      ) : (
        <div className="panel stack">
          <h2>{t(`rp_${schedule}`)} · {from} → {to}</h2>
          {overlap ? <div className="note warn small">{t("err_report_overlap")} ({overlap.periodFrom} → {overlap.periodTo})</div> : null}
          {from > today() ? <div className="note warn small">{t("err_report_future")}</div> : null}
          {table}
        </div>
      )}
      <div className="panel stack noprint">
        <h2>{t("rp_reports")}</h2>
        {reports.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("rp_schedule")}</th><th>{t("rp_period")}</th><th>{t("audit_who")}</th><th /></tr></thead>
            <tbody>{reports.map(({ r, who }) => (
              <tr key={r.id}>
                <td>{t(`rp_${r.schedule}`)}</td>
                <td><Link className="rowlink" href={`/projects/${project.id}?view=achievements&schedule=${r.schedule}&date=${r.periodFrom}`}>{r.periodFrom} → {r.periodTo}</Link></td>
                <td className="small">{who}</td>
                <td>{write && (ctx.role !== "staff" || r.createdBy === ctx.user.id) ? (
                  <form action={removeAchievementReport}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="projectId" value={project.id} />
                    <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
                ) : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}

/** The project implementation status: funds requested against achievements, line by line and overall. */
export async function StatusView({ ctx, project, to }: { ctx: Ctx; project: Project; to: string }) {
  const { t, money } = await getI18n();
  const s = await loadStatus(ctx, project.id, to);
  if (!s) return null;
  const { rows, totals, on, received, funds, plannedProgress } = s;
  const lines = rows.filter((r) => r.isLine);
  const flagged = lines.map((r) => ({ r, flags: lineFlags(r, on) })).filter((x) => x.flags.length);
  const outputs = rows.filter((r) => r.level === "output");
  const write = ctx.can("projects", "write");
  const shown = rows.filter((r) => r.level !== "goal" && r.level !== "outcome");
  return (
    <div className="stack">
      <form method="get" className="row noprint">
        <input type="hidden" name="view" value="status" />
        <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{t("st_as_of")}<input id="st-to" name="to" type="date" defaultValue={on} style={{ width: "auto" }} /></label>
        <button type="submit" className="btn sm">{t("show")}</button>
        <span className="spacer" />
        <a className="btn sm" href={`/api/export/project-status/${project.id}?to=${on}`}>{t("st_excel")}</a>
      </form>
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("budget")} · {ctx.company.currency}</div><div className="v">{money(totals.budget)}</div></div>
        <div className="panel kpi"><div className="label">{t("st_requested")}</div><div className="v">{money(totals.requested)}</div><div className="small muted">{t("prj_paid")} {money(totals.paid)}</div></div>
        <div className="panel kpi"><div className="label">{t("balance_left")}</div><div className="v">{money(totals.balance)}</div></div>
        <div className="panel kpi"><div className="label">{t("st_activity_exec")}</div><div className="v">{pct(totals.activityExecution)}</div><div className="small muted">{t("st_expected")} {pct(plannedProgress)}</div></div>
        <div className="panel kpi"><div className="label">{t("st_budget_exec")}</div><div className="v">{pct(totals.budgetExecution)}</div></div>
        <div className="panel kpi"><div className="label">{t("st_funds_received")}</div><div className="v">{money(received)}</div><div className="small" style={{ color: received - totals.requested < 0 ? "var(--bad)" : "var(--muted)" }}>{t("st_funds_balance")} {money(received - totals.requested)}</div></div>
      </div>
      {flagged.length ? (
        <div className="panel stack">
          <h2>{t("st_attention")} <span className="small muted">· {flagged.length}</span></h2>
          <div className="tbl-wrap"><table>
            <tbody>{flagged.slice(0, 30).map(({ r, flags }) => (
              <tr key={r.id}>
                <td><code className="k">{r.taskCode || r.code}</code> {r.title}</td>
                <td className="num small">{t("st_activity_exec")} {pct(r.activityExecution)}</td><td className="num small">{t("st_budget_exec")} {pct(r.budgetExecution)}</td>
                <td>{flags.map((f) => <span key={f} className={`pill ${f === "overspent" || f === "late" ? "void" : "draft"}`} style={{ marginRight: 4 }}>{t(`fl_${f}`)}</span>)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ) : null}
      {outputs.length ? (
        <div className="panel stack">
          <h2>{t("st_by_output")}</h2>
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("lv_output")}</th><th className="num">{t("budget")}</th><th className="num">{t("st_requested")}</th><th className="num">{t("balance_left")}</th><th>{t("st_activity_exec")}</th><th>{t("st_budget_exec")}</th><th className="num">{t("st_weight")}</th><th className="num">{t("st_performance")}</th></tr></thead>
            <tbody>
              {outputs.map((o) => (
                <tr key={o.id}><td><code className="k">{o.code}</code> {o.title}</td><td className="num">{money(o.totalBudget)}</td><td className="num">{money(o.executed)}</td><td className="num">{money(o.totalBudget - o.executed)}</td>
                  <td style={{ whiteSpace: "nowrap" }}><Meter value={o.activityExecution} /></td><td style={{ whiteSpace: "nowrap" }}><Meter value={o.budgetExecution} /></td><td className="num">{pct(o.weight)}</td><td className="num">{pct(o.performance)}</td></tr>
              ))}
              <tr className="total"><td>{t("total")}</td><td className="num">{money(totals.budget)}</td><td className="num">{money(totals.requested)}</td><td className="num">{money(totals.balance)}</td><td className="num">{pct(totals.activityExecution)}</td><td className="num">{pct(totals.budgetExecution)}</td><td className="num">100%</td><td className="num">{pct(totals.activityExecution)}</td></tr>
            </tbody>
          </table></div>
        </div>
      ) : null}
      <div className="panel stack">
        <h2>{t("st_detail")}</h2>
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("st_activity")}</th><th className="num">{t("qty")}</th><th className="num">{t("st_achieved")}</th><th className="num">{t("budget")}</th><th className="num">{t("st_requested")}</th><th className="num">{t("balance_left")}</th><th>{t("st_activity_exec")}</th><th>{t("st_budget_exec")}</th><th className="num">{t("st_weight")}</th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id} className={`lf-${r.level}`}>
              <td style={{ minWidth: 240 }}><Title r={r} /></td>
              <td className="num">{r.isLine ? `${money(r.quantity)} ${r.unit}` : ""}</td><td className="num">{r.isLine ? money(r.achieved) : ""}</td>
              <td className="num">{money(r.totalBudget)}</td>
              <td className="num">{r.isLine ? <Link href={`/vouchers?line=${r.id}`}>{money(r.executed)}</Link> : money(r.executed)}</td>
              <td className="num" style={{ color: r.totalBudget - r.executed < 0 ? "var(--bad)" : undefined }}>{money(r.totalBudget - r.executed)}</td>
              <td style={{ whiteSpace: "nowrap" }}><Meter value={r.activityExecution} /></td>
              <td style={{ whiteSpace: "nowrap" }}><Meter value={r.budgetExecution} /></td>
              <td className="num">{pct(r.weight)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="panel stack">
        <h2>{t("st_funds_received")}</h2>
        {funds.length ? (
          <table><tbody>{funds.map((f) => <tr key={f.id}><td>{f.date}</td><td>{f.reference}</td><td className="num">{money(f.amount, 2)}</td></tr>)}<tr className="total"><td colSpan={2}>{t("total")}</td><td className="num">{money(round2(funds.reduce((x, f) => x + f.amount, 0)), 2)}</td></tr></tbody></table>
        ) : <Empty>{t("nothing_yet")}</Empty>}
        {write ? (
          <form action={addFunds} className="row">
            <input type="hidden" name="projectId" value={project.id} />
            <input id="f-date" name="date" type="date" required defaultValue={today()} style={{ width: "auto" }} aria-label={t("date")} />
            <input id="f-amount" name="amount" className="num" inputMode="decimal" required placeholder={t("amount")} style={{ width: 160 }} aria-label={t("amount")} />
            <input id="f-ref" name="reference" placeholder={t("reference")} style={{ width: 200 }} aria-label={t("reference")} />
            <button type="submit" className="btn sm">{t("add")}</button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

/** The project's details, as on the first sheet of the project document. */
export async function DetailsView({ ctx, project, rows }: { ctx: Ctx; project: Project; rows: LogRow[] }) {
  const { t } = await getI18n();
  const write = ctx.can("projects", "write");
  return (
    <div className="stack">
      <form action={saveProjectDetails} className="panel stack">
        <input type="hidden" name="id" value={project.id} />
        <fieldset disabled={!write} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <label className="f">{t("name")}<input id="d-name" name="name" required defaultValue={project.name} /></label>
          <label className="f">{t("prj_full_title")}<textarea id="d-desc" name="description" rows={2} defaultValue={project.description} /></label>
          <div className="fields">
            <label className="f">{t("donor")}<input id="d-donor" name="donor" defaultValue={project.donor} /></label>
            <label className="f">{t("wp_start")}<input id="d-start" name="startDate" type="date" defaultValue={project.startDate ?? ""} /></label>
            <label className="f">{t("wp_end")}<input id="d-end" name="endDate" type="date" defaultValue={project.endDate ?? (project.startDate ? addDays(project.startDate, 730) : "")} /></label>
          </div>
          {write ? <div><button type="submit" className="btn primary">{t("save")}</button></div> : null}
        </fieldset>
      </form>
      {write ? (
        <form action={deleteProject} className="panel row">
          <input type="hidden" name="id" value={project.id} />
          <span className="small muted" style={{ flex: 1 }}>{t("prj_delete_help").replace("{n}", String(rows.length))}</span>
          <ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("prj_delete")}</ConfirmButton>
        </form>
      ) : null}
    </div>
  );
}
