import "server-only";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Ctx } from "./auth";
import { round2, today } from "./format";
import { orderProgress, receivedByLine, statusOf } from "./purchase-orders";
import { awaitingMe } from "./requisitions";
import { evaluationTasks } from "./committee";

const days = (a: Date | string, b: Date | string) => (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
const avg = (xs: number[]) => (xs.length ? round2(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const countBy = <T extends string>(rows: { k: T }[]) => rows.reduce((m, r) => m.set(r.k, (m.get(r.k) ?? 0) + 1), new Map<T, number>());

/** Everything the procurement dashboard shows, for one organisation and year. */
export async function procurementDashboard(db: Db, ctx: Ctx, year: number) {
  const companyId = ctx.company.id, from = `${year}-01-01`, to = `${year}-12-31`;
  const [reqs, tenders, orders, mine, tasks] = await Promise.all([
    db.select().from(schema.requisitions).where(eq(schema.requisitions.companyId, companyId)),
    db.select().from(schema.tenders).where(eq(schema.tenders.companyId, companyId)),
    db.select({ o: schema.purchaseOrders, vendor: schema.partners.name }).from(schema.purchaseOrders)
      .innerJoin(schema.partners, eq(schema.partners.id, schema.purchaseOrders.partnerId)).where(eq(schema.purchaseOrders.companyId, companyId)),
    awaitingMe(db, ctx), evaluationTasks(db, ctx),
  ]);
  const progress = await orderProgress(db, orders.map((x) => x.o.id));
  const poStatus = orders.map(({ o }) => ({ k: statusOf(o, progress.get(o.id)?.billed ?? 0) }));

  // Spend: bills raised from purchase orders this year, by month and by supplier. Voided bills do not count.
  const spendRows = await db.select({ date: schema.bills.date, subtotal: schema.bills.subtotal, partnerId: schema.bills.partnerId })
    .from(schema.bills).where(and(eq(schema.bills.companyId, companyId), isNotNull(schema.bills.purchaseOrderId), ne(schema.bills.status, "void"),
      sql`${schema.bills.date} between ${from} and ${to}`));
  const byMonth = Array.from({ length: 12 }, () => 0);
  const bySupplier = new Map<string, number>();
  for (const r of spendRows) {
    byMonth[Number(r.date.slice(5, 7)) - 1] += r.subtotal;
    bySupplier.set(r.partnerId, (bySupplier.get(r.partnerId) ?? 0) + r.subtotal);
  }
  const names = bySupplier.size ? await db.select({ id: schema.partners.id, name: schema.partners.name }).from(schema.partners).where(inArray(schema.partners.id, [...bySupplier.keys()])) : [];
  const topSuppliers = [...bySupplier.entries()].map(([id, amount]) => ({ name: names.find((n) => n.id === id)?.name ?? "", amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount).slice(0, 6);
  const committed = round2(orders.filter(({ o }) => o.status === "issued" && o.date >= from && o.date <= to).reduce((s, { o }) => s + o.subtotal, 0));

  // How long things take: approval of requisitions, and from publishing a request to the award notice.
  const steps = reqs.length ? await db.select().from(schema.requisitionSteps).where(inArray(schema.requisitionSteps.requisitionId, reqs.map((r) => r.id))) : [];
  const approvalDays = avg(reqs.filter((r) => r.submittedAt && ["approved", "converted"].includes(r.status)).flatMap((r) => {
    const last = steps.filter((s) => s.requisitionId === r.id && s.decidedAt).map((s) => s.decidedAt!.getTime());
    return last.length ? [days(r.submittedAt!, new Date(Math.max(...last)))] : [];
  }));
  const provisional = tenders.length ? await db.select({ tenderId: schema.tenderStages.tenderId, date: schema.tenderStages.date }).from(schema.tenderStages)
    .where(and(inArray(schema.tenderStages.tenderId, tenders.map((x) => x.id)), eq(schema.tenderStages.stage, "provisional"))) : [];
  const awardDays = avg(provisional.flatMap((p) => {
    const t = tenders.find((x) => x.id === p.tenderId);
    return t?.publishedAt ? [Math.max(0, days(t.publishedAt, p.date))] : [];
  }));

  // Deliveries late: issued orders past their expected date with something still to receive.
  const late = orders.filter(({ o }) => o.status === "issued" && o.expectedDate && o.expectedDate < today());
  const lateLines = late.length ? await db.select().from(schema.purchaseOrderLines).where(inArray(schema.purchaseOrderLines.orderId, late.map((x) => x.o.id))) : [];
  const got = await receivedByLine(db, late.map((x) => x.o.id));
  const overdue = late.filter(({ o }) => lateLines.some((l) => l.orderId === o.id && (got.get(l.id)?.accepted ?? 0) < l.quantity - 0.0005))
    .map(({ o, vendor }) => ({ id: o.id, number: o.number, vendor, expected: o.expectedDate!, total: o.total }));

  return {
    kpi: {
      waitingApproval: reqs.filter((r) => r.status === "submitted").length,
      forMe: mine.length + tasks.length,
      activeRequests: tenders.filter((x) => x.status === "published").length,
      openOrders: poStatus.filter((s) => s.k === "issued" || s.k === "partly_billed").length,
      spend: round2(byMonth.reduce((s, x) => s + x, 0)),
      committed,
    },
    requisitions: countBy(reqs.map((r) => ({ k: r.status }))),
    tenders: countBy(tenders.map((x) => ({ k: x.status }))),
    orders: countBy(poStatus),
    byMonth: byMonth.map(round2), topSuppliers, approvalDays, awardDays, overdue,
  };
}
