import Link from "next/link";
import { signUp } from "@/app/session-actions";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote } from "@/components/ui";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="auth">
      <form action={signUp} className="panel stack">
        <div className="brand" style={{ color: "var(--fg)", padding: 0 }}><span className="mark">KA</span>{t("app_name")}</div>
        <h1>{t("signup_title")}</h1>
        <ErrorNote message={err(q("error"))} />
        <label className="f">{t("full_name")}<input id="name" name="name" autoComplete="name" required /></label>
        <label className="f">{t("email")}<input id="email" name="email" type="email" autoComplete="email" required /></label>
        <label className="f">{t("password")}<input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
        <button type="submit" className="btn primary">{t("signup_btn")}</button>
        <div className="small muted">{t("have_account")} <Link href="/login">{t("login_btn")}</Link></div>
      </form>
    </div>
  );
}
