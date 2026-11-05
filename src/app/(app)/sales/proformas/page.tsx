import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Proforma invoices" };

export default async function ProformasPage() {
  const ctx = await requireView("sales");
  const { t, money } = await getI18n();
  const db = await getDb();
  const rows = await db.select({ p: schema.proformas, customer: schema.partners.name }).from(schema.proformas)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.proformas.partnerId))
    .where(eq(schema.proformas.companyId, ctx.company.id)).orderBy(desc(schema.proformas.date), desc(schema.proformas.number)).limit(300);
  return (
    <div className="stack">
      <PageHead title={t("pf_title")}>
        {ctx.can("sales", "write") ? <Link className="btn primary" href="/sales/proformas/new">{t("pf_new")}</Link> : null}
      </PageHead>
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t("customer")}</th><th>{t("pf_valid_until")}</th><th className="num">{t("total")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{rows.map(({ p, customer }) => (
              <tr key={p.id}>
                <td><Link className="rowlink" href={`/sales/proformas/${p.id}`}><code className="k">{p.number}</code></Link></td>
                <td>{p.date}</td><td>{customer}</td><td>{p.validUntil}</td><td className="num">{money(p.total, 2)}</td>
                <td><Pill kind={p.status === "open" ? "open" : p.status === "converted" ? "paid" : "void"}>{t(`pf_${p.status}`)}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
