import type { Metadata } from "next";
import { PhotoCredit, SiteFooter, SiteHeader, SiteTryBand, siteText } from "@/components/Site";

export const metadata: Metadata = {
  title: "Why TAGPILOT",
  description: "Procurement, projects and accounting on the same data, with approvals, signatures, sealed bids and an audit trail built in.",
};

/** Why organisations choose TAGPILOT: six reasons beside a photo. */
export default async function WhyPage() {
  const { c } = await siteText();
  return (
    <div className="site">
      <SiteHeader back="/why" />
      <main>
        <section className="site-section">
          <div className="site-wrap stack" style={{ gap: 28 }}>
            <div className="site-head-block"><h1 className="site-h1">{c.why_title}</h1><p className="site-lead">{c.apps_sub}</p></div>
            <div className="site-why-split">
              <img className="site-why-photo" src="/images/photos/team-couch.webp" alt="" width={1600} height={1067} fetchPriority="high" />
              <div className="site-why-grid">
                {c.why.map(([title, text]) => (
                  <div key={title} className="site-why"><h3>{title}</h3><p className="muted">{text}</p></div>
                ))}
              </div>
            </div>
          </div>
        </section>
        <SiteTryBand />
        <PhotoCredit names={["Iwaria Inc.", "Omoniyi David"]} />
      </main>
      <SiteFooter />
    </div>
  );
}
