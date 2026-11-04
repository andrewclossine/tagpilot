import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import { childLevel, isBudgetLine, logframe, type LogRow } from "@/lib/programs";
import type { LogframeLevel } from "@/db/schema";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead, Tabs } from "@/components/ui";
import { removeLogItem, saveLogItem } from "../actions";

export const metadata = { title: "Results framework" };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("projects");
  const { t, err, money, accName } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const view = q("view") === "logframe" ? "logframe" : "budget";
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

  const tops = rows.filter((r) => r.depth === 0);
  const total = tops.reduce((s, r) => s + r.totalBudget, 0), executed = tops.reduce((s, r) => s + r.executed, 0), paid = tops.reduce((s, r) => s + r.paid, 0);
  const title = (r: LogRow) => (
    <div style={{ paddingLeft: r.depth * 16 }}>
      <div className="small muted">{lv(r.level)} <code className="k">{r.code}</code></div>
      {r.title}
    </div>
  );
  const actions = (r: LogRow) => write ? (
    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
      <Link className="btn ghost sm" href={`${base}&edit=${r.id}#item-form`}>{t("edit")}</Link>
      {childLevel(r.level) ? <Link className="btn ghost sm" href={`${base}&add=${r.id}#item-form`}>+ {lv(childLevel(r.level)!)}</Link> : null}
      {!r.hasChildren ? (
        <form action={removeLogItem}>
          <input type="hidden" name="id" value={r.id} /><input type="hidden" name="projectId" value={id} /><input type="hidden" name="view" value={view} />
          <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton>
        </form>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="stack">
      <PageHead title={`${project.code} · ${project.name}`}>
        <Link className="btn" href="/projects">{t("back")}</Link>
        {ctx.can("vouchers", "write") ? <Link className="btn primary" href={`/vouchers/new?project=${id}`}>{t("pv_new")}</Link> : null}
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("budget")}</div><div className="v">{money(total)}</div></div>
        <div className="panel kpi"><div className="label">{t("prj_executed")}</div><div className="v">{money(executed)}</div></div>
        <div className="panel kpi"><div className="label">{t("prj_paid")}</div><div className="v">{money(paid)}</div></div>
        <div className="panel kpi"><div className="label">{t("balance_left")}</div><div className="v">{money(total - executed)}</div></div>
      </div>
      <div className="row">
        <Tabs current={view} items={[
          { key: "budget", href: `/projects/${id}?view=budget`, label: t("prj_budget_tab") },
          { key: "logframe", href: `/projects/${id}?view=logframe`, label: t("prj_logframe_tab") },
        ]} />
        <span className="spacer" />
        {write ? <Link className="btn sm" href={`${base}&add=root#item-form`}>+ {lv("goal")}</Link> : null}
      </div>
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            {view === "budget" ? (
              <>
                <thead><tr><th>{t("prj_result")}</th><th className="num">{t("budget")}</th><th className="num">{t("prj_executed")}</th><th className="num">{t("balance_left")}</th><th>{t("used")}</th><th /></tr></thead>
                <tbody>{rows.map((r) => {
                  const used = r.totalBudget ? Math.round((r.executed / r.totalBudget) * 100) : 0;
                  return (
                    <tr key={r.id} className={`lf-${r.level}`}>
                      <td>{title(r)}</td>
                      <td className="num">{money(r.totalBudget)}</td>
                      <td className="num">{r.isLine ? <Link href={`/vouchers?line=${r.id}`}>{money(r.executed)}</Link> : money(r.executed)}</td>
                      <td className="num">{money(r.totalBudget - r.executed)}</td>
                      <td>{r.totalBudget ? <><span className={`meter${used > 100 ? " over" : ""}`}><i style={{ width: `${Math.min(used, 100)}%` }} /></span> <span className="small num">{used}%</span></> : null}</td>
                      <td>{actions(r)}</td>
                    </tr>
                  );
                })}</tbody>
              </>
            ) : (
              <>
                <thead><tr><th>{t("prj_result")}</th><th>{t("prj_indicator")}</th><th>{t("prj_target")}</th><th>{t("prj_verification")}</th><th>{t("prj_assumptions")}</th><th /></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id} className={`lf-${r.level}`}>
                    <td>{title(r)}</td><td>{r.indicator}</td><td>{r.target}</td><td>{r.verification}</td><td>{r.assumptions}</td><td>{actions(r)}</td>
                  </tr>
                ))}</tbody>
              </>
            )}
          </table></div>
        ) : <Empty>{t("prj_empty")}</Empty>}
      </div>
      {write && formLevel ? (
        <form action={saveLogItem} className="panel stack" id="item-form" key={editing?.id ?? q("add")}>
          <h2>{editing ? `${t("edit")}: ${lv(formLevel)} ${editing.code}` : `${t("add")}: ${lv(formLevel)}`}{parent ? <span className="muted small"> · {parent.code} {parent.title}</span> : null}</h2>
          <input type="hidden" name="projectId" value={id} /><input type="hidden" name="view" value={view} />
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          {parent ? <input type="hidden" name="parentId" value={parent.id} /> : null}
          <label className="f">{t("prj_statement")}<textarea id="i-title" name="title" rows={2} required defaultValue={editing?.title} /></label>
          <div className="fields">
            <label className="f">{t("prj_indicator")}<input id="i-indicator" name="indicator" defaultValue={editing?.indicator} /></label>
            <label className="f">{t("prj_target")}<input id="i-target" name="target" defaultValue={editing?.target} /></label>
            <label className="f">{t("prj_verification")}<input id="i-verification" name="verification" defaultValue={editing?.verification} /></label>
            <label className="f">{t("prj_assumptions")}<input id="i-assumptions" name="assumptions" defaultValue={editing?.assumptions} /></label>
          </div>
          {budgetEditable ? (
            <div className="fields">
              <label className="f">{t("budget")} ({ctx.company.currency})<input id="i-budget" name="budget" className="num" inputMode="decimal" defaultValue={editing?.budget || ""} /></label>
              {ctx.has("accounting") ? (
                <label className="f">{t("prj_account")}
                  <select id="i-account" name="accountId" defaultValue={editing?.accountId ?? ""}>
                    <option value="">{t("none")}</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
                  </select></label>
              ) : null}
            </div>
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
