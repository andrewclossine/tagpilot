import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import type { VoucherStatus } from "@/db/schema";
import { Empty, PageHead, Pill, Tabs } from "@/components/ui";

export const metadata = { title: "Payment vouchers" };

const STATUSES: VoucherStatus[] = ["draft", "submitted", "approved", "paid", "rejected"];

export default async function VouchersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("vouchers");
  const { t, money } = await getI18n();
  const q = await sp(searchParams);
  const status = STATUSES.find((s) => s === q("status"));
  const db = await getDb();
  const conds = [eq(schema.paymentVouchers.companyId, ctx.company.id)];
  if (status) conds.push(eq(schema.paymentVouchers.status, status));
  if (isUuid(q("line"))) conds.push(eq(schema.paymentVouchers.budgetItemId, q("line")));
  if (ctx.role === "staff") conds.push(eq(schema.paymentVouchers.requestedBy, ctx.user.id));
  const rows = await db.select({ v: schema.paymentVouchers, project: schema.projects.code, code: schema.logframeItems.code, line: schema.logframeItems.title, who: schema.users.name })
    .from(schema.paymentVouchers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.paymentVouchers.projectId))
    .innerJoin(schema.logframeItems, eq(schema.logframeItems.id, schema.paymentVouchers.budgetItemId))
    .innerJoin(schema.users, eq(schema.users.id, schema.paymentVouchers.requestedBy))
    .where(and(...conds)).orderBy(desc(schema.paymentVouchers.date), desc(schema.paymentVouchers.number)).limit(300);
  return (
    <div className="stack">
      <PageHead title={t("pv_title")}>
        {ctx.can("vouchers", "write") ? <Link className="btn primary" href="/vouchers/new">{t("pv_new")}</Link> : null}
      </PageHead>
      <Tabs current={status ?? "all"} items={[
        { key: "all", href: "/vouchers", label: t("all") },
        ...STATUSES.map((s) => ({ key: s, href: `/vouchers?status=${s}`, label: t(`vs_${s}`) })),
      ]} />
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t("project")}</th><th>{t("pv_budget_line")}</th><th>{t("pv_requested_by")}</th><th className="num">{t("amount")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{rows.map(({ v, project, code, line, who }) => (
              <tr key={v.id}>
                <td><Link className="rowlink" href={`/vouchers/${v.id}`}><code className="k">{v.number}</code></Link></td>
                <td>{v.date}</td><td><code className="k">{project}</code></td>
                <td><code className="k">{code}</code> {line}</td><td>{who}</td>
                <td className="num">{money(v.amount)}</td>
                <td><Pill kind={v.status}>{t(`vs_${v.status}`)}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
