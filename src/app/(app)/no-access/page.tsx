import Link from "next/link";
import { getI18n } from "@/lib/i18n";

export const metadata = { title: "No access" };

export default async function NoAccess() {
  const { t } = await getI18n();
  return (
    <div className="panel stack" style={{ maxWidth: 520 }}>
      <h1>{t("no_access_title")}</h1>
      <p className="muted" style={{ margin: 0 }}>{t("no_access_text")}</p>
      <div><Link className="btn" href="/dashboard">{t("nav_dashboard")}</Link></div>
    </div>
  );
}
