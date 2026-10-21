import { getCtx, listMyCompanies } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { changeCompany, setLang, signOut } from "@/app/session-actions";
import { AutoSubmitSelect, NavLinks, type NavItem } from "@/components/NavLinks";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const { t, lang } = await getI18n();
  const companies = await listMyCompanies(ctx.user.id);
  const items: NavItem[] = [
    { href: "/dashboard", label: t("nav_dashboard") },
    { href: "/scan", label: t("nav_ai") },
    { group: t("nav_sales") },
    { href: "/sales/invoices", label: t("nav_invoices") },
    { href: "/partners", label: t("nav_partners") },
    { group: t("nav_purchases") },
    { href: "/purchases/bills", label: t("nav_bills") },
    { group: t("nav_journal") },
    { href: "/journal", label: t("nav_journal") },
    { href: "/banking", label: t("nav_banking") },
    { href: "/payroll", label: t("nav_payroll") },
    { href: "/budgets", label: t("nav_budgets") },
    { group: t("nav_reports") },
    { href: "/reports", label: t("nav_reports") },
    { href: "/settings", label: t("nav_settings") },
    { href: "/audit", label: t("nav_audit") },
  ];
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="mark">KA</span>{t("app_name")}</div>
        <form action={changeCompany}>
          <label className="small" htmlFor="companyId" style={{ display: "block", padding: "0 6px 4px", opacity: .7 }}>{t("switch_company")}</label>
          <AutoSubmitSelect id="companyId" name="companyId" defaultValue={ctx.company.id}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </AutoSubmitSelect>
        </form>
        <NavLinks items={items} />
        <div className="foot">
          <div>{ctx.user.name} · {t(`role_${ctx.role}`)}</div>
          <form action={setLang} className="row" style={{ gap: 6 }}>
            <input type="hidden" name="back" value="/dashboard" />
            <button type="submit" name="lang" value="en" className="btn sm" aria-pressed={lang === "en"}>EN</button>
            <button type="submit" name="lang" value="fr" className="btn sm" aria-pressed={lang === "fr"}>FR</button>
          </form>
          <a href="/onboarding" className="link" style={{ color: "var(--side-fg)" }}>+ {t("add_company")}</a>
          <form action={signOut}><button type="submit" className="btn sm">{t("sign_out")}</button></form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
