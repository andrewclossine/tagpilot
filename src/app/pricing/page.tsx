import Link from "next/link";
import type { Metadata } from "next";
import { pickCurrency } from "@/lib/billing";
import { PRICED } from "@/lib/site-copy";
import { SiteFooter, SiteHeader, siteText } from "@/components/Site";
import type { SearchParams } from "@/lib/actions";
import { sp } from "@/lib/actions";
import { TIERS } from "@/lib/plans";
import type { ModuleKey } from "@/db/schema";

export const metadata: Metadata = {
  title: "Pricing",
  description: "TAGPILOT pricing by app and package, from Free to Premium, with a 30-day free trial.",
};

/** Prices come from the same settings the subscription uses, so this page always shows what customers pay. */
export default async function PricingPage({ searchParams }: { searchParams: SearchParams }) {
  const { lang, c } = await siteText();
  const q = await sp(searchParams);
  const yearly = q("period") === "yearly";
  const { currency, prices, currencies } = await pickCurrency(q("cur"));
  const link = (extra: Record<string, string>) => `/pricing?${new URLSearchParams({ ...(yearly ? { period: "yearly" } : {}), ...(currency !== currencies[0] ? { cur: currency } : {}), ...extra })}`;
  const fmt = (n: number) => new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  const show = (monthly: number) => (yearly ? monthly * 10 : monthly);
  const names = { accounting: c.app_accounting, projects: c.app_projects, procurement: c.app_procurement } as const;
  // Each app from its Starter package; the bundle is the three apps on Starter together.
  const from = (m: string) => prices[`${m}:starter`] ?? 0;
  const all = from("accounting") + from("projects") + from("procurement");
  const tierName = (tier: string) => (tier === "free" ? (lang === "fr" ? "Gratuit" : "Free") : tier[0].toUpperCase() + tier.slice(1));
  const per = yearly ? c.pr_per_year : c.pr_per_month;
  return (
    <div className="site">
      <SiteHeader back="/pricing" />
      <main>
        <section className="site-section">
          <div className="site-wrap stack" style={{ gap: 28 }}>
            <div className="site-head-block" style={{ textAlign: "center", marginInline: "auto" }}>
              <h1 className="site-h1" style={{ fontSize: "clamp(28px, 4vw, 42px)" }}>{c.pr_title}</h1>
              <p className="site-lead">{c.pr_sub}</p>
              <div className="site-toggle" role="group" aria-label={c.nav_pricing}>
                <Link href={link({ period: "monthly" }).replace(/period=monthly&?/, "")} aria-pressed={!yearly}>{c.pr_monthly}</Link>
                <Link href={link({ period: "yearly" })} aria-pressed={yearly}>{c.pr_yearly} <span className="site-badge">{c.pr_yearly_badge}</span></Link>
              </div>
              {currencies.length > 1 ? (
                <div className="site-toggle" role="group" aria-label="Currency">
                  {currencies.map((cur) => <Link key={cur} href={link({ cur })} aria-pressed={cur === currency}>{cur}</Link>)}
                </div>
              ) : null}
            </div>

            <div className="site-prices">
              {PRICED.map(({ key, points }) => (
                <div key={key} className="panel site-price">
                  <h3>{names[key as keyof typeof names]}</h3>
                  <div className="site-amount"><span className="small muted">{lang === "fr" ? "dès " : "from "}</span>{fmt(show(from(key)))}<span className="small muted"> / {per}</span></div>
                  <div className="small">{TIERS[key as ModuleKey].map((tier) => `${tierName(tier)} ${fmt(show(prices[`${key}:${tier}`] ?? 0))}`).join(" · ")}</div>
                  <div className="small muted">{c.pr_unlimited}{yearly ? ` · ${c.pr_billed_yearly}` : ""}</div>
                  <ul className="site-ticks">{points ? c[points].map((p) => <li key={p}>{p}</li>) : null}</ul>
                  <Link className="btn" href="/signup">{c.pr_choose}</Link>
                </div>
              ))}
              <div className="panel site-price site-price-best">
                <div className="site-ribbon">{c.pr_popular}</div>
                <h3>{c.pr_bundle_title}</h3>
                <div className="site-amount">{fmt(show(all))}<span className="small muted"> / {per}</span></div>
                <div className="small muted">{c.pr_unlimited}{yearly ? ` · ${c.pr_billed_yearly}` : ""}</div>
                <p className="small" style={{ margin: 0 }}>{c.pr_bundle_sub}</p>
                <ul className="site-ticks">{c.pr_included.slice(0, 4).map((p) => <li key={p}>{p}</li>)}</ul>
                <Link className="btn primary" href="/signup">{c.pr_choose}</Link>
              </div>
            </div>

            <div className="panel site-split" style={{ padding: 20 }}>
              <div className="stack" style={{ gap: 6 }}>
                <h3 style={{ margin: 0 }}>{c.pr_suppliers_title} · {fmt(show(prices["bidding:starter"] ?? 0))} / {per}</h3>
                <div className="small muted">{c.pr_suppliers_sub}</div>
                <div className="small">{c.pr_invited_free}</div>
              </div>
              <div><Link className="btn" href="/signup">{c.suppliers_cta}</Link></div>
            </div>

            <div className="stack" style={{ gap: 12 }}>
              <h2>{c.pr_included_title}</h2>
              <ul className="site-ticks site-ticks-grid">{c.pr_included.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>

            <div className="stack" style={{ gap: 12 }}>
              <h2>{c.pr_faq_title}</h2>
              <div className="site-faq">
                {c.faq.map(([qn, an]) => (
                  <details key={qn} className="panel"><summary><b>{qn}</b></summary><p className="muted" style={{ marginBottom: 0 }}>{an}</p></details>
                ))}
              </div>
            </div>

            <div className="site-final">
              <h2>{c.final_title}</h2>
              <p className="site-lead">{c.final_sub}</p>
              <div><Link className="btn primary site-big" href="/signup">{c.hero_cta}</Link></div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
