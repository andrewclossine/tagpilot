import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { createSupplierAccount, removeSupplierAccount, resetSupplierPassword } from "../actions";

export const metadata = { title: "Supplier accounts" };

export default async function SupplierAccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("procurement");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [accounts, suppliers] = await Promise.all([
    db.select({ u: schema.users, partner: schema.partners }).from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .innerJoin(schema.partners, eq(schema.partners.id, schema.memberships.partnerId))
      .where(and(eq(schema.memberships.companyId, ctx.company.id), eq(schema.memberships.role, "supplier"))).orderBy(schema.partners.name),
    db.select().from(schema.partners).where(and(eq(schema.partners.companyId, ctx.company.id), inArray(schema.partners.kind, ["supplier", "both"]))).orderBy(schema.partners.name),
  ]);
  const write = ctx.can("procurement", "write");
  return (
    <div className="stack">
      <PageHead title={t("nav_supplier_accounts")} />
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("sa_sub")}</p>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      <div className="panel">
        {accounts.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("supplier")}</th><th>{t("sa_contact")}</th><th>{t("username")}</th>{write ? <><th>{t("password")}</th><th /></> : null}</tr></thead>
            <tbody>{accounts.map(({ u, partner }) => (
              <tr key={u.id}>
                <td><b>{partner.name}</b></td>
                <td>{u.name}{u.email ? <div className="small muted">{u.email}</div> : null}</td>
                <td><code className="k">{u.username}</code></td>
                {write ? <>
                  <td>
                    <form action={resetSupplierPassword} className="row" style={{ gap: 6 }}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input name="password" id={`spw-${u.id}`} type="password" minLength={8} placeholder={t("new_password")} autoComplete="new-password" style={{ width: 160 }} required />
                      <button type="submit" className="btn sm">{t("reset")}</button>
                    </form>
                  </td>
                  <td>
                    <form action={removeSupplierAccount}><input type="hidden" name="userId" value={u.id} />
                      <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")}>{t("remove")}</ConfirmButton></form>
                  </td>
                </> : null}
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
      {write ? (
        <form action={createSupplierAccount} className="panel stack">
          <h2>{t("sa_add")}</h2>
          <div className="fields">
            <label className="f">{t("supplier")}
              <select id="s-partner" name="partnerId" defaultValue="">
                <option value="">{t("sa_new_supplier")}</option>
                {suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            <label className="f">{t("sa_company_name")}<input id="s-company" name="companyName" /></label>
            <label className="f">{t("tin")}<input id="s-tin" name="tin" /></label>
            <label className="f">{t("phone")}<input id="s-phone" name="phone" /></label>
          </div>
          <div className="fields">
            <label className="f">{t("sa_contact")}<input id="s-name" name="name" required /></label>
            <label className="f">{t("username")}<input id="s-username" name="username" autoCapitalize="none" pattern="[a-zA-Z0-9._\-]{3,40}" required /></label>
            <label className="f">{t("password")}<input id="s-password" name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
            <label className="f">{t("email_optional")}<input id="s-email" name="email" type="email" autoComplete="off" /></label>
          </div>
          <div><button type="submit" className="btn primary">{t("sa_add")}</button></div>
        </form>
      ) : null}
    </div>
  );
}
