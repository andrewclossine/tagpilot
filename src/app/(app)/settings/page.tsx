import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead, Tabs } from "@/components/ui";
import { addMember, deleteAccount, deleteProject, removeMember, saveAccount, saveCompanySettings, saveProject } from "./actions";

export const metadata = { title: "Settings" };

const SUBTYPES = ["bank", "cash", "momo", "ar", "ap", "vat_in", "vat_out", "wht"] as const;
const TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getCtx();
  const { t, err, accName } = await getI18n();
  const q = await sp(searchParams);
  const tab = ["company", "accounts", "projects", "users"].includes(q("tab")) ? q("tab") : "company";
  const db = await getDb();
  const c = ctx.company, s = c.settings;
  const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, c.id)).orderBy(schema.accounts.code);
  const accSelect = (name: string, value: string) => (
    <select id={`s-${name}`} name={name} defaultValue={value} disabled={!ctx.isOwner}>
      {accounts.map((a) => <option key={a.id} value={a.code}>{a.code} · {accName(a)}</option>)}
    </select>
  );

  let body: React.ReactNode;
  if (tab === "company") {
    body = (
      <form action={saveCompanySettings} className="panel stack">
        <div className="fields">
          <label className="f">{t("co_name")}<input id="s-name" name="name" defaultValue={c.name} disabled={!ctx.isOwner} /></label>
          <label className="f">{t("co_tin")}<input id="s-tin" name="tin" defaultValue={c.tin} disabled={!ctx.isOwner} /></label>
          <label className="f">{t("address")}<input id="s-address" name="address" defaultValue={c.address} disabled={!ctx.isOwner} /></label>
          <label className="f">{t("co_vat")}<select id="s-vat" name="vatRegistered" defaultValue={c.vatRegistered ? "1" : "0"} disabled={!ctx.isOwner}><option value="1">{t("yes")}</option><option value="0">{t("no")}</option></select></label>
          <label className="f">{t("co_rate")}<input id="s-rate" name="vatRate" className="num" defaultValue={c.vatRate} disabled={!ctx.isOwner} /></label>
        </div>
        <div className="fields">
          <label className="f">{t("acc_ar")}{accSelect("arAccount", s.arAccount)}</label>
          <label className="f">{t("acc_ap")}{accSelect("apAccount", s.apAccount)}</label>
          <label className="f">{t("acc_vat_in")}{accSelect("vatIn", s.vatIn)}</label>
          <label className="f">{t("acc_vat_out")}{accSelect("vatOut", s.vatOut)}</label>
          <label className="f">{t("acc_wht")}{accSelect("whtAccount", s.whtAccount)}</label>
        </div>
        <h2>{t("set_policy")}</h2>
        <div className="small muted">{t("pol_help")}</div>
        <textarea id="s-pol" name="policies" rows={12} defaultValue={c.policies} disabled={!ctx.isOwner} />
        {ctx.isOwner ? <div><button type="submit" className="btn primary">{t("save")}</button></div> : null}
      </form>
    );
  } else if (tab === "accounts") {
    const editing = accounts.find((a) => a.id === q("edit"));
    body = (
      <div className="stack">
        <div className="panel tbl-wrap"><table>
          <thead><tr><th>{t("code")}</th><th>{t("name_en")}</th><th>{t("name_fr")}</th><th>{t("type")}</th><th>{t("subtype")}</th><th /></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={{ opacity: a.isActive ? 1 : 0.5 }}>
                <td><code className="k">{a.code}</code></td><td>{a.nameEn}</td><td>{a.nameFr}</td><td>{t(`t_${a.type}`)}</td><td>{a.subtype ? t(`sub_${a.subtype}`) : ""}</td>
                <td style={{ whiteSpace: "nowrap" }}>{ctx.canWrite ? <>
                  <a className="btn ghost sm" href={`/settings?tab=accounts&edit=${a.id}#acc`}>{t("edit")}</a>
                  <form action={deleteAccount} style={{ display: "inline" }}><input type="hidden" name="id" value={a.id} />
                    <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
                </> : null}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {ctx.canWrite ? (
          <form action={saveAccount} className="panel stack" id="acc" key={editing?.id ?? "new"}>
            <h2>{editing ? `${t("edit")}: ${editing.code}` : t("add")}</h2>
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <div className="fields">
              <label className="f">{t("code")}<input id="a-code" name="code" defaultValue={editing?.code} required /></label>
              <label className="f">{t("name_en")}<input id="a-en" name="nameEn" defaultValue={editing?.nameEn} required /></label>
              <label className="f">{t("name_fr")}<input id="a-fr" name="nameFr" defaultValue={editing?.nameFr} /></label>
              <label className="f">{t("type")}<select id="a-type" name="type" defaultValue={editing?.type ?? "expense"}>{TYPES.map((x) => <option key={x} value={x}>{t(`t_${x}`)}</option>)}</select></label>
              <label className="f">{t("subtype")}<select id="a-sub" name="subtype" defaultValue={editing?.subtype ?? ""}><option value="">{t("sub_none")}</option>{SUBTYPES.map((x) => <option key={x} value={x}>{t(`sub_${x}`)}</option>)}</select></label>
              <label className="f">{t("status")}<select id="a-act" name="isActive" defaultValue={editing?.isActive === false ? "0" : "1"}><option value="1">{t("active")}</option><option value="0">{t("inactive")}</option></select></label>
            </div>
            <div className="row"><button type="submit" className="btn primary">{t("save")}</button>{editing ? <a className="btn ghost" href="/settings?tab=accounts">{t("cancel")}</a> : null}</div>
          </form>
        ) : null}
      </div>
    );
  } else if (tab === "projects") {
    const projects = await db.select().from(schema.projects).where(eq(schema.projects.companyId, c.id)).orderBy(schema.projects.code);
    const editing = projects.find((p) => p.id === q("edit"));
    body = (
      <div className="stack">
        <div className="panel tbl-wrap"><table>
          <thead><tr><th>{t("code")}</th><th>{t("name")}</th><th>{t("donor")}</th><th>{t("status")}</th><th /></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}><td><code className="k">{p.code}</code></td><td>{p.name}</td><td>{p.donor}</td><td>{p.isActive ? t("active") : t("inactive")}</td>
                <td style={{ whiteSpace: "nowrap" }}>{ctx.canWrite ? <>
                  <a className="btn ghost sm" href={`/settings?tab=projects&edit=${p.id}#prj`}>{t("edit")}</a>
                  <form action={deleteProject} style={{ display: "inline" }}><input type="hidden" name="id" value={p.id} />
                    <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
                </> : null}</td></tr>
            ))}
          </tbody>
        </table></div>
        {ctx.canWrite ? (
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
  } else {
    const members = await db.select({ m: schema.memberships, u: schema.users }).from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.companyId, c.id));
    body = (
      <div className="grid2">
        <div className="panel stack">
          <h2>{t("members")}</h2>
          <table><tbody>
            {members.map(({ m, u }) => (
              <tr key={u.id}><td><b>{u.name}</b><div className="small muted">{u.email}</div></td><td>{t(`role_${m.role}`)}</td>
                <td>{ctx.isOwner && u.id !== ctx.user.id ? <form action={removeMember}><input type="hidden" name="userId" value={u.id} />
                  <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")}>{t("remove")}</ConfirmButton></form> : null}</td></tr>
            ))}
          </tbody></table>
        </div>
        {ctx.isOwner ? (
          <form action={addMember} className="panel stack">
            <h2>{t("invite_btn")}</h2>
            <div className="small muted">{t("invite_help")}</div>
            <label className="f">{t("email")}<input id="m-email" name="email" type="email" required /></label>
            <label className="f">{t("role")}<select id="m-role" name="role" defaultValue="accountant">
              <option value="accountant">{t("role_accountant")}</option><option value="viewer">{t("role_viewer")}</option><option value="owner">{t("role_owner")}</option></select></label>
            <div><button type="submit" className="btn primary">{t("invite_btn")}</button></div>
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead title={t("set_title")} />
      <Tabs current={tab} items={[
        { key: "company", href: "/settings?tab=company", label: t("set_company") },
        { key: "accounts", href: "/settings?tab=accounts", label: t("set_accounts") },
        { key: "projects", href: "/settings?tab=projects", label: t("set_projects") },
        { key: "users", href: "/settings?tab=users", label: t("set_users") },
      ]} />
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {body}
    </div>
  );
}
