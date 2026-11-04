import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSupplier } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { currentTerms } from "@/lib/procurement";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "My contracts" };

export default async function PortalContractsPage() {
  const ctx = await requireSupplier();
  const { t, money } = await getI18n();
  const db = await getDb();
  const rows = await db.select().from(schema.contracts).where(and(eq(schema.contracts.companyId, ctx.company.id), eq(schema.contracts.partnerId, ctx.partnerId))).orderBy(desc(schema.contracts.createdAt));
  const amendments = rows.length ? await db.select().from(schema.contractAmendments).where(inArray(schema.contractAmendments.contractId, rows.map((c) => c.id))) : [];
  return (
    <div className="stack">
      <PageHead title={t("nav_contracts")} />
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("ct_subject")}</th><th className="num">{t("ct_current_amount")}</th><th>{t("ct_end")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{rows.map((c) => {
              const terms = currentTerms(c, amendments.filter((a) => a.contractId === c.id));
              return (
                <tr key={c.id}>
                  <td><Link className="rowlink" href={`/portal/contracts/${c.id}`}><code className="k">{c.number}</code></Link></td>
                  <td><Link className="rowlink" href={`/portal/contracts/${c.id}`}>{c.title}</Link></td>
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
