import Link from "next/link";
import { requestPasswordReset } from "@/app/session-actions";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote } from "@/components/ui";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Forgot password" };

export default async function ForgotPage({ searchParams }: { searchParams: SearchParams }) {
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="auth">
      <form action={requestPasswordReset} className="panel stack">
        <Logo size={34} />
        <h1>{t("forgot_title")}</h1>
        <ErrorNote message={err(q("error"))} />
        {q("sent") ? <div className="note ok small">{t("forgot_sent")}</div> : (
          <>
            <p className="muted small" style={{ margin: 0 }}>{t("forgot_help")}</p>
            <label className="f">{t("login_name")}<input id="login" name="login" autoComplete="username" autoCapitalize="none" required /></label>
            <button type="submit" className="btn primary">{t("forgot_btn")}</button>
          </>
        )}
        <div className="small muted">{t("forgot_staff")}</div>
        <div className="small"><Link href="/login">← {t("login_btn")}</Link></div>
      </form>
    </div>
  );
}
