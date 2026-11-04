import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { addDays, today } from "@/lib/format";
import { currentTerms } from "@/lib/procurement";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Contracts" };

export default async function ContractsPage() {
  const ctx = await requireView("contracts");
  const { t, money } = await getI18n();
  const db = await getDb();
  const rows = await db.select({ c: schema.contracts, partner: schema.partners.name }).from(schema.contracts)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.contracts.partnerId))
    .where(eq(schema.contracts.companyId, ctx.company.id)).orderBy(desc(schema.contracts.createdAt)).limit(300);
  const ids = rows.map((r) => r.c.id);
  const [amendments, guarantees] = ids.length ? await Promise.all([
    db.select().from(schema.contractAmendments).where(inArray(schema.contractAmendments.contractId, ids)),
    db.select().from(schema.performanceGuarantees).where(inArray(schema.performanceGuarantees.contractId, ids)),
  ]) : [[], []];
  const soon = addDays(today(), 30);
  const expiring = guarantees.filter((g) => g.status === "active" && g.expiryDate <= soon);
  return (
    <div className="stack">
      <PageHead title={t("nav_contracts")}>
        {ctx.can("contracts", "write") ? <Link className="btn primary" href="/contracts/new">{t("ct_new")}</Link> : null}
      </PageHead>
      {expiring.length ? <div className="note warn small">{t("ct_guarantees_expiring").replace("{n}", String(expiring.length))}</div> : null}
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("ct_subject")}</th><th>{t("supplier")}</th><th className="num">{t("ct_current_amount")}</th><th>{t("ct_end")}</th><th className="num">{t("ct_amendments")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{rows.map(({ c, partner }) => {
              const terms = currentTerms(c, amendments.filter((a) => a.contractId === c.id));
              return (
                <tr key={c.id}>
                  <td><Link className="rowlink" href={`/contracts/${c.id}`}><code className="k">{c.number}</code></Link></td>
                  <td><Link className="rowlink" href={`/contracts/${c.id}`}>{c.title}</Link></td>
                  <td>{partner}</td>
                  <td className="num">{money(terms.amount, 2)}</td>
                  <td>{terms.endDate}</td>
                  <td className="num">{terms.approved}</td>
                  <td><Pill kind={c.status}>{t(`cs_${c.status}`)}</Pill></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
