import { redirect } from "next/navigation";
import Link from "next/link";
import { appWorkspaces } from "@/lib/apps";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import type { Area } from "@/lib/roles";
import { setLang, signOut } from "@/app/session-actions";
import { WorkspaceNav, type NavItem } from "@/components/NavLinks";
import { Logo } from "@/components/Logo";

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
    ...link("audit", "/audit", t("nav_audit")),
  ]);
  return (
    <div className="shell">
      <aside className="side">
        <Link href="/apps" style={{ padding: "0 6px", textDecoration: "none" }}><Logo size={30} onDark /></Link>
        <div className="row" style={{ padding: "0 8px", gap: 8, flexWrap: "nowrap" }}>
          {ctx.company.logoAttachmentId ? <img src={`/api/files/${ctx.company.logoAttachmentId}`} alt="" style={{ height: 32, maxWidth: 64, objectFit: "contain", background: "#fff", borderRadius: 4, padding: 2 }} /> : null}
          <span style={{ fontWeight: 600, color: "#fff", minWidth: 0, overflowWrap: "anywhere" }}>{ctx.company.name}</span>
        </div>
        <WorkspaceNav workspaces={workspaces} common={common} allAppsLabel={t("nav_all_apps")} />
        <div className="foot">
          <div>{ctx.user.name}<div className="small" style={{ opacity: .7 }}>@{ctx.user.username} · {t(`role_${ctx.role}`)}</div></div>
          <form action={setLang} className="row" style={{ gap: 6 }}>
            <input type="hidden" name="back" value="/apps" />
            <button type="submit" name="lang" value="en" className="btn sm" aria-pressed={lang === "en"}>EN</button>
            <button type="submit" name="lang" value="fr" className="btn sm" aria-pressed={lang === "fr"}>FR</button>
          </form>
          <form action={signOut}><button type="submit" className="btn sm">{t("sign_out")}</button></form>
        </div>
      </aside>
      <main className="main">
        {ctx.locked ? <div className="note bad row" style={{ marginBottom: 16 }}><span style={{ flex: 1 }}>{t("trial_over")}</span>{ctx.isAdmin ? <a className="btn primary sm" href="/billing">{t("billing_pay")}</a> : null}</div>
          : ctx.trialDaysLeft !== null && ctx.isAdmin ? <div className="note info small row" style={{ marginBottom: 16 }}><span style={{ flex: 1 }}>{t("trial_left").replace("{n}", String(ctx.trialDaysLeft))}</span><a className="btn sm" href="/billing">{t("billing_pay")}</a></div> : null}
        {children}
      </main>
    </div>
  );
}
