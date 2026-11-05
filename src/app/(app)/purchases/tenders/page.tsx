import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { round2 } from "@/lib/format";
import { currentTerms } from "@/lib/procurement";
import type { TenderStatus } from "@/db/schema";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Tenders awarded" };

const AWARDED: TenderStatus[] = ["final", "negotiation", "negotiated", "draft_contract", "signed"];

/** For the accounts team: what has been awarded, to whom and for how much, without opening Procurement. */
export default async function TenderReportPage() {
  const ctx = await requireView("purchases");
  const { t, money } = await getI18n();
  const db = await getDb();
  const rows = await db.select({ x: schema.tenders, bid: schema.bids, supplier: schema.partners.name }).from(schema.tenders)
    .innerJoin(schema.bids, and(eq(schema.bids.tenderId, schema.tenders.id), eq(schema.bids.isWinner, true)))
    .innerJoin(schema.partners, eq(schema.partners.id, schema.bids.partnerId))
    .where(and(eq(schema.tenders.companyId, ctx.company.id), inArray(schema.tenders.status, AWARDED))).orderBy(desc(schema.tenders.createdAt)).limit(500);
  const ids = rows.map((r) => r.x.id);
  const [contracts, finals] = ids.length ? await Promise.all([
    db.select().from(schema.contracts).where(inArray(schema.contracts.tenderId, ids)),
    db.select().from(schema.tenderStages).where(and(inArray(schema.tenderStages.tenderId, ids), eq(schema.tenderStages.stage, "final"))),
  ]) : [[], []];
  const amendments = contracts.length ? await db.select().from(schema.contractAmendments).where(inArray(schema.contractAmendments.contractId, contracts.map((c) => c.id))) : [];
  const valueOf = (tenderId: string, bidAmount: number) => {
    const c = contracts.find((k) => k.tenderId === tenderId);
    return c ? currentTerms(c, amendments.filter((a) => a.contractId === c.id)).amount : bidAmount;
  };
  const total = round2(rows.reduce((s, r) => s + valueOf(r.x.id, r.bid.amount), 0));
  return (
    <div className="stack">
      <PageHead title={t("nav_tender_report")} />
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("type")}</th><th>{t("tn_subject")}</th><th>{t("supplier")}</th><th>{t("tr_awarded_on")}</th><th>{t("nav_contracts")}</th><th className="num">{t("tr_value")}</th><th>{t("status")}</th></tr></thead>
            <tbody>
              {rows.map(({ x, bid, supplier }) => {
                const c = contracts.find((k) => k.tenderId === x.id);
                return (
                  <tr key={x.id}>
                    <td><code className="k">{x.number}</code></td>
                    <td>{t(x.kind === "rfq" ? "tn_rfq" : "tn_tender")}</td>
                    <td>{x.title}</td><td>{supplier}</td>
                    <td>{finals.find((f) => f.tenderId === x.id)?.date ?? ""}</td>
                    <td>{c ? (ctx.can("contracts") ? <Link href={`/contracts/${c.id}`}>{c.number}</Link> : c.number) : ""}</td>
                    <td className="num">{money(valueOf(x.id, bid.amount), 2)}</td>
                    <td><Pill kind={x.status}>{t(`ts_${x.status}`)}</Pill></td>
                  </tr>
                );
              })}
              <tr className="total"><td colSpan={6}>{t("total")}</td><td className="num">{money(total, 2)}</td><td /></tr>
            </tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
