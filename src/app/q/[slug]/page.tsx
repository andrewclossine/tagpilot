import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getI18n } from "@/lib/i18n";
import { deviceOf, qrContent } from "@/lib/qr";
import { Logo } from "@/components/Logo";

export const metadata = { title: "TAGPILOT", robots: { index: false, follow: false } };

/**
 * Where a dynamic QR code leads. The scan is counted (device kind only, no address), then a website opens at once, a
 * file opens, and other content (a contact card, Wi-Fi, a phone number...) is shown with the button that uses it.
 */
export default async function QrScanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[A-Za-z0-9]{4,16}$/.test(slug)) notFound();
  const db = await getDb();
  const [c] = await db.select().from(schema.qrCodes).where(eq(schema.qrCodes.slug, slug));
  if (!c || !c.dynamic) notFound();
  const { t } = await getI18n();
  const shell = (body: React.ReactNode) => (
    <main className="qr-landing"><div className="panel stack" style={{ maxWidth: 460, margin: "0 auto" }}><Logo size={26} />{body}</div></main>
  );
  if (!c.active) return shell(<div className="note info">{t("qr_inactive")}</div>);
  const ua = (await headers()).get("user-agent") ?? "";
  // Link checkers and previews are not people scanning.
  if (!/bot|crawler|spider|preview|facebookexternalhit|whatsapp/i.test(ua)) {
    await db.insert(schema.qrScans).values({ codeId: c.id, ...deviceOf(ua) });
    await db.update(schema.qrCodes).set({ scans: sql`${schema.qrCodes.scans} + 1` }).where(eq(schema.qrCodes.id, c.id));
  }
  const content = qrContent(c.type, c.data);
  if (c.type === "url") redirect(content);
  if (c.type === "file") redirect(`/api/qr/${slug}/file`);
  const d = c.data;
  const btn = (href: string, label: string) => <a className="btn primary" href={href}>{label}</a>;
  return shell(
    <>
      <h1 style={{ margin: 0 }}>{c.name}</h1>
      {c.type === "text" ? <p style={{ whiteSpace: "pre-wrap" }}>{d.text}</p> : null}
      {c.type === "vcard" ? <>
        <div><b>{[d.first, d.last].filter(Boolean).join(" ")}</b>{d.title ? ` · ${d.title}` : ""}{d.org ? <div className="muted">{d.org}</div> : null}</div>
        <div className="stack small" style={{ gap: 4 }}>{[d.phone, d.mobile].filter(Boolean).map((p) => <a key={p} href={`tel:${p}`}>{p}</a>)}{d.email ? <a href={`mailto:${d.email}`}>{d.email}</a> : null}{d.website ? <a href={d.website}>{d.website}</a> : null}{d.address ? <span>{d.address}</span> : null}</div>
        {btn(`/api/qr/${slug}/vcard`, t("qr_save_contact"))}
      </> : null}
      {c.type === "email" ? <><div>{d.email}{d.subject ? ` · ${d.subject}` : ""}</div>{btn(content, t("qr_send_email"))}</> : null}
      {c.type === "phone" ? <><div>{d.phone}</div>{btn(content, t("qr_call"))}</> : null}
      {c.type === "sms" ? <><div>{d.phone}</div>{btn(`sms:${d.phone}?body=${encodeURIComponent(d.message ?? "")}`, t("qr_send_sms"))}</> : null}
      {c.type === "wifi" ? <div className="stack small"><div>{t("qr_f_ssid")}: <b>{d.ssid}</b></div>{d.security !== "nopass" ? <div>{t("qr_f_password")}: <code className="k">{d.password}</code></div> : null}</div> : null}
      {c.type === "location" ? <>{d.label ? <div>{d.label}</div> : null}{btn(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.lat},${d.lng}`)}`, t("qr_open_map"))}</> : null}
    </>,
  );
}
