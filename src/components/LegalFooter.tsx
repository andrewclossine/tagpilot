import Link from "next/link";
import { getI18n } from "@/lib/i18n";

/** The company that owns and runs TAGPILOT. */
export const COMPANY = "Andovexa Ltd";

/** Support contacts come from the server's settings, so they can change without a new release; empty ones are not shown. */
export const supportContacts = () => ({ email: (process.env.SUPPORT_EMAIL ?? "").trim(), phone: (process.env.SUPPORT_PHONE ?? "").trim() });

/** The bottom line of every page: copyright, terms, privacy, and how to reach support. */
export async function LegalFooter({ className = "legal-foot" }: { className?: string }) {
  const { t } = await getI18n();
  const { email, phone } = supportContacts();
  return (
    <footer className={className}>
      <span>© {new Date().getFullYear()} {COMPANY} · TAGPILOT. {t("lg_rights")}</span>
      <Link href="/terms">{t("lg_terms")}</Link>
      <Link href="/privacy">{t("lg_privacy")}</Link>
      {email ? <a href={`mailto:${email}`}>{t("lg_support")}: {email}</a> : null}
      {phone ? <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{t("lg_phone")}: {phone}</a> : null}
    </footer>
  );
}
