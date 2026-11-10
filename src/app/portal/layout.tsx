import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSupplier } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { setLang, signOut } from "@/app/session-actions";
import { Logo } from "@/components/Logo";
import { NavLinks } from "@/components/NavLinks";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSupplier();
  const { t, lang } = await getI18n();
  const db = await getDb();
  const [partner] = await db.select({ name: schema.partners.name }).from(schema.partners).where(eq(schema.partners.id, ctx.partnerId));
  return (
    <div className="shell">
      <aside className="side">
        <div style={{ padding: "0 6px" }}><Logo size={30} onDark /></div>
        <div style={{ padding: "0 8px", fontWeight: 600, color: "#fff" }}>{ctx.company.name}</div>
        <NavLinks items={[{ group: t("portal_title") }, { href: "/portal", label: t("portal_tenders") }, { href: "/portal/contracts", label: t("nav_contracts") }, { href: "/portal/profile", label: t("reg_my_profile") }]} />
        <div className="foot">
          <div>{partner?.name}<div className="small" style={{ opacity: .7 }}>@{ctx.user.username} · {ctx.user.name}</div></div>
          <form action={setLang} className="row" style={{ gap: 6 }}>
            <input type="hidden" name="back" value="/portal" />
            <button type="submit" name="lang" value="en" className="btn sm" aria-pressed={lang === "en"}>EN</button>
            <button type="submit" name="lang" value="fr" className="btn sm" aria-pressed={lang === "fr"}>FR</button>
          </form>
          <form action={signOut}><button type="submit" className="btn sm">{t("sign_out")}</button></form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
