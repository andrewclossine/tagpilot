import Link from "next/link";
import { redirect } from "next/navigation";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote, PageHead } from "@/components/ui";
import { importProject } from "../actions";

export const metadata = { title: "Import a project document" };

export default async function ImportProjectPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("projects");
  if (!ctx.can("projects", "write")) redirect("/no-access");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="stack">
      <PageHead title={t("im_title")}><Link className="btn ghost" href="/projects">{t("back")}</Link></PageHead>
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("im_help")}</p>
      <ErrorNote message={err(q("error"))} />
      <form action={importProject} className="panel stack">
        <div className="fields">
          <label className="f">{t("code")}<input id="im-code" name="code" required /></label>
          <label className="f">{t("name")}<input id="im-name" name="name" placeholder={t("im_name_help")} /></label>
          <label className="f">{t("donor")}<input id="im-donor" name="donor" /></label>
        </div>
        <label className="f">{t("im_file")}<input id="im-file" name="file" type="file" accept=".xlsx" required /></label>
        <div><button type="submit" className="btn primary">{t("im_button")}</button></div>
      </form>
    </div>
  );
}
