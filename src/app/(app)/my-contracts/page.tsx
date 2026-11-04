import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { myPartners } from "@/lib/bidding";
import { currentTerms } from "@/lib/procurement";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Contracts won" };

export default async function MyContractsPage() {
  const ctx = await requireView("bidding");
  const { t, money } = await getI18n();
  const db = await getDb();
  const partners = await myPartners(db, ctx.company.id);
  const rows = partners.length ? await db.select({ c: schema.contracts, buyer: schema.companies.name }).from(schema.contracts)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.contracts.companyId))
    .where(inArray(schema.contracts.partnerId, partners.map((p) => p.id))).orderBy(desc(schema.contracts.createdAt)) : [];
  const amendments = rows.length ? await db.select().from(schema.contractAmendments).where(inArray(schema.contractAmendments.contractId, rows.map((r) => r.c.id))) : [];
  return (
    <div className="stack">
      <PageHead title={t("nav_my_contracts")} />
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("ct_subject")}</th><th>{t("adv_buyer")}</th><th className="num">{t("ct_current_amount")}</th><th>{t("ct_end")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{rows.map(({ c, buyer }) => {
              const terms = currentTerms(c, amendments.filter((a) => a.contractId === c.id));
              return (
                <tr key={c.id}>
                  <td><Link className="rowlink" href={`/my-contracts/${c.id}`}><code className="k">{c.number}</code></Link></td>
                  <td><Link className="rowlink" href={`/my-contracts/${c.id}`}>{c.title}</Link></td>
                  <td>{buyer}</td>
                  <td className="num">{money(terms.amount, 2)}</td><td>{terms.endDate}</td>
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
