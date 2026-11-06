import Link from "next/link";
import { requirePlatformOwner } from "@/lib/platform";
import { getI18n } from "@/lib/i18n";
import { Logo } from "@/components/Logo";
import { platformSignOut } from "../session";

export const metadata = { title: "Platform" };

/** The platform owner's own frame: no organisation menus, since this part sits above all organisations. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const owner = await requirePlatformOwner();
  const { t } = await getI18n();
  return (
    <div className="launcher">
      <header className="launcher-top">
        <Link href="/platform" style={{ textDecoration: "none" }}><Logo size={30} /></Link>
        <b>{t("plt_title")}</b>
        <span className="spacer" />
        <span className="small muted">{owner.name} · {owner.email}</span>
        <form action={platformSignOut}><button type="submit" className="btn sm">{t("sign_out")}</button></form>
      </header>
      <main className="main" style={{ maxWidth: 1200, margin: "0 auto", width: "100%" }}>{children}</main>
    </div>
  );
}
