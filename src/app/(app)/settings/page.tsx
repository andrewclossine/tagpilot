import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead, Tabs } from "@/components/ui";
import { CompanyFields } from "@/components/CompanyFields";
import { deleteProject, removeLogo, saveCompanySettings, saveProject, uploadLogo } from "./actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("company");
  const { t, err, accName } = await getI18n();
  const q = await sp(searchParams);
  const tab = q("tab") === "projects" ? "projects" : "company";
  const db = await getDb();
  const c = ctx.company, s = c.settings;
  const edit = ctx.can("company", "write");

  let body: React.ReactNode;
  if (tab === "company") {
    const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, c.id)).orderBy(schema.accounts.code);
    const accSelect = (name: string, value: string) => (
      <select id={`s-${name}`} name={name} defaultValue={value}>
        {accounts.map((a) => <option key={a.id} value={a.code}>{a.code} · {accName(a)}</option>)}
      </select>
    );
    body = (
      <div className="stack">
      <div className="panel row" style={{ alignItems: "flex-start" }}>
        <div style={{ width: 180, height: 90, border: "1px dashed var(--line)", borderRadius: "var(--r)", display: "grid", placeItems: "center", background: "#fff", flex: "none" }}>
          {c.logoAttachmentId ? <img src={`/api/files/${c.logoAttachmentId}`} alt={c.name} style={{ maxWidth: 170, maxHeight: 80, objectFit: "contain" }} /> : <span className="small muted">{t("logo_none")}</span>}
        </div>
        <div className="stack" style={{ flex: 1, minWidth: 220, gap: 8 }}>
          <h2>{t("logo_title")}</h2>
          <div className="small muted">{t("logo_help")}</div>
          {edit ? (
            <div className="row">
              <form action={uploadLogo} className="row">
                <input id="logo" name="logo" type="file" accept="image/png,image/jpeg" required style={{ width: "auto" }} />
                <button type="submit" className="btn">{t("logo_upload")}</button>
              </form>
              {c.logoAttachmentId ? <form action={removeLogo}><button type="submit" className="btn ghost danger">{t("remove")}</button></form> : null}
            </div>
          ) : null}
        </div>
      </div>
      <form action={saveCompanySettings} className="panel stack">
        <fieldset disabled={!edit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
          <CompanyFields t={t} c={c} />
          <div className="fields">
            <label className="f">{t("acc_ar")}{accSelect("arAccount", s.arAccount)}</label>
            <label className="f">{t("acc_ap")}{accSelect("apAccount", s.apAccount)}</label>
            <label className="f">{t("acc_vat_in")}{accSelect("vatIn", s.vatIn)}</label>
            <label className="f">{t("acc_vat_out")}{accSelect("vatOut", s.vatOut)}</label>
            <label className="f">{t("acc_wht")}{accSelect("whtAccount", s.whtAccount)}</label>
          </div>
          <h2>{t("set_policy")}</h2>
          <div className="small muted">{t("pol_help")}</div>
          <textarea id="s-pol" name="policies" rows={12} defaultValue={c.policies} />
          {edit ? <div><button type="submit" className="btn primary">{t("save")}</button></div> : null}
        </fieldset>
      </form>
      </div>
    );
  } else {
    const projects = await db.select().from(schema.projects).where(eq(schema.projects.companyId, c.id)).orderBy(schema.projects.code);
    const editing = projects.find((p) => p.id === q("edit"));
    const canEdit = ctx.can("accounts", "write");
    body = (
      <div className="stack">
        <div className="panel tbl-wrap"><table>
          <thead><tr><th>{t("code")}</th><th>{t("name")}</th><th>{t("donor")}</th><th>{t("status")}</th><th /></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}><td><code className="k">{p.code}</code></td><td>{p.name}</td><td>{p.donor}</td><td>{p.isActive ? t("active") : t("inactive")}</td>
                <td style={{ whiteSpace: "nowrap" }}>{canEdit ? <>
                  <a className="btn ghost sm" href={`/settings?tab=projects&edit=${p.id}#prj`}>{t("edit")}</a>
                  <form action={deleteProject} style={{ display: "inline" }}><input type="hidden" name="id" value={p.id} />
                    <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
                </> : null}</td></tr>
            ))}
          </tbody>
        </table></div>
        {canEdit ? (
          <form action={saveProject} className="panel stack" id="prj" key={editing?.id ?? "new"}>
            <h2>{editing ? `${t("edit")}: ${editing.code}` : t("add")}</h2>
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <div className="fields">
              <label className="f">{t("code")}<input id="j-code" name="code" defaultValue={editing?.code} required /></label>
              <label className="f">{t("name")}<input id="j-name" name="name" defaultValue={editing?.name} required /></label>
              <label className="f">{t("donor")}<input id="j-donor" name="donor" defaultValue={editing?.donor} /></label>
              <label className="f">{t("status")}<select id="j-act" name="isActive" defaultValue={editing?.isActive === false ? "0" : "1"}><option value="1">{t("active")}</option><option value="0">{t("inactive")}</option></select></label>
            </div>
            <div className="row"><button type="submit" className="btn primary">{t("save")}</button>{editing ? <a className="btn ghost" href="/settings?tab=projects">{t("cancel")}</a> : null}</div>
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead title={t("set_title")} />
      <Tabs current={tab} items={[
        { key: "company", href: "/settings", label: t("set_company") },
        { key: "projects", href: "/settings?tab=projects", label: t("set_projects") },
      ]} />
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {body}
    </div>
  );
}
