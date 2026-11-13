import { LEGAL, LEGAL_UPDATED } from "@/lib/legal-copy";
import { SiteFooter, SiteHeader, siteText } from "./Site";
import { supportContacts } from "./LegalFooter";

/** The Terms of Service or the Privacy Policy, in the reader's language, with how to reach us. */
export async function LegalPage({ which }: { which: "terms" | "privacy" }) {
  const { lang } = await siteText();
  const doc = LEGAL[which][lang];
  const { email, phone } = supportContacts();
  const contact = lang === "fr" ? "Nous contacter" : "Contact us";
  const updated = lang === "fr" ? "Dernière mise à jour" : "Last updated";
  return (
    <div className="site">
      <SiteHeader back={`/${which}`} />
      <main>
        <section className="site-section">
          <div className="site-wrap stack legal-doc">
            <h1 className="site-h1" style={{ fontSize: "clamp(28px, 4vw, 40px)" }}>{doc.title}</h1>
            <div className="small muted">{updated}: {LEGAL_UPDATED}</div>
            <p>{doc.intro}</p>
            {doc.sections.map(([h, p]) => <div key={h}><h2>{h}</h2><p>{p}</p></div>)}
            {email || phone ? (
              <div><h2>{contact}</h2><p>{email ? <a href={`mailto:${email}`}>{email}</a> : null}{email && phone ? " · " : null}{phone ? <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a> : null}</p></div>
            ) : null}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
