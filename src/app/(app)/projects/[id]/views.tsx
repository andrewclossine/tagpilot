import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "@/lib/auth";
import { addDays, round2, today } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { childLevel, type LogRow } from "@/lib/programs";
import { lineFlags, loadStatus, quartersOf } from "@/lib/project-status";
import { ConfirmButton } from "@/components/editors";
import { Empty } from "@/components/ui";
import { addAchievement, addFunds, addIndicator, deleteProject, removeAchievement, removeLogItem, saveIndicatorResults, saveProjectDetails } from "../actions";

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
  const outputs = rows.filter((r) => r.level === "output");
  const total = lines.reduce((s, r) => s + r.totalBudget, 0), own = lines.reduce((s, r) => s + r.ownContribution, 0);
  return (
    <div className="stack">
      {outputs.length ? (
        <div className="panel stack">
          <h2>{t("bs_title")}</h2>
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("lv_output")}</th>{years.map((y) => <th key={y} className="num">{t("year")} {y.slice(1)}</th>)}<th className="num">{t("total")}</th><th className="num">{t("bs_share")}</th></tr></thead>
            <tbody>
              {outputs.map((o) => {
                const ls = under(o);
                return (
                  <tr key={o.id}>
                    <td><code className="k">{o.code}</code> {o.title}</td>
                    {years.map((y) => <td key={y} className="num">{money(ls.reduce((s, r) => s + inYear(r, y), 0))}</td>)}
                    <td className="num"><b>{money(o.totalBudget)}</b></td><td className="num">{total ? pct(o.totalBudget / total) : ""}</td>
                  </tr>
                );
              })}
              <tr className="total"><td>{t("total")}</td>{years.map((y) => <td key={y} className="num">{money(lines.reduce((s, r) => s + inYear(r, y), 0))}</td>)}<td className="num">{money(total)}</td><td className="num">100%</td></tr>
            </tbody>
          </table></div>
          <div className="small muted">{t("bs_funding")}: {project.donor || t("bs_donor")} {money(total - own)} · {t("bs_own")} {money(own)}</div>
        </div>
      ) : null}
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("prj_result")}</th><th>{t("bg_category")}</th><th>{t("gr_unit")}</th><th className="num">{t("qty")}</th><th className="num">{t("st_unit_cost")}</th><th className="num">{t("budget")}</th><th className="num">{t("prj_executed")}</th><th className="num">{t("balance_left")}</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={`lf-${r.level}`}>
                <td><Title r={r} /></td>
                <td className="small">{r.category}</td><td className="small">{r.unit}</td>
                <td className="num">{r.isLine && r.quantity ? money(r.quantity) : ""}</td><td className="num">{r.isLine && r.unitCost ? money(r.unitCost) : ""}</td>
                <td className="num">{money(r.totalBudget)}</td>
                <td className="num">{r.isLine ? <Link href={`/vouchers?line=${r.id}`}>{money(r.executed)}</Link> : money(r.executed)}</td>
                <td className="num" style={{ color: r.totalBudget - r.executed < 0 ? "var(--bad)" : undefined }}>{money(r.totalBudget - r.executed)}</td>
                <td><RowActions r={r} base={base} projectId={project.id} view="budget" write={write} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("prj_empty")}</Empty>}
      </div>
    </div>
  );
}

