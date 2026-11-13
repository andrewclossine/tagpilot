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

/** The three apps TAGPILOT sells, each with its own page on the public site. */
export const PRODUCTS = ["accounting", "projects", "procurement"] as const;
export type Product = (typeof PRODUCTS)[number];

/** The public site's top bar: product links, language, sign in and the free trial. */
export async function SiteHeader({ back }: { back: string }) {
  const { lang, c } = await siteText();
  return (
    <header className="site-head">
      <div className="site-wrap site-bar">
        <Link href="/" aria-label="TAGPILOT" style={{ textDecoration: "none" }}><Logo size={30} /></Link>
        <nav className="site-nav" aria-label="TAGPILOT">
          <Link href="/products/accounting">{c.nav_accounting}</Link>
          <Link href="/products/projects">{c.nav_projects}</Link>
          <Link href="/products/procurement">{c.nav_procurement}</Link>
          <Link href="/why">{c.nav_why}</Link>
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
          <b className="small">{c.footer_products}</b>
          <Link className="small" href="/products/accounting">{c.app_accounting}</Link>
          <Link className="small" href="/products/projects">{c.app_projects}</Link>
          <Link className="small" href="/products/procurement">{c.app_procurement}</Link>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">{c.footer_company}</b>
          <Link className="small" href="/why">{c.nav_why}</Link>
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

/** The closing band of the product and "why" pages: Kigali from the air, and the free trial. */
export async function SiteTryBand() {
  const { c } = await siteText();
  return (
    <section className="site-section site-final-band">
      <div className="site-wrap site-final">
        <h2>{c.final_title}</h2>
        <p className="site-lead">{c.final_sub}</p>
        <div className="row" style={{ gap: 10, justifyContent: "center" }}>
          <Link className="btn primary site-big" href="/signup">{c.hero_cta}</Link>
          <Link className="btn site-big" href="/pricing">{c.hero_cta2}</Link>
        </div>
      </div>
    </section>
  );
}

/** Unsplash asks for the photographer's name next to the photo; this line goes under the pages that use them. */
export async function PhotoCredit({ names }: { names: string[] }) {
  const { c } = await siteText();
  return <p className="site-wrap site-credit">{names.length > 1 ? c.photos_by : c.photo_by}: {names.join(", ")}, Unsplash.</p>;
}
