import { createCompany } from "@/app/session-actions";
import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ErrorNote } from "@/components/ui";

export const metadata = { title: "Set up your company" };

export default async function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="auth">
      <form action={createCompany} className="panel stack">
        <h1>{t("onb_title")}</h1>
        <p className="muted small" style={{ margin: 0 }}>{t("onb_sub")}</p>
        <ErrorNote message={err(q("error"))} />
        <label className="f">{t("co_name")}<input id="name" name="name" required /></label>
        <label className="f">{t("co_tin")}<input id="tin" name="tin" inputMode="numeric" /></label>
        <div className="fields">
          <label className="f">{t("co_vat")}<select id="vat" name="vat" defaultValue="1"><option value="1">{t("yes")}</option><option value="0">{t("no")}</option></select></label>
          <label className="f">{t("co_rate")}<input id="vatRate" name="vatRate" className="num" defaultValue="18" inputMode="decimal" /></label>
        </div>
        <button type="submit" className="btn primary">{t("onb_btn")}</button>
      </form>
    </div>
  );
}
