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

export const metadata = { title: "Set up your organisation" };

/** Shown once, right after sign-up: each subscription opens exactly one organisation. */
export default async function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const db = await getDb();
  const [member] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id)).limit(1);
  if (member) redirect("/dashboard");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="auth">
      <form action={createCompany} className="panel stack" style={{ maxWidth: 720 }}>
        <Logo size={30} />
        <h1>{t("onb_title")}</h1>
        <p className="muted small" style={{ margin: 0 }}>{t("onb_sub")}</p>
        <ErrorNote message={err(q("error"))} />
        <CompanyFields t={t} />
        <div className="small muted">{t("trial_note")}</div>
        <button type="submit" className="btn primary">{t("onb_btn")}</button>
      </form>
    </div>
  );
}
