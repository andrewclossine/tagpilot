import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { addLevel, removeLevel } from "../actions";

export const metadata = { title: "Approval levels" };

/** Who approves requests to buy, by amount. Set by an administrator. */
export default async function LevelsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("requisitions");
  if (!ctx.isAdmin) redirect("/procurement/requisitions");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [levels, people] = await Promise.all([
    db.select({ l: schema.requisitionLevels, name: schema.users.name }).from(schema.requisitionLevels)
      .innerJoin(schema.users, eq(schema.users.id, schema.requisitionLevels.approverId))
      .where(eq(schema.requisitionLevels.companyId, ctx.company.id)).orderBy(asc(schema.requisitionLevels.sortOrder)),
    db.select({ id: schema.users.id, name: schema.users.name, role: schema.memberships.role }).from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.companyId, ctx.company.id), ne(schema.memberships.role, "supplier"))).orderBy(schema.users.name),
  ]);
  return (
    <div className="stack">
      <PageHead title={t("rq_levels")}><Link className="btn" href="/procurement/requisitions">{t("back")}</Link></PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      <div className="note info small">{t("rq_levels_help")}</div>
      <div className="panel">
        {levels.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>#</th><th>{t("rq_level_name")}</th><th className="num">{t("rq_level_from")} ({ctx.company.currency})</th><th>{t("rq_approver")}</th><th /></tr></thead>
            <tbody>{levels.map(({ l, name }, i) => (
              <tr key={l.id}>
                <td className="muted">{i + 1}</td><td><b>{l.name}</b></td><td className="num">{money(l.minAmount, 2)}</td><td>{name}</td>
                <td><form action={removeLevel}><input type="hidden" name="levelId" value={l.id} /><ConfirmButton className="btn sm ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("rq_no_levels")}</Empty>}
      </div>
      <form action={addLevel} className="panel stack">
        <h2>{t("rq_add_level")}</h2>
        <div className="fields">
          <label className="f">{t("rq_level_name")}<input id="l-name" name="name" required placeholder={t("rq_level_example")} /></label>
          <label className="f">{t("rq_level_from")} ({ctx.company.currency})<input id="l-min" name="minAmount" className="num" inputMode="decimal" defaultValue="0" /></label>
          <label className="f">{t("rq_approver")}
            <select id="l-approver" name="approverId" required defaultValue="">
              <option value="" disabled>{t("choose")}</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {t(`role_${p.role}`)}</option>)}
            </select></label>
        </div>
        <div><button type="submit" className="btn primary">{t("rq_add_level")}</button></div>
      </form>
    </div>
  );
}
