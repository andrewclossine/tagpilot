import { redirect } from "next/navigation";
import Link from "next/link";
import { appWorkspaces } from "@/lib/apps";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import type { Area } from "@/lib/roles";
import { setLang, signOut } from "@/app/session-actions";
import { AppShell } from "@/components/AppShell";
import type { NavItem } from "@/components/NavLinks";
import { Logo } from "@/components/Logo";
import { QuickBar, type NewGroup } from "@/components/QuickBar";
import { LegalFooter } from "@/components/LegalFooter";
import { InstallApp } from "@/components/InstallApp";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  if (ctx.role === "supplier") redirect("/portal");
  const { t, lang } = await getI18n();
  const link = (area: Area, href: string, label: string): NavItem[] => (ctx.can(area) ? [{ href, label }] : []);
  const group = (label: string, items: NavItem[]): NavItem[] => (items.length ? [{ group: label }, ...items] : []);
  const workspaces = appWorkspaces(ctx, t);
  const common: NavItem[] = group(t("nav_admin"), [
    ...link("company", "/settings", t("nav_settings")),
    ...link("users", "/users", t("nav_users")),
    ...(ctx.isAdmin ? [{ href: "/billing", label: t("billing_title") }] : []),
    // With the accountant reports when the company has them; otherwise it stays here.
    ...(ctx.can("reports") ? [] : link("audit", "/reports/audit", t("nav_audit"))),
  ]);
  const brand = (
    <div className="brand-block">
      <Link href="/apps" style={{ textDecoration: "none" }}><Logo size={30} onDark /></Link>
      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
        {ctx.company.logoAttachmentId ? <img src={`/api/files/${ctx.company.logoAttachmentId}`} alt="" style={{ height: 32, maxWidth: 64, objectFit: "contain", background: "#fff", borderRadius: 4, padding: 2 }} /> : null}
        <span style={{ fontWeight: 600, color: "#fff", minWidth: 0, overflowWrap: "anywhere" }}>{ctx.company.name}</span>
      </div>
    </div>
  );
  const account = (
    <div className="foot">
      <div>{ctx.user.name}<div className="small" style={{ opacity: .7 }}>@{ctx.user.username} · {t(`role_${ctx.role}`)}</div></div>
      <form action={setLang} className="row" style={{ gap: 6 }}>
        <input type="hidden" name="back" value="/apps" />
        <button type="submit" name="lang" value="en" className="btn sm" aria-pressed={lang === "en"}>EN</button>
        <button type="submit" name="lang" value="fr" className="btn sm" aria-pressed={lang === "fr"}>FR</button>
      </form>
      <InstallApp label={t("app_install")} />
      <form action={signOut}><button type="submit" className="btn sm">{t("sign_out")}</button></form>
    </div>
  );
  // "+ New": what this person may create in Accounting, grouped like the menus.
  const w = (area: Area, href: string, label: string) => (ctx.can(area, "write") ? [{ href, label }] : []);
  const newGroups: NewGroup[] = ctx.has("accounting") ? [
    { label: t("nav_sales"), links: [...w("sales", "/sales/invoices/new", t("inv_new")), ...w("sales", "/sales/receipts/new", t("sr_new")), ...w("sales", "/sales/payments", t("nav_receive_payments")), ...w("sales", "/sales/proformas/new", t("nav_proforma")), ...w("partners", "/sales/customers#form", t("nav_customers"))] },
    { label: t("nav_purchases"), links: [...w("purchases", "/purchases/bills/new", t("bill_new")), ...w("purchases", "/purchases/expenses", t("exp_new")), ...w("purchases", "/purchases/pay", t("nav_pay_bill")), ...w("partners", "/purchases/suppliers#form", t("nav_suppliers"))] },
    { label: t("nav_banking"), links: [...w("banking", "/banking/check", t("nav_write_check")), ...w("banking", "/banking/deposit", t("nav_make_deposit")), ...w("banking", "/banking/transfer", t("nav_transfer_funds"))] },
    { label: t("nav_accountant"), links: [...w("journal", "/journal/new", t("qb_journal_entry")), ...w("assets", "/assets/new", t("qb_asset")), ...w("inventory", "/inventory/new", t("qb_item"))] },
  ] : [];
  const quick = ctx.has("accounting") ? <QuickBar groups={newGroups} labels={{ new: t("qb_new"), search: t("qb_search"), placeholder: t("qb_placeholder") }} /> : null;
  return (
    <AppShell workspaces={workspaces} common={common} allAppsLabel={t("nav_all_apps")} brand={brand} account={account} quick={quick} footer={<LegalFooter />}>
      {ctx.locked ? <div className="note bad row" style={{ marginBottom: 16 }}><span style={{ flex: 1 }}>{t("trial_over")}</span>{ctx.isAdmin ? <a className="btn primary sm" href="/billing">{t("billing_pay")}</a> : null}</div>
        : ctx.trialDaysLeft !== null && ctx.isAdmin ? <div className="note info small row" style={{ marginBottom: 16 }}><span style={{ flex: 1 }}>{t("trial_left").replace("{n}", String(ctx.trialDaysLeft))}</span><a className="btn sm" href="/billing">{t("billing_pay")}</a></div> : null}
      {children}
    </AppShell>
  );
}
