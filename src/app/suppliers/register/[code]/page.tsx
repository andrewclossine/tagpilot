import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { companyByCode, EXPIRING, REQUIRED_DOCS } from "@/lib/suppliers";
import { ErrorNote } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { registerAction } from "./actions";

export const metadata = { title: "Supplier registration" };

/** The organisation's public supplier registration form. Works only while the organisation keeps registration open. */
export default async function SupplierRegisterPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: SearchParams }) {
  const { code } = await params;
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const company = await companyByCode(db, code);
  if (!company) notFound();
  const categories = await db.select().from(schema.supplierCategories).where(eq(schema.supplierCategories.companyId, company.id)).orderBy(asc(schema.supplierCategories.sortOrder), asc(schema.supplierCategories.name));
  return (
    <div className="auth">
      <form action={registerAction} className="panel stack" style={{ maxWidth: 680 }}>
        <Logo size={34} />
        <h1>{t("reg_title").replace("{org}", company.name)}</h1>
        <p className="muted small" style={{ margin: 0 }}>{t("reg_intro")}</p>
        <ErrorNote message={err(q("error"))} />
        <input type="hidden" name="code" value={code} />
        <div style={{ position: "absolute", left: "-9999px" }} aria-hidden="true"><label>Homepage<input name="homepage" tabIndex={-1} autoComplete="off" /></label></div>

        <h2>{t("reg_company")}</h2>
        <div className="fields">
          <label className="f">{t("sa_company_name")}<input id="r-company" name="companyName" required /></label>
          <label className="f">{t("tin")}<input id="r-tin" name="tin" required /></label>
          <label className="f">{t("phone")}<input id="r-phone" name="phone" required /></label>
          <label className="f">{t("email")}<input id="r-email" name="email" type="email" required /></label>
        </div>
        <div className="fields">
          <label className="f">{t("address")}<input id="r-address" name="address" /></label>
          <label className="f">{t("website")}<input id="r-website" name="website" /></label>
        </div>

        {categories.length ? <>
          <h2>{t("reg_categories")}</h2>
          <div className="small muted">{t("reg_categories_help")}</div>
          <div className="fields">
            {categories.map((c) => <label key={c.id} className="row small" style={{ gap: 8 }}><input type="checkbox" name="category" value={c.id} style={{ width: "auto" }} /> {c.name}</label>)}
          </div>
        </> : null}

        <h2>{t("reg_documents")}</h2>
        <div className="small muted">{t("reg_documents_help")}</div>
        {REQUIRED_DOCS.map((k) => (
          <div key={k} className="fields" style={{ alignItems: "end" }}>
            <label className="f">{t(`sdoc_${k}`)} *<input name={`doc_${k}`} type="file" accept="application/pdf,image/*" required /></label>
            <label className="f">{t("sdoc_reference")}<input name={`ref_${k}`} /></label>
            {EXPIRING.includes(k) ? <label className="f">{t("sdoc_expires")} *<input name={`exp_${k}`} type="date" required /></label> : <div />}
          </div>
        ))}

        <h2>{t("reg_account")}</h2>
        <div className="fields">
          <label className="f">{t("sa_contact")}<input id="r-contact" name="contact" required /></label>
          <label className="f">{t("username")}<input id="r-username" name="username" autoCapitalize="none" pattern="[a-zA-Z0-9._\-]{3,40}" required /></label>
          <label className="f">{t("password")}<input id="r-password" name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
          <label className="f">{t("reg_password2")}<input id="r-password2" name="password2" type="password" minLength={8} autoComplete="new-password" required /></label>
        </div>
        <div className="small muted">{t("reg_review_note")}</div>
        <button type="submit" className="btn primary">{t("reg_submit")}</button>
        <div className="small"><Link href="/login">{t("reg_have_account")}</Link></div>
      </form>
    </div>
  );
}
