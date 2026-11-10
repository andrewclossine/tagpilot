import Link from "next/link";
import { desc, eq, and, or, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { awaitingMe } from "@/lib/requisitions";
import { evaluationTasks } from "@/lib/committee";
import { LocalTime } from "@/components/datetime";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Purchase requisitions" };

/** Requests to buy: what waits for this person, then the requests they may see. */
export default async function RequisitionsPage() {
  const ctx = await requireView("requisitions");
  const { t, money } = await getI18n();
  const db = await getDb();
  const all = ctx.can("procurement") || ctx.isAdmin;
  const stepsOfMine = db.select({ id: schema.requisitionSteps.requisitionId }).from(schema.requisitionSteps).where(eq(schema.requisitionSteps.approverId, ctx.user.id));
  const [waiting, tasks, rows] = await Promise.all([
    awaitingMe(db, ctx),
    evaluationTasks(db, ctx),
    db.select({ r: schema.requisitions, by: schema.users.name }).from(schema.requisitions)
      .innerJoin(schema.users, eq(schema.users.id, schema.requisitions.requestedBy))
      .where(and(eq(schema.requisitions.companyId, ctx.company.id), all ? undefined : or(eq(schema.requisitions.requestedBy, ctx.user.id), inArray(schema.requisitions.id, stepsOfMine))))
      .orderBy(desc(schema.requisitions.createdAt)).limit(300),
  ]);
  return (
    <div className="stack">
      <PageHead title={t("rq_title")}>
        {ctx.can("requisitions", "write") ? <Link className="btn primary" href="/procurement/requisitions/new">{t("rq_new")}</Link> : null}
        {ctx.isAdmin ? <Link className="btn" href="/procurement/requisitions/levels">{t("rq_levels")}</Link> : null}
      </PageHead>

      {waiting.length || tasks.length ? (
        <div className="panel stack">
          <h2>{t("rq_waiting_for_you")}</h2>
          <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 6 }}>
            {waiting.map(({ r, step }) => (
              <li key={r.id}><Link href={`/procurement/requisitions/${r.id}`}><b>{r.number}</b> · {r.title}</Link> <span className="small muted">· {step} · {money(r.total, 2)} {ctx.company.currency}</span></li>
            ))}
            {tasks.map((x) => (
              <li key={`${x.kind}-${x.tender.id}`}><Link href={`/procurement/${x.tender.id}/evaluation`}><b>{x.tender.number}</b> · {x.tender.title}</Link> <span className="small muted">· {t(x.kind === "score" ? "cm_task_score" : x.kind === "declare" ? "cm_task_declare" : "cm_task_award")}</span></li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("rq_number")}</th><th>{t("rq_title_field")}</th><th>{t("rq_requested_by")}</th><th>{t("rq_submitted")}</th><th className="num">{t("rq_total")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{rows.map(({ r, by }) => (
              <tr key={r.id}>
                <td><Link className="rowlink" href={`/procurement/requisitions/${r.id}`}><code className="k">{r.number}</code></Link></td>
                <td><Link className="rowlink" href={`/procurement/requisitions/${r.id}`}>{r.title}</Link>{r.department ? <div className="small muted">{r.department}</div> : null}</td>
                <td>{by}</td>
                <td>{r.submittedAt ? <LocalTime value={r.submittedAt.toISOString()} /> : <span className="muted">-</span>}</td>
                <td className="num">{money(r.total, 2)}</td>
                <td><Pill kind={r.status}>{t(`rqs_${r.status}`)}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("rq_empty")}</Empty>}
      </div>
    </div>
  );
}
