import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { getPlatformOwner } from "@/lib/platform";
import { ErrorNote } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { platformSignIn } from "../session";

export const metadata = { title: "Platform sign in" };

/** The platform owner's own sign-in, apart from the organisations' sign-in. */
export default async function PlatformLoginPage({ searchParams }: { searchParams: SearchParams }) {
  if (await getPlatformOwner()) redirect("/platform");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="auth">
      <form action={platformSignIn} className="panel stack">
        <Logo size={34} />
        <h1>{t("plt_login_title")}</h1>
        <p className="muted small" style={{ margin: 0 }}>{t("plt_login_help")}</p>
        <ErrorNote message={err(q("error"))} />
        <label className="f">{t("email")}<input id="email" name="email" type="email" autoComplete="username" autoCapitalize="none" required /></label>
        <label className="f">{t("password")}<input id="password" name="password" type="password" autoComplete="current-password" required /></label>
        <button type="submit" className="btn primary">{t("login_btn")}</button>
      </form>
    </div>
  );
}
