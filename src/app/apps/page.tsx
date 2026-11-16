import Link from "next/link";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { APPS, appHome, appWorkspaces } from "@/lib/apps";
import { getI18n } from "@/lib/i18n";
import { signOut } from "@/app/session-actions";
import { LanguagePicker } from "@/components/LanguagePicker";
import { AppIcon } from "@/components/AppIcon";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Apps" };

/** What everyone sees after signing in: the apps of TAGPILOT they can open. */
export default async function AppsPage() {
  const ctx = await getCtx();
  if (ctx.role === "supplier") redirect("/portal");
  const { t, lang } = await getI18n();
  const mine = appWorkspaces(ctx, t);
  return (
    <div className="launcher">
      <header className="launcher-top">
        <Logo size={30} />
        <span className="spacer" />
        <span className="small muted">{ctx.user.name} · {ctx.company.name}</span>
        <LanguagePicker lang={lang} />
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
      </main>
    </div>
  );
}
