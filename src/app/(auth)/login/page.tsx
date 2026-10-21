import Link from "next/link";
import { signIn } from "@/app/session-actions";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote } from "@/components/ui";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="auth">
      <form action={signIn} className="panel stack">
        <div className="brand" style={{ color: "var(--fg)", padding: 0 }}><span className="mark">TP</span>{t("app_name")}</div>
        <p className="muted small" style={{ margin: 0 }}>{t("tagline")}</p>
        <h1>{t("login_title")}</h1>
        <ErrorNote message={err(q("error"))} />
        <label className="f">{t("email")}<input id="email" name="email" type="email" autoComplete="email" required /></label>
        <label className="f">{t("password")}<input id="password" name="password" type="password" autoComplete="current-password" required /></label>
        <button type="submit" className="btn primary">{t("login_btn")}</button>
        <div className="small muted">{t("no_account")} <Link href="/signup">{t("signup_btn")}</Link></div>
      </form>
    </div>
  );
}
