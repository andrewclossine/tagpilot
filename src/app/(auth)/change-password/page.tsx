import { redirect } from "next/navigation";
import { changeTempPassword, signOut } from "@/app/session-actions";
import { getCurrentUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote } from "@/components/ui";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Choose your password" };

/** Right after signing in with a one-time password: the person chooses the password they will use from now on. */
export default async function ChangePasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect("/apps");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="auth">
      <form action={changeTempPassword} className="panel stack">
        <Logo size={34} />
        <h1>{t("pw_choose_title")}</h1>
        <p className="muted small" style={{ margin: 0 }}>{t("pw_choose_help").replace("{name}", user.name)}</p>
        <ErrorNote message={err(q("error"))} />
        <label className="f">{t("new_password")}<input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
        <label className="f">{t("confirm_password")}<input id="confirm" name="confirm" type="password" minLength={8} autoComplete="new-password" required /></label>
        <button type="submit" className="btn primary">{t("pw_choose_btn")}</button>
        <button type="submit" formAction={signOut} formNoValidate className="btn ghost sm">{t("sign_out")}</button>
      </form>
    </div>
  );
}
