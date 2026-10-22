import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ROLES } from "@/lib/roles";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead } from "@/components/ui";
import { changeRole, createUser, removeUser, resetPassword } from "./actions";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("users");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const members = await db.select({ m: schema.memberships, u: schema.users }).from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.companyId, ctx.company.id)).orderBy(schema.users.name);
  const roleOptions = ROLES.map((r) => <option key={r} value={r}>{t(`role_${r}`)}</option>);
  return (
    <div className="stack">
      <PageHead title={t("nav_users")} />
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      <div className="panel stack">
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("name")}</th><th>{t("username")}</th><th>{t("role")}</th><th>{t("password")}</th><th /></tr></thead>
          <tbody>
            {members.map(({ m, u }) => {
              const self = u.id === ctx.user.id;
              return (
                <tr key={u.id}>
                  <td><b>{u.name}</b>{u.email ? <div className="small muted">{u.email}</div> : null}</td>
                  <td><code className="k">{u.username}</code></td>
                  <td>
                    {self ? t(`role_${m.role}`) : (
                      <form action={changeRole} className="row" style={{ gap: 6 }}>
                        <input type="hidden" name="userId" value={u.id} />
                        <select name="role" id={`role-${u.id}`} defaultValue={m.role} style={{ width: "auto" }} aria-label={t("role")}>{roleOptions}</select>
                        <button type="submit" className="btn sm">{t("save")}</button>
                      </form>
                    )}
                  </td>
                  <td>
                    {self || u.createdBy === ctx.user.id ? (
                      <form action={resetPassword} className="row" style={{ gap: 6 }}>
                        <input type="hidden" name="userId" value={u.id} />
                        <input name="password" id={`pw-${u.id}`} type="password" minLength={8} placeholder={t("new_password")} autoComplete="new-password" style={{ width: 160 }} required />
                        <button type="submit" className="btn sm">{t("reset")}</button>
                      </form>
                    ) : null}
                  </td>
                  <td>{self ? null : (
                    <form action={removeUser}><input type="hidden" name="userId" value={u.id} />
                      <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")}>{t("remove")}</ConfirmButton></form>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
      <div className="grid2">
        <form action={createUser} className="panel stack">
          <h2>{t("add_user")}</h2>
          <div className="small muted">{t("add_user_help")}</div>
          <label className="f">{t("full_name")}<input id="u-name" name="name" required /></label>
          <label className="f">{t("username")}<input id="u-username" name="username" autoCapitalize="none" pattern="[a-zA-Z0-9._\-]{3,40}" required /></label>
          <label className="f">{t("password")}<input id="u-password" name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
          <label className="f">{t("email_optional")}<input id="u-email" name="email" type="email" autoComplete="off" /></label>
          <label className="f">{t("role")}<select id="u-role" name="role" defaultValue="accountant">{roleOptions}</select></label>
          <div><button type="submit" className="btn primary">{t("add_user")}</button></div>
        </form>
        <div className="panel stack">
          <h2>{t("roles_title")}</h2>
          <table><tbody>
            {ROLES.map((r) => <tr key={r}><td><b>{t(`role_${r}`)}</b></td><td className="small">{t(`role_${r}_help`)}</td></tr>)}
          </tbody></table>
        </div>
      </div>
    </div>
  );
}
