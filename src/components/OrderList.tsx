import Link from "next/link";
import { desc, eq, and, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { orderProgress, statusOf } from "@/lib/purchase-orders";
import { round2 } from "@/lib/format";
import { Empty, Pill } from "./ui";

const PILL = { draft: "draft", issued: "open", partly_billed: "partial", billed: "paid", closed: "paid", cancelled: "void" } as const;

/** The purchase orders with what has been billed. Accounting sees the issued ones, each leading to where its bills are received. */
export async function OrderList({ ctx, base, issuedOnly }: { ctx: Ctx; base: string; issuedOnly?: boolean }) {
  const { t, money } = await getI18n();
  const db = await getDb();
  const po = schema.purchaseOrders;
  const rows = await db.select({ o: po, vendor: schema.partners.name, project: schema.projects.code, projectName: schema.projects.name }).from(po)
    .innerJoin(schema.partners, eq(schema.partners.id, po.partnerId)).innerJoin(schema.projects, eq(schema.projects.id, po.projectId))
    .where(and(eq(po.companyId, ctx.company.id), ...(issuedOnly ? [inArray(po.status, ["issued", "closed"] as ("issued" | "closed")[])] : [])))
    .orderBy(desc(po.date), desc(po.number)).limit(500);
  const progress = await orderProgress(db, rows.map((r) => r.o.id));
  if (!rows.length) return <Empty>{t("nothing_yet")}</Empty>;
  return (
    <div className="tbl-wrap"><table>
      <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t("supplier")}</th><th>{t("po_project_short")}</th><th className="num">{t("subtotal")}</th><th className="num">{t("po_billed")}</th><th className="num">{t("po_remaining")}</th><th>{t("status")}</th></tr></thead>
      <tbody>{rows.map(({ o, vendor, project, projectName }) => {
        const billed = progress.get(o.id)?.billed ?? 0;
        const status = statusOf(o, billed);
        return (
          <tr key={o.id}>
            <td><Link className="rowlink" href={`${base}/${o.id}`}><code className="k">{o.number}</code></Link></td>
            <td style={{ whiteSpace: "nowrap" }}>{o.date}</td><td>{vendor}</td><td title={projectName}><code className="k">{project}</code></td>
            <td className="num">{money(o.subtotal, 2)}</td><td className="num">{money(billed, 2)}</td><td className="num">{money(o.status === "issued" ? round2(o.subtotal - billed) : 0, 2)}</td>
            <td><Pill kind={PILL[status]}>{t(`po_st_${status}`)}</Pill></td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}
