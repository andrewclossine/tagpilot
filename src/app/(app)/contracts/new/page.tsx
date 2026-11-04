import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { today } from "@/lib/format";
import { ErrorNote, PageHead } from "@/components/ui";
import { createContract } from "../actions";

export const metadata = { title: "New contract" };

export default async function NewContractPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("contracts");
  if (!ctx.can("contracts", "write")) redirect("/no-access");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [partners, projects] = await Promise.all([
    db.select().from(schema.partners).where(and(eq(schema.partners.companyId, ctx.company.id), inArray(schema.partners.kind, ["supplier", "both"]))).orderBy(schema.partners.name),
    db.select().from(schema.projects).where(eq(schema.projects.companyId, ctx.company.id)).orderBy(schema.projects.code),
  ]);
  return (
    <div className="stack">
      <PageHead title={t("ct_new")} />
      <ErrorNote message={err(q("error"))} />
      <form action={createContract} className="panel stack">
        <label className="f">{t("ct_subject")}<input id="c-title" name="title" required /></label>
        <label className="f">{t("ct_scope")}<textarea id="c-scope" name="scope" rows={3} /></label>
        <div className="fields">
          <label className="f">{t("supplier")}
            <select id="c-partner" name="partnerId" required defaultValue="">
              <option value="" disabled>{t("none")}</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          <label className="f">{t("project")}
            <select id="c-project" name="projectId" defaultValue="">
              <option value="">{t("none")}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select></label>
          <label className="f">{t("ct_amount")} ({ctx.company.currency})<input id="c-amount" name="amount" className="num" inputMode="decimal" required /></label>
          <label className="f">{t("ct_signed_date")}<input id="c-signed" name="signedDate" type="date" required defaultValue={today()} /></label>
          <label className="f">{t("ct_start")}<input id="c-start" name="startDate" type="date" required defaultValue={today()} /></label>
          <label className="f">{t("ct_end")}<input id="c-end" name="endDate" type="date" required /></label>
        </div>
        <label className="f">{t("ct_signed_file")}<input id="c-file" name="file" type="file" accept="image/*,application/pdf" /></label>
        <div className="row">
          <button type="submit" className="btn primary">{t("save")}</button>
          <Link className="btn ghost" href="/contracts">{t("cancel")}</Link>
        </div>
      </form>
    </div>
  );
}
