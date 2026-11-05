import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isIsoDate, isUuid } from "@/lib/format";
import { childLevel, isBudgetLine, logframe, projectTotals } from "@/lib/programs";
import { quartersOf } from "@/lib/project-status";
import type { LogframeLevel } from "@/db/schema";
import { ErrorNote, PageHead, Tabs } from "@/components/ui";
import { saveLogItem } from "../actions";
import { AchievementsView, BudgetView, DetailsView, LogframeView, StatusView, WorkplanView } from "./views";

export const metadata = { title: "Project" };

const VIEWS = ["status", "budget", "workplan", "achievements", "logframe", "details"] as const;

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("projects");
  const { t, err, money, accName } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const view = VIEWS.find((v) => v === q("view")) ?? "status";
  const db = await getDb();
  const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.companyId, ctx.company.id)));
  if (!project) notFound();
  const [rows, accounts] = await Promise.all([
    logframe(db, ctx.company.id, id),
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), eq(schema.accounts.isActive, true), inArray(schema.accounts.type, ["expense", "asset"]))).orderBy(schema.accounts.code),
  ]);
  const write = ctx.can("projects", "write");
  const base = `/projects/${id}?view=${view}`;
  const lv = (l: LogframeLevel) => t(`lv_${l}`);

  // What the form on this page is doing: adding under a row, adding a goal, or editing a row.
  const editing = rows.find((r) => r.id === q("edit"));
  const parent = rows.find((r) => r.id === q("add"));
  const adding = q("add") === "root" || !!parent;
  const formLevel = editing?.level ?? (adding ? childLevel(parent?.level ?? null) : null);
  const canBudget = formLevel === "activity" || formLevel === "sub_activity";
  const budgetEditable = canBudget && (!editing || isBudgetLine(editing.level, editing.hasChildren));
  const quarters = quartersOf(project, rows);
  const totals = projectTotals(rows);

  return (
    <div className="stack">
      <PageHead title={`${project.code} · ${project.name}`}>
        <Link className="btn" href="/projects">{t("back")}</Link>
        {ctx.can("vouchers", "write") ? <Link className="btn primary" href={`/vouchers/new?project=${id}`}>{t("pv_new")}</Link> : null}
      </PageHead>
      {project.description ? <p className="muted small" style={{ margin: 0 }}>{project.description}</p> : null}
      <ErrorNote message={err(q("error"))} />
      {q("imported") ? <div className="note ok small">{t("im_done").replace("{n}", String(rows.filter((r) => r.isLine).length)).replace("{total}", money(totals.budget))}</div> : null}
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {(q("imported") || view === "details") && project.importNotes.length ? (
        <div className="note warn small"><b>{t("im_notes")}</b><ul>{project.importNotes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>
      ) : null}
      <div className="row">
        <Tabs current={view} items={VIEWS.map((v) => ({ key: v, href: `/projects/${id}?view=${v}`, label: t(`tab_${v}`) }))} />
        <span className="spacer" />
        {write && (view === "budget" || view === "logframe") ? <Link className="btn sm" href={`${base}&add=root#item-form`}>+ {lv("goal")}</Link> : null}
      </div>
      {view === "status" ? <StatusView ctx={ctx} project={project} to={isIsoDate(q("to")) ? q("to") : ""} /> : null}
      {view === "budget" ? <BudgetView ctx={ctx} project={project} rows={rows} /> : null}
      {view === "workplan" ? <WorkplanView ctx={ctx} project={project} rows={rows} /> : null}
      {view === "achievements" ? <AchievementsView ctx={ctx} project={project} rows={rows} /> : null}
      {view === "logframe" ? <LogframeView ctx={ctx} project={project} rows={rows} /> : null}
      {view === "details" ? <DetailsView ctx={ctx} project={project} rows={rows} /> : null}
      {write && formLevel ? (
        <form action={saveLogItem} className="panel stack" id="item-form" key={editing?.id ?? q("add")}>
          <h2>{editing ? `${t("edit")}: ${lv(formLevel)} ${editing.code}` : `${t("add")}: ${lv(formLevel)}`}{parent ? <span className="muted small"> · {parent.code} {parent.title}</span> : null}</h2>
          <input type="hidden" name="projectId" value={id} /><input type="hidden" name="view" value={view} />
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          {parent ? <input type="hidden" name="parentId" value={parent.id} /> : null}
          <label className="f">{t("prj_statement")}<textarea id="i-title" name="title" rows={2} required defaultValue={editing?.title} /></label>
          {!canBudget ? (
            <div className="fields">
              <label className="f">{t("prj_indicator")}<input id="i-indicator" name="indicator" defaultValue={editing?.indicator} /></label>
              <label className="f">{t("prj_target")}<input id="i-target" name="target" defaultValue={editing?.target} /></label>
              <label className="f">{t("prj_verification")}<input id="i-verification" name="verification" defaultValue={editing?.verification} /></label>
              <label className="f">{t("prj_assumptions")}<input id="i-assumptions" name="assumptions" defaultValue={editing?.assumptions} /></label>
            </div>
          ) : (
            <div className="fields">
              <label className="f">{t("wp_responsible")}<input id="i-resp" name="responsible" defaultValue={editing?.responsible} /></label>
              <label className="f">{t("wp_start")}<input id="i-start" name="startDate" type="date" defaultValue={editing?.startDate ?? parent?.startDate ?? ""} /></label>
              <label className="f">{t("wp_end")}<input id="i-end" name="endDate" type="date" defaultValue={editing?.endDate ?? parent?.endDate ?? ""} /></label>
            </div>
          )}
          {budgetEditable ? (
            <>
              <div className="fields">
                <label className="f">{t("bg_category")}<input id="i-cat" name="category" list="i-cats" defaultValue={editing?.category} /></label>
                <datalist id="i-cats"><option value="Goods" /><option value="Service" /><option value="Works" /></datalist>
                <label className="f">{t("gr_unit")}<input id="i-unit" name="unit" defaultValue={editing?.unit} /></label>
                <label className="f">{t("qty")}<input id="i-qty" name="quantity" className="num" inputMode="decimal" defaultValue={editing?.quantity || ""} /></label>
                <label className="f">{t("st_unit_cost")}<input id="i-cost" name="unitCost" className="num" inputMode="decimal" defaultValue={editing?.unitCost || ""} /></label>
                <label className="f">{t("budget")} ({ctx.company.currency})<input id="i-budget" name="budget" className="num" inputMode="decimal" defaultValue={editing?.budget || ""} /></label>
                <label className="f">{t("bs_own")}<input id="i-own" name="ownContribution" className="num" inputMode="decimal" defaultValue={editing?.ownContribution || ""} /></label>
                {ctx.has("accounting") ? (
                  <label className="f">{t("prj_account")}
                    <select id="i-account" name="accountId" defaultValue={editing?.accountId ?? ""}>
                      <option value="">{t("none")}</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
                    </select></label>
                ) : null}
              </div>
              <div className="small muted">{t("bg_budget_help")}</div>
              <details>
                <summary className="small">{t("bg_plan")}</summary>
                <div className="fields" style={{ marginTop: 8 }}>
                  {quarters.map((p) => <label key={p.key} className="f small">{p.label}<input id={`i-plan-${p.key}`} name={`plan_${p.key}`} className="num" inputMode="decimal" defaultValue={editing?.plan[p.key]?.qty ?? ""} /></label>)}
                </div>
              </details>
              <details>
                <summary className="small">{t("bg_baseline")}</summary>
                <div className="fields" style={{ marginTop: 8 }}>
                  <label className="f small">{t("bg_baseline_qty")}<input id="i-bq" name="baselineQty" className="num" inputMode="decimal" defaultValue={editing?.baselineQty || ""} /></label>
                  <label className="f small">{t("bg_baseline_spent")}<input id="i-bs" name="baselineSpent" className="num" inputMode="decimal" defaultValue={editing?.baselineSpent || ""} /></label>
                </div>
              </details>
            </>
          ) : canBudget ? <div className="small muted">{t("prj_budget_from_children")}</div> : null}
          {canBudget && parent?.level === "activity" ? <div className="note info small">{t("prj_split_note")}</div> : null}
          <div className="row">
            <button type="submit" className="btn primary">{t("save")}</button>
            <Link className="btn ghost" href={base}>{t("cancel")}</Link>
          </div>
        </form>
      ) : null}
    </div>
  );
}
