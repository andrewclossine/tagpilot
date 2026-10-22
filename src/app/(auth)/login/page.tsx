import Link from "next/link";
import { signIn } from "@/app/session-actions";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote } from "@/components/ui";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="auth">
      <form action={signIn} className="panel stack">
        <Logo size={34} />
        <p className="muted small" style={{ margin: 0 }}>{t("tagline")}</p>
        <h1>{t("login_title")}</h1>
        <ErrorNote message={err(q("error"))} />
        {q("reset") ? <div className="note ok small">{t("reset_done")}</div> : null}
        <label className="f">{t("login_name")}<input id="login" name="login" autoComplete="username" autoCapitalize="none" required /></label>
        <label className="f">{t("password")}<input id="password" name="password" type="password" autoComplete="current-password" required /></label>
        <button type="submit" className="btn primary">{t("login_btn")}</button>
        <div className="small"><Link href="/forgot">{t("forgot_title")}</Link></div>
        <div className="small muted">{t("login_staff_help")}</div>
        <div className="small muted">{t("no_account")} <Link href="/signup">{t("start_trial")}</Link></div>
      </form>
    </div>
  );
}