/** The logical framework: each result with its indicators, milestones and what has been achieved. */
export async function LogframeView({ ctx, project, rows }: { ctx: Ctx; project: Project; rows: LogRow[] }) {
  const { t, money } = await getI18n();
  const write = ctx.can("projects", "write"), canResult = ctx.can("achievements", "write"), base = `/projects/${project.id}?view=logframe`;
  const results = rows.filter((r) => r.level === "goal" || r.level === "outcome" || r.level === "output");
  const db = await getDb();
  const list = results.length ? await db.select().from(schema.indicators).where(inArray(schema.indicators.itemId, results.map((r) => r.id))).orderBy(schema.indicators.sortOrder) : [];
  if (!rows.length) return <div className="panel"><Empty>{t("prj_empty")}</Empty></div>;
  return (
    <div className="stack">
      {results.map((r) => (
        <div key={r.id} className="panel stack">
          <div className="row">
            <div style={{ flex: 1, minWidth: 220 }}><div className="label">{t(`lv_${r.level}`)} {r.code}</div><b>{r.title}</b></div>
            <RowActions r={r} base={base} projectId={project.id} view="logframe" write={write} />
          </div>
          {list.filter((i) => i.itemId === r.id).map((i) => {
            const achieved = i.milestones.reduce((s, m) => s + (m.achieved ?? 0), 0);
            return (
              <form key={i.id} action={saveIndicatorResults} className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 10, gap: 8 }}>
                <input type="hidden" name="id" value={i.id} /><input type="hidden" name="projectId" value={project.id} />
                <div><b className="small">{i.name}</b><div className="small muted">
                  {t("lf_baseline")}: {i.baseline ?? "—"} · {t("prj_target")}: {i.target ?? "—"}{i.target ? ` · ${t("st_achieved")}: ${money(achieved)} (${pct(achieved / i.target)})` : ""}{i.source ? ` · ${t("prj_verification")}: ${i.source}` : ""}
                </div></div>
                {i.milestones.length ? (
                  <div className="tbl-wrap"><table className="small">
                    <thead><tr><th />{i.milestones.map((m, n) => <th key={n} className="num">{m.label}</th>)}</tr></thead>
                    <tbody>
                      <tr><td>{t("lf_planned")}</td>{i.milestones.map((m, n) => <td key={n} className="num">{m.planned ?? ""}</td>)}</tr>
                      <tr><td>{t("st_achieved")}</td>{i.milestones.map((m, n) => <td key={n} className="num">{canResult
                        ? <input id={`ach-${i.id}-${n}`} name={`achieved_${n}`} className="num" inputMode="decimal" defaultValue={m.achieved ?? ""} style={{ width: 80 }} aria-label={`${t("st_achieved")} ${m.label}`} />
                        : m.achieved ?? ""}</td>)}</tr>
                    </tbody>
                  </table></div>
                ) : null}
                {i.assumptions ? <div className="small muted">{t("prj_assumptions")}: {i.assumptions}</div> : null}
                {canResult && i.milestones.length ? <div><button type="submit" className="btn sm">{t("save")}</button></div> : null}
              </form>
            );
          })}
          {write ? (
            <form action={addIndicator} className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 10, gap: 8 }}>
              <input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="itemId" value={r.id} />
              <div className="fields">
                <label className="f small">{t("prj_indicator")}<input id={`ni-${r.id}`} name="name" required /></label>
                <label className="f small">{t("lf_baseline")}<input id={`nib-${r.id}`} name="baseline" className="num" inputMode="decimal" /></label>
                <label className="f small">{t("prj_target")}<input id={`nit-${r.id}`} name="target" className="num" inputMode="decimal" /></label>
                <label className="f small">{t("lf_milestones")}<input id={`nim-${r.id}`} name="milestones" placeholder="Y1:40, Y2:60" /></label>
                <label className="f small">{t("prj_verification")}<input id={`nis-${r.id}`} name="source" /></label>
              </div>
              <div><button type="submit" className="btn sm">{t("lf_add_indicator")}</button></div>
            </form>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** The workplan: who does what and when, by quarter, with what is done so far. */
export async function WorkplanView({ ctx, project, rows }: { ctx: Ctx; project: Project; rows: LogRow[] }) {
  const { t } = await getI18n();
  const write = ctx.can("projects", "write"), base = `/projects/${project.id}?view=workplan`;
  const shown = rows.filter((r) => r.level === "output" || r.level === "activity");
  const quarters = quartersOf(project, rows);
  const now = today();
  if (!shown.length) return <div className="panel"><Empty>{t("prj_empty")}</Empty></div>;
  return (
    <div className="panel stack">
      {!project.startDate ? <div className="note warn small">{t("wp_no_start")}</div> : null}
      <div className="tbl-wrap"><table>
        <thead><tr><th>{t("st_activity")}</th><th>{t("wp_responsible")}</th><th>{t("wp_start")}</th><th>{t("wp_end")}</th><th>{t("wp_done")}</th>{quarters.map((q) => <th key={q.key} className="small" style={{ textAlign: "center", whiteSpace: "nowrap" }} title={q.from ? `${q.from} → ${q.to}` : undefined}>{q.label}</th>)}<th /></tr></thead>
        <tbody>{shown.map((r) => {
          const late = r.level === "activity" && !!r.endDate && r.endDate < now && r.activityExecution < 1;
          return (
            <tr key={r.id} className={`lf-${r.level}`}>
              <td style={{ minWidth: 240 }}><code className="k">{r.code}</code> {r.title}</td>
              <td className="small">{r.responsible}</td>
              <td className="small" style={{ whiteSpace: "nowrap" }}>{r.startDate ?? ""}</td>
              <td className="small" style={{ whiteSpace: "nowrap", color: late ? "var(--bad)" : undefined }}>{r.endDate ?? ""}</td>
              <td style={{ whiteSpace: "nowrap" }}><Meter value={r.activityExecution} /></td>
              {quarters.map((q) => {
                const on = !!(r.startDate && r.endDate && q.from && q.to && r.startDate <= q.to && r.endDate >= q.from);
                return <td key={q.key} style={{ padding: 2 }}><div className={on ? `wp-bar${r.activityExecution >= 1 ? " done" : late ? " late" : ""}` : ""} style={{ height: 14 }} /></td>;
              })}
              <td>{r.level === "activity" ? <RowActions r={r} base={base} projectId={project.id} view="workplan" write={write} /> : null}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </div>
  );
}

/** Where people record what was actually done on each budget line. */
export async function AchievementsView({ ctx, project, rows }: { ctx: Ctx; project: Project; rows: LogRow[] }) {
  const { t, money } = await getI18n();
  const write = ctx.can("achievements", "write");
  const lines = rows.filter((r) => r.isLine);
  const db = await getDb();
  const list = await db.select({ a: schema.achievements, who: schema.users.name }).from(schema.achievements)
    .leftJoin(schema.users, eq(schema.users.id, schema.achievements.enteredBy)).where(eq(schema.achievements.projectId, project.id));
  list.sort((x, y) => y.a.date.localeCompare(x.a.date));
  return (
    <div className="stack">
      {write && lines.length ? (
        <form action={addAchievement} className="panel stack">
          <h2>{t("ac_add")}</h2>
          <input type="hidden" name="projectId" value={project.id} />
          <label className="f">{t("pv_budget_line")}
            <select id="a-line" name="budgetItemId" required defaultValue="">
              <option value="">{t("none")}</option>
              {lines.map((l) => <option key={l.id} value={l.id}>{l.taskCode || l.code} {l.title.slice(0, 80)} ({money(l.achieved)} / {money(l.quantity)} {l.unit})</option>)}
            </select></label>
          <div className="fields">
            <label className="f">{t("date")}<input id="a-date" name="date" type="date" required defaultValue={today()} /></label>
            <label className="f">{t("ac_quantity")}<input id="a-qty" name="quantity" className="num" inputMode="decimal" required /></label>
            <label className="f">{t("ac_evidence")}<input id="a-file" name="file" type="file" accept="image/*,application/pdf" /></label>
          </div>
          <label className="f">{t("description")}<input id="a-desc" name="description" /></label>
          <div><button type="submit" className="btn primary">{t("save")}</button></div>
        </form>
      ) : null}
      <div className="panel stack">
        <h2>{t("ac_history")}</h2>
        {list.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("date")}</th><th>{t("pv_budget_line")}</th><th className="num">{t("qty")}</th><th>{t("description")}</th><th>{t("ach_recorded_by")}</th><th /></tr></thead>
            <tbody>{list.map(({ a, who }) => {
              const l = lines.find((x) => x.id === a.budgetItemId);
              return (
                <tr key={a.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{a.date}</td>
                  <td><code className="k">{l?.taskCode || l?.code}</code> {l?.title}</td>
                  <td className="num">{money(a.quantity)} {l?.unit}</td>
                  <td>{a.description}{a.attachmentId ? <> · <a className="small" href={`/api/files/${a.attachmentId}`} target="_blank" rel="noreferrer">{t("tn_file")}</a></> : null}</td>
                  <td className="small">{who}</td>
                  <td>{write ? (
                    <form action={removeAchievement}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="projectId" value={project.id} />
                      <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
                  ) : null}</td>
                </tr>
              );
            })}</tbody>
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
