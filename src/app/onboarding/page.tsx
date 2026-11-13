import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createCompany } from "@/app/session-actions";
import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { CompanyFields } from "@/components/CompanyFields";
import { ModulePicker } from "@/components/ModulePicker";
import { modulePrices, planPrices } from "@/lib/billing";
import { MODULES } from "@/lib/roles";

export const metadata = { title: "Set up your organisation" };

/** Shown once, right after sign-up: each subscription opens exactly one organisation. */
export default async function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const db = await getDb();
  const [member] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id)).limit(1);
  if (member) redirect("/apps");
  const { t, err, lang } = await getI18n();
  const q = await sp(searchParams);
  const wanted = q("module");
  return (
    <div className="auth">
      <form action={createCompany} className="panel stack" style={{ maxWidth: 720 }}>
        <Logo size={30} />
        <h1>{t("onb_title")}</h1>
        <p className="muted small" style={{ margin: 0 }}>{t("onb_sub")}</p>
        <ErrorNote message={err(q("error"))} />
        <h2>{t("modules_title")}</h2>
        <p className="muted small" style={{ margin: 0 }}>{t("modules_sub")}</p>
        <ModulePicker t={t} lang={lang} prices={modulePrices()} currency={planPrices([]).currency} selected={MODULES.filter((m) => m === wanted)} />
        <CompanyFields t={t} />
        <div className="note small">{t("co_chart_note")}</div>
        <div className="small muted">{t("trial_note")}</div>
        <button type="submit" className="btn primary">{t("onb_btn")}</button>
      </form>
    </div>
  );
}
