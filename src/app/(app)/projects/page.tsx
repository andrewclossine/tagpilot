import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { logframe, projectTotals } from "@/lib/programs";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { addProject } from "./actions";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("projects");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const projects = await db.select().from(schema.projects).where(eq(schema.projects.companyId, ctx.company.id)).orderBy(schema.projects.code);
  const rows = await Promise.all(projects.map(async (p) => {
    const tree = await logframe(db, ctx.company.id, p.id);
    const tops = tree.filter((r) => r.depth === 0);
    return { p, budget: tops.reduce((s, r) => s + r.totalBudget, 0), executed: tops.reduce((s, r) => s + r.executed, 0), count: tree.length, execution: projectTotals(tree).activityExecution };
  }));
  return (
    <div className="stack">
      <PageHead title={t("prj_title")}>{ctx.can("projects", "write") ? <Link className="btn" href="/projects/import">{t("tm_title")}</Link> : null}</PageHead>
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("prj_sub")}</p>
      <ErrorNote message={err(q("error"))} />
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("code")}</th><th>{t("name")}</th><th>{t("type")}</th><th>{t("donor")}</th><th className="num">{t("budget")}</th><th className="num">{t("prj_executed")}</th><th className="num">{t("balance_left")}</th><th>{t("st_budget_exec")}</th><th className="num">{t("rp_project_execution")}</th></tr></thead>
            <tbody>{rows.map(({ p, budget, executed, execution }) => {
              const used = budget ? Math.round((executed / budget) * 100) : 0;
              return (
                <tr key={p.id}>
                  <td><Link className="rowlink" href={`/projects/${p.id}`}><code className="k">{p.code}</code></Link></td>
                  <td><Link className="rowlink" href={`/projects/${p.id}`}>{p.name}</Link></td>
                  <td>{t(p.kind === "cost_center" ? "prj_cost_center" : "prj_project")}</td>
                  <td>{p.donor}</td>
                  <td className="num">{money(budget)}</td>
                  <td className="num">{money(executed)}</td>
                  <td className="num">{money(budget - executed)}</td>
                  <td>{budget ? <><span className={`meter${used > 100 ? " over" : ""}`}><i style={{ width: `${Math.min(used, 100)}%` }} /></span> <span className="small num">{used}%</span></> : null}</td>
                  <td className="num">{budget ? `${Math.round(execution * 1000) / 10}%` : ""}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
      {ctx.can("projects", "write") ? (
        <form action={addProject} className="panel stack">
          <h2>{t("prj_add")}</h2>
          <div className="fields">
            <label className="f">{t("type")}<select id="p-kind" name="kind" defaultValue="project"><option value="project">{t("prj_project")}</option><option value="cost_center">{t("prj_cost_center")}</option></select></label>
            <label className="f">{t("code")}<input id="p-code" name="code" required /></label>
            <label className="f">{t("name")}<input id="p-name" name="name" required /></label>
            <label className="f">{t("donor")}<input id="p-donor" name="donor" /></label>
            <label className="f">{t("wp_start")}<input id="p-start" name="startDate" type="date" /></label>
            <label className="f">{t("wp_end")}<input id="p-end" name="endDate" type="date" /></label>
          </div>
          <div><button type="submit" className="btn primary">{t("add")}</button></div>
        </form>
      ) : null}
    </div>
  );
}
