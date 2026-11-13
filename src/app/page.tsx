import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { SiteFooter, SiteHeader, siteText } from "@/components/Site";

export const metadata: Metadata = {
  title: { absolute: "TAGPILOT · Accounting, projects and procurement in one system" },
  description: "TAGPILOT keeps your books, runs your project budgets and takes every purchase from the request to the payment: requisitions, sealed bids, evaluation committees, purchase orders, goods received and three-way matching.",
};

/** The public home page. Someone signed in goes straight to their apps. */
export default async function Home() {
  if (await getCurrentUser()) redirect("/apps");
  const { c } = await siteText();
  const apps: [string, string[], string, string][] = [
    [c.app_accounting, c.acc_points, "var(--app-accounting)", "accountant"],
    [c.app_projects, c.proj_points, "var(--app-projects)", "colleagues"],
    [c.app_procurement, c.proc_points, "var(--app-procurement)", "meeting"],
  ];
  return (
    <div className="site">
      <SiteHeader back="/" />
      <main>
        <section className="site-hero">
          <div className="site-wrap site-hero-grid">
            <div className="stack" style={{ gap: 18 }}>
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
        </section>

        <section className="site-section" id="features">
          <div className="site-wrap stack" style={{ gap: 24 }}>
            <div className="site-head-block"><h2>{c.apps_title}</h2><p className="site-lead">{c.apps_sub}</p></div>
            <div className="site-cards3">
              {apps.map(([name, points, color, photo]) => (
                <div key={name} className="panel site-card has-photo" style={{ borderTop: `4px solid ${color}` }}>
                  <img className="site-card-photo" src={`/images/photos/${photo}.webp`} alt="" loading="lazy" />
                  <h3>{name}</h3>
                  <ul className="site-ticks">{points.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section site-alt" id="procurement">
          <div className="site-wrap stack" style={{ gap: 24 }}>
            <div className="site-head-block"><h2>{c.p2p_title}</h2><p className="site-lead">{c.p2p_sub}</p></div>
            <ol className="site-steps">
              {c.steps.map(([title, text], i) => (
                <li key={title} className="panel">
                  <span className="site-step-no">{String(i + 1).padStart(2, "0")}</span>
                  <b>{title}</b>
                  <span className="small muted">{text}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="site-section">
          <div className="site-wrap stack" style={{ gap: 24 }}>
            <div className="site-head-block"><h2>{c.tour_title}</h2><p className="site-lead">{c.tour_sub}</p></div>
            <div className="site-tour">
              {([["invoices", 1600, 911], ["report", 1600, 956], ["dashboard-phone", 560, 1212]] as const).map(([img, w, h], i) => (
                <figure key={img} className={`site-tour-item${img.includes("phone") ? " phone" : ""}`}>
                  <div className="site-frame"><img src={`/images/screens/${img}.webp`} alt={c.tour[i][0]} width={w} height={h} loading="lazy" /></div>
                  <figcaption><b>{c.tour[i][0]}</b><span className="small muted">{c.tour[i][1]}</span></figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section site-alt">
          <div className="site-wrap stack" style={{ gap: 24 }}>
            <div className="site-head-block"><h2>{c.why_title}</h2></div>
            <div className="site-why-split">
              <img className="site-why-photo" src="/images/photos/team-couch.webp" alt="" width={1600} height={1067} loading="lazy" />
              <div className="site-why-grid">
                {c.why.map(([title, text]) => (
                  <div key={title} className="site-why"><h3>{title}</h3><p className="muted">{text}</p></div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="site-section">
          <div className="site-wrap site-split">
            <div className="stack" style={{ gap: 10 }}>
              <h2>{c.suppliers_title}</h2>
              <p className="muted" style={{ margin: 0 }}>{c.suppliers_sub}</p>
            </div>
            <div><Link className="btn site-big" href="/signup">{c.suppliers_cta}</Link></div>
          </div>
        </section>

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
        <p className="site-wrap site-credit">{c.photo_credit}</p>
      </main>
      <SiteFooter />
    </div>
  );
}
