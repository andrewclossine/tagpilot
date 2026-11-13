import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { PhotoCredit, PRODUCTS, SiteHeader, siteText } from "@/components/Site";
import { AppIcon } from "@/components/AppIcon";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: { absolute: "TAGPILOT · Accounting, projects and procurement in one system" },
  description: "TAGPILOT keeps your books, runs your project budgets and takes every purchase from the request to the payment: requisitions, sealed bids, evaluation committees, purchase orders, goods received and three-way matching.",
};

/**
 * The public home page fits on one screen: what TAGPILOT is, how to start, and a door to each app. Everything else is
 * one click away on its own page. Someone signed in goes straight to their apps.
 */
export default async function Home() {
  if (await getCurrentUser()) redirect("/apps");
  const { c } = await siteText();
  const tiles = { accounting: [c.app_accounting, c.acc_line], projects: [c.app_projects, c.proj_line], procurement: [c.app_procurement, c.proc_line] };
  return (
    <div className="site site-home">
      <SiteHeader back="/" />
      <main className="home-main">
        <div className="site-wrap home-hero">
          <div className="stack" style={{ gap: 16 }}>
            <div className="site-kicker">{c.hero_kicker}</div>
            <h1 className="site-h1">{c.hero_title}</h1>
            <p className="site-lead">{c.hero_sub}</p>
            <div className="row" style={{ gap: 10 }}>
              <Link className="btn primary site-big" href="/signup">{c.hero_cta}</Link>
              <Link className="btn site-big" href="/pricing">{c.hero_cta2}</Link>
            </div>
            <div className="small muted">{c.hero_note}</div>
          </div>
          <div className="site-hero-visual">
            <figure className="site-frame site-hero-shot">
              <div className="site-shot-bar" aria-hidden="true"><i /><i /><i /></div>
              <img src="/images/screens/dashboard.webp" alt={c.shot_alt} width={1600} height={1000} fetchPriority="high" />
            </figure>
            <img className="site-hero-photo" src="/images/photos/work-laptop.webp" alt="" width={1600} height={900} />
          </div>
        </div>
        <nav className="site-wrap home-apps" aria-label={c.footer_products}>
          {PRODUCTS.map((p) => (
            <Link key={p} href={`/products/${p}`} className="home-app">
              <AppIcon app={p} size={44} />
              <span className="stack" style={{ gap: 2 }}>
                <b>{tiles[p][0]}</b>
                <span className="small muted">{tiles[p][1]}</span>
              </span>
              <span className="home-app-go" aria-hidden="true">→</span>
            </Link>
          ))}
        </nav>
      </main>
      <div className="home-foot">
        <LegalFooter className="legal-foot site-legal" />
        <PhotoCredit names={["Vitaly Gariev"]} />
      </div>
    </div>
  );
}
