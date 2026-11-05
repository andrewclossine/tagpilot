import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import type { VoucherStatus } from "@/db/schema";
import { Empty, PageHead, Pill, Tabs } from "@/components/ui";

export const metadata = { title: "Fund requests" };

const STATUSES: VoucherStatus[] = ["draft", "submitted", "reviewed", "approved", "authorized", "paid", "rejected"];

/** The fund request register: one row per request, with its signature stage, payment and documents. */
export default async function VouchersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("vouchers");
  const { t, money } = await getI18n();
  const q = await sp(searchParams);
  const status = STATUSES.find((s) => s === q("status"));
  const db = await getDb();
  const conds = [eq(schema.paymentVouchers.companyId, ctx.company.id)];
  if (status) conds.push(eq(schema.paymentVouchers.status, status));
  if (isUuid(q("project"))) conds.push(eq(schema.paymentVouchers.projectId, q("project")));
  if (isUuid(q("line"))) conds.push(sql`exists (select 1 from voucher_lines vl where vl.voucher_id = ${schema.paymentVouchers.id} and vl.budget_item_id = ${q("line")})`);
  if (ctx.role === "staff") conds.push(eq(schema.paymentVouchers.requestedBy, ctx.user.id));
  const rows = await db.select({ v: schema.paymentVouchers, project: schema.projects.code, who: schema.users.name }).from(schema.paymentVouchers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.paymentVouchers.projectId))
    .innerJoin(schema.users, eq(schema.users.id, schema.paymentVouchers.requestedBy))
    .where(and(...conds)).orderBy(desc(schema.paymentVouchers.date), desc(schema.paymentVouchers.createdAt)).limit(500);
  const ids = rows.map((r) => r.v.id);
  const [lines, docs] = ids.length ? await Promise.all([
    db.select({ voucherId: schema.voucherLines.voucherId, code: schema.logframeItems.taskCode }).from(schema.voucherLines)
      .innerJoin(schema.logframeItems, eq(schema.logframeItems.id, schema.voucherLines.budgetItemId)).where(inArray(schema.voucherLines.voucherId, ids)),
    db.select().from(schema.voucherDocuments).where(inArray(schema.voucherDocuments.voucherId, ids)),
  ]) : [[], []];
  const counted = (id: string) => {
    const mine = docs.filter((d) => d.voucherId === id);
    return { done: mine.filter((d) => d.status === "submitted").length, waiting: mine.filter((d) => d.status === "pending").length };
  };
  const total = rows.filter((r) => r.v.status !== "rejected" && r.v.status !== "draft").reduce((s, r) => s + r.v.amount, 0);
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
            <thead><tr><th>{t("pv_fr_no")}</th><th>{t("date")}</th><th>TSK</th><th>{t("pv_description")}</th><th>{t("pv_payee")}</th><th>{t("pv_requested_by")}</th><th className="num">{t("amount")}</th><th>{t("status")}</th><th>{t("pv_cheque")}</th><th>{t("pv_documents")}</th></tr></thead>
            <tbody>
              {rows.map(({ v, who }) => {
                const d = counted(v.id);
                return (
                  <tr key={v.id}>
                    <td><Link className="rowlink" href={`/vouchers/${v.id}`}><code className="k">{v.number}</code></Link></td>
                    <td style={{ whiteSpace: "nowrap" }}>{v.date}</td>
                    <td className="small">{[...new Set(lines.filter((l) => l.voucherId === v.id).map((l) => l.code))].join(", ")}</td>
                    <td>{v.description.slice(0, 90)}</td><td>{v.payee}</td><td>{who}</td>
                    <td className="num">{money(v.amount)}</td>
                    <td><Pill kind={v.status}>{t(`vs_${v.status}`)}</Pill></td>
                    <td>{v.paymentReference}</td>
                    <td className="small">{d.done ? `${d.done} ✓` : ""}{d.waiting ? <span style={{ color: "var(--warn)" }}> {d.waiting} {t("pv_doc_pending").toLowerCase()}</span> : null}</td>
                  </tr>
                );
              })}
              <tr className="total"><td colSpan={6}>{t("total")}</td><td className="num">{money(total)}</td><td colSpan={3} /></tr>
            </tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
