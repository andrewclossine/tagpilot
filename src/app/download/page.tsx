import Link from "next/link";
import { getI18n } from "@/lib/i18n";
import { Logo } from "@/components/Logo";
import { InstallApp } from "@/components/InstallApp";

export const metadata = { title: "Get the app" };

/** The Windows installer is served beside the site by the web server, not by the app. */
const WINDOWS_SETUP = "/downloads/TAGPILOT-Setup.exe";

/** How to get TAGPILOT as an app on a computer or phone. It still works online, with the same account. */
export default async function DownloadPage() {
  const { t } = await getI18n();
  return (
    <div className="auth">
      <div className="panel stack" style={{ maxWidth: 560 }}>
        <Logo size={34} />
        <h1>{t("app_title")}</h1>
        <p className="muted" style={{ margin: 0 }}>{t("app_intro")}</p>

        <section className="stack" style={{ gap: 8 }}>
          <h2>{t("app_windows")}</h2>
          <div><a className="btn primary" href={WINDOWS_SETUP} download>{t("app_windows_btn")}</a></div>
          <div className="small muted">{t("app_windows_help")}</div>
        </section>

        <section className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h2>{t("app_browser")}</h2>
          <div className="small muted">{t("app_browser_help")}</div>
          <div><InstallApp label={t("app_install")} className="btn" /></div>
          <ul className="small" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
            <li>{t("app_how_chrome")}</li>
            <li>{t("app_how_android")}</li>
            <li>{t("app_how_iphone")}</li>
            <li>{t("app_how_mac")}</li>
          </ul>
        </section>

        <div className="small"><Link href="/login">{t("app_back")}</Link></div>
      </div>
    </div>
  );
}
