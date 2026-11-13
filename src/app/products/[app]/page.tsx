import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PhotoCredit, PRODUCTS, type Product, SiteFooter, SiteHeader, SiteTryBand, siteText } from "@/components/Site";
import { AppIcon } from "@/components/AppIcon";

const TITLES: Record<Product, string> = { accounting: "Accounting", projects: "Project management", procurement: "Procurement" };
const PHOTOS: Record<Product, [string, string]> = {
  accounting: ["accountant", "Francis Odeyemi"],
  projects: ["colleagues", "Vitaly Gariev"],
  procurement: ["meeting", "Christina @ wocintechchat.com"],
};

export const generateStaticParams = () => PRODUCTS.map((app) => ({ app }));
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ app: string }> }): Promise<Metadata> {
  const { app } = await params;
  return { title: TITLES[app as Product] ?? "TAGPILOT" };
}

/** One page per app: what it does, a photo, and for accounting and procurement what it looks like and how it runs. */
export default async function ProductPage({ params }: { params: Promise<{ app: string }> }) {
  const { app } = await params;
  if (!(PRODUCTS as readonly string[]).includes(app)) notFound();
  const p = app as Product;
  const { c } = await siteText();
  const info = {
    accounting: [c.app_accounting, c.acc_sub, c.acc_points],
    projects: [c.app_projects, c.proj_sub, c.proj_points],
    procurement: [c.app_procurement, c.proc_sub, c.proc_points],
  } as const;
  const [name, sub, points] = info[p];
  const [photo, by] = PHOTOS[p];
  return (
    <div className="site">
      <SiteHeader back={`/products/${p}`} />
      <main>
        <section className="site-hero">
          <div className="site-wrap site-hero-grid">
            <div className="stack" style={{ gap: 16 }}>
              <div className="row" style={{ gap: 12, alignItems: "center" }}>
                <AppIcon app={p} size={48} />
                <div className="site-kicker">TAGPILOT</div>
              </div>
              <h1 className="site-h1">{name}</h1>
              <p className="site-lead">{sub}</p>
              <ul className="site-ticks">{points.map((x) => <li key={x}>{x}</li>)}</ul>
              <div className="row" style={{ gap: 10 }}>
                <Link className="btn primary site-big" href="/signup">{c.hero_cta}</Link>
                <Link className="btn site-big" href="/pricing">{c.hero_cta2}</Link>
              </div>
            </div>
            <img className="product-photo" src={`/images/photos/${photo}.webp`} alt="" fetchPriority="high" />
          </div>
        </section>

        {p === "accounting" ? (
          <section className="site-section site-alt">
            <div className="site-wrap stack" style={{ gap: 24 }}>
              <div className="site-head-block"><h2>{c.acc_more}</h2><p className="site-lead">{c.tour_sub}</p></div>
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
        ) : null}

        {p === "procurement" ? (
          <>
            <section className="site-section site-alt">
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
              <div className="site-wrap site-split">
                <div className="stack" style={{ gap: 10 }}>
                  <h2>{c.suppliers_title}</h2>
                  <p className="muted" style={{ margin: 0 }}>{c.suppliers_sub}</p>
                </div>
                <div><Link className="btn site-big" href="/signup">{c.suppliers_cta}</Link></div>
              </div>
            </section>
          </>
        ) : null}

        <SiteTryBand />
        <PhotoCredit names={[by, "Omoniyi David"]} />
      </main>
      <SiteFooter />
    </div>
  );
}
