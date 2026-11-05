import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import { ErrorNote, PageHead } from "@/components/ui";
import { importProject, uploadBudget } from "../actions";

export const metadata = { title: "Budget template" };

const ISSUES = ["level", "title", "chain", "money", "amount", "own", "both"] as const;

export default async function BudgetTemplatePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("projects");
  if (!ctx.can("projects", "write")) redirect("/no-access");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [project] = isUuid(q("project")) ? await db.select().from(schema.projects).where(and(eq(schema.projects.id, q("project")), eq(schema.projects.companyId, ctx.company.id))) : [];
  // Each problem comes as "row:code", so what is shown is always our own wording.
  const issues = q("issues").split(",").map((x) => x.split(":")).filter(([row, code]) => /^\d+$/.test(row ?? "") && (ISSUES as readonly string[]).includes(code ?? ""));
  return (
    <div className="stack">
      <PageHead title={t("tm_title")}><Link className="btn ghost" href={project ? `/projects/${project.id}?view=budget` : "/projects"}>{t("back")}</Link></PageHead>
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("tm_help")}</p>
      <ErrorNote message={err(q("error"))} />
      {issues.length ? (
        <div className="note bad small"><b>{t("tm_issues")}</b>
          <ul>{issues.map(([row, code]) => <li key={`${row}${code}`}>{t(`tm_issue_${code as (typeof ISSUES)[number]}`).replace("{row}", row)}</li>)}</ul>
        </div>
      ) : null}
      <div className="panel stack">
        <h2>1. {t("tm_step_download")}</h2>
        <div><a className="btn" href="/api/export/budget-template">{t("tm_download")}</a></div>
      </div>
      <form action={uploadBudget} className="panel stack">
        <h2>2. {t("tm_step_upload")}{project ? <span className="muted small"> · {project.code} {project.name}</span> : null}</h2>
        {project ? <input type="hidden" name="projectId" value={project.id} /> : (
          <div className="fields">
            <label className="f">{t("code")}<input id="tm-code" name="code" required /></label>
            <label className="f">{t("name")}<input id="tm-name" name="name" required /></label>
            <label className="f">{t("type")}<select id="tm-kind" name="kind" defaultValue="project"><option value="project">{t("prj_project")}</option><option value="cost_center">{t("prj_cost_center")}</option></select></label>
            <label className="f">{t("donor")}<input id="tm-donor" name="donor" /></label>
          </div>
        )}
        <label className="f">{t("tm_file")}<input id="tm-file" name="file" type="file" accept=".xlsx" required /></label>
        <div><button type="submit" className="btn primary">{t("tm_upload")}</button></div>
      </form>
      {project ? null : (
        <details className="panel">
          <summary className="small">{t("im_title")}</summary>
          <form action={importProject} className="stack" style={{ marginTop: 12 }}>
            <input type="hidden" name="legacy" value="1" />
            <p className="small muted" style={{ margin: 0 }}>{t("im_help")}</p>
            <div className="fields">
              <label className="f">{t("code")}<input id="im-code" name="code" required /></label>
              <label className="f">{t("name")}<input id="im-name" name="name" placeholder={t("im_name_help")} /></label>
              <label className="f">{t("donor")}<input id="im-donor" name="donor" /></label>
            </div>
            <label className="f">{t("im_file")}<input id="im-file" name="file" type="file" accept=".xlsx" required /></label>
            <div><button type="submit" className="btn">{t("im_button")}</button></div>
          </form>
        </details>
      )}
    </div>
  );
}
