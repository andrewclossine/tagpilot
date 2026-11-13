import Link from "next/link";
import { getI18n } from "@/lib/i18n";
import { siteCopy } from "@/lib/site-copy";
import { setLang } from "@/app/session-actions";
import { Logo } from "./Logo";
import { LegalFooter } from "./LegalFooter";

export async function siteText() {
  const { lang } = await getI18n();
  return { lang, c: siteCopy[lang] };
}

/** The public site's top bar: product links, language, sign in and the free trial. */
export async function SiteHeader({ back }: { back: string }) {
  const { lang, c } = await siteText();
  return (
    <header className="site-head">
      <div className="site-wrap site-bar">
        <Link href="/" aria-label="TAGPILOT" style={{ textDecoration: "none" }}><Logo size={30} /></Link>
        <nav className="site-nav" aria-label="TAGPILOT">
          <Link href="/#features">{c.nav_features}</Link>
          <Link href="/#procurement">{c.nav_procurement}</Link>
          <Link href="/pricing">{c.nav_pricing}</Link>
          <Link href="/download">{c.nav_app}</Link>
        </nav>
        <div className="site-actions">
          <form action={setLang} className="row" style={{ gap: 4 }}>
            <input type="hidden" name="back" value={back} />
            <button type="submit" name="lang" value="en" className="btn sm ghost" aria-pressed={lang === "en"}>EN</button>
            <button type="submit" name="lang" value="fr" className="btn sm ghost" aria-pressed={lang === "fr"}>FR</button>
          </form>
          <Link className="btn sm" href="/login">{c.nav_signin}</Link>
          <Link className="btn sm primary" href="/signup">{c.nav_trial}</Link>
        </div>
      </div>
    </header>
  );
}

export async function SiteFooter() {
  const { c } = await siteText();
  return (
    <footer className="site-foot">
      <div className="site-wrap site-foot-grid">
        <div className="stack" style={{ gap: 8 }}>
          <Logo size={26} />
          <div className="small muted" style={{ maxWidth: 320 }}>{c.footer_tag}</div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">{c.footer_product}</b>
          <Link className="small" href="/#features">{c.nav_features}</Link>
          <Link className="small" href="/#procurement">{c.nav_procurement}</Link>
          <Link className="small" href="/pricing">{c.nav_pricing}</Link>
          <Link className="small" href="/download">{c.nav_app}</Link>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">{c.footer_account}</b>
          <Link className="small" href="/login">{c.nav_signin}</Link>
          <Link className="small" href="/signup">{c.nav_trial}</Link>
        </div>
      </div>
      <div className="site-wrap"><LegalFooter className="legal-foot site-legal" /></div>
    </footer>
  );
}
