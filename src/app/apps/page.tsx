import Link from "next/link";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { APPS, appHome, appWorkspaces } from "@/lib/apps";
import { getI18n } from "@/lib/i18n";
import { setLang, signOut } from "@/app/session-actions";
import { AppIcon } from "@/components/AppIcon";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Apps" };

/** What everyone sees after signing in: the apps of TAGPILOT they can open. */
export default async function AppsPage() {
  const ctx = await getCtx();
  if (ctx.role === "supplier") redirect("/portal");
  const { t, lang } = await getI18n();
  const mine = appWorkspaces(ctx, t);
  const admin = ctx.isAdmin ? [
    ...(ctx.can("company") ? [{ href: "/settings", label: t("nav_settings") }] : []),
    ...(ctx.can("users") ? [{ href: "/users", label: t("nav_users") }] : []),
    { href: "/billing", label: t("billing_title") },
    ...(ctx.can("audit") ? [{ href: "/audit", label: t("nav_audit") }] : []),
  ] : [];
  return (
    <div className="launcher">
      <header className="launcher-top">
        <Logo size={30} />
        <span className="spacer" />
        <span className="small muted">{ctx.user.name} · {ctx.company.name}</span>
        <form action={setLang} className="row" style={{ gap: 6 }}>
          <input type="hidden" name="back" value="/apps" />
          <button type="submit" name="lang" value="en" className="btn sm" aria-pressed={lang === "en"}>EN</button>
          <button type="submit" name="lang" value="fr" className="btn sm" aria-pressed={lang === "fr"}>FR</button>
        </form>
        <form action={signOut}><button type="submit" className="btn sm">{t("sign_out")}</button></form>
      </header>
      <main className="launcher-main">
        {ctx.locked ? <div className="note bad">{t("trial_over")}</div> : null}
        <h1>{t("apps_title")}</h1>
        <div className="app-grid">
          {APPS.map((key) => {
            const app = mine.find((w) => w.key === key);
            if (app) {
              return (
                <Link key={key} href={appHome(app)} className="app-tile">
                  <AppIcon app={key} size={72} />
                  <b>{app.label}</b>
                  <span className="small muted">{t(`app_${key}_help`)}</span>
                </Link>
              );
            }
            // Not subscribed: the admin can add it. Anyone else only sees what they may use.
            if (!ctx.isAdmin) return null;
            return (
              <Link key={key} href="/billing" className="app-tile off">
                <AppIcon app={key} size={72} />
                <b>{t(`module_${key}`)}</b>
                <span className="small muted">{t("apps_add")}</span>
              </Link>
            );
          })}
        </div>
        {!mine.length ? <div className="note info">{t("apps_none")}</div> : null}
        {admin.length ? (
          <nav className="launcher-admin" aria-label={t("nav_admin")}>
            {admin.map((a) => <Link key={a.href} href={a.href} className="btn sm">{a.label}</Link>)}
          </nav>
        ) : null}
      </main>
    </div>
  );
}
