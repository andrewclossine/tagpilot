import Link from "next/link";
import { resetPassword } from "@/app/session-actions";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote } from "@/components/ui";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: SearchParams }) {
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="auth">
      <form action={resetPassword} className="panel stack">
        <Logo size={34} />
        <h1>{t("reset_title")}</h1>
        <ErrorNote message={err(q("error"))} />
        <input type="hidden" name="token" value={q("token")} />
        <label className="f">{t("new_password")}<input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
        <label className="f">{t("confirm_password")}<input id="confirm" name="confirm" type="password" minLength={8} autoComplete="new-password" required /></label>
        <button type="submit" className="btn primary">{t("reset_btn")}</button>
        <div className="small"><Link href="/login">← {t("login_btn")}</Link></div>
      </form>
    </div>
  );
}
