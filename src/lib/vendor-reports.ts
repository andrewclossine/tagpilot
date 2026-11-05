import "server-only";
import { and, asc, eq, inArray, lte, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addDays, daysBetween, round2 } from "./format";
import type { Key, T } from "./i18n";
import { balances, listAccounts } from "./ledger";
import type { Column, Report, Row } from "./financial-reports";
import { orderProgress } from "./purchase-orders";

export const VENDOR_TITLES = {
  ap: "r_ap", "ap-aging-detail": "r_ap_aging_detail", "ap-balance-summary": "r_ap_balance_summary", "ap-balance-detail": "r_ap_balance_detail", "ap-unpaid": "r_ap_unpaid", vendors: "r_vendors", "po-open": "r_po_open",
} as const satisfies Record<string, Key>;
export type VendorKind = keyof typeof VENDOR_TITLES;
export const isVendorKind = (k: string): k is VendorKind => k in VENDOR_TITLES;

const BUCKETS = ["aging_current", "aging_30", "aging_60", "aging_90", "aging_over"] as const;
const bucketOf = (due: string, on: string) => { const d = daysBetween(due, on); return d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4; };

/** Every approved bill up to a date, with what was still owed on that date: a payment made later does not count yet. */
async function billsAsAt(companyId: string, on: string) {
  const db = await getDb();
  const rows = await db.select({ b: schema.bills, vendor: schema.partners.name }).from(schema.bills)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.bills.partnerId))
    .where(and(eq(schema.bills.companyId, companyId), ne(schema.bills.status, "draft"), ne(schema.bills.status, "void"), lte(schema.bills.date, on)))
    .orderBy(asc(schema.bills.dueDate), asc(schema.bills.number));
  const ids = rows.map((r) => r.b.id);
  const pays = ids.length ? await db.select({ billId: schema.payments.billId, amount: schema.payments.amount }).from(schema.payments)
    .where(and(inArray(schema.payments.billId, ids), lte(schema.payments.date, on))) : [];
  const paid = new Map<string, number>();
  for (const p of pays) if (p.billId) paid.set(p.billId, round2((paid.get(p.billId) ?? 0) + p.amount));
  return rows.map(({ b, vendor }) => ({ id: b.id, number: b.number, date: b.date, dueDate: b.dueDate, partnerId: b.partnerId, vendor, notes: b.notes, total: b.total, paid: paid.get(b.id) ?? 0, balance: round2(b.total - (paid.get(b.id) ?? 0)) }));
}

export async function buildVendorReport(kind: VendorKind, o: { companyId: string; apAccount: string; from: string; to: string; t: T }): Promise<Report> {
  const { companyId, from, to, t } = o;
  const db = await getDb();
  const asAt = `${t("as_at")} ${to}`, period = `${from} → ${to}`;
  const money = (l: string): Column => ({ label: l, type: "money" });
  const text = (l: string): Column => ({ label: l, type: "text" });
  const billLink = (id: string) => `/purchases/bills/${id}`;
  const head = (title: string): Row => ({ style: "head", cells: [title] });
  const vendorsOf = <X extends { vendor: string }>(list: X[]) => [...new Set(list.map((x) => x.vendor))].sort((a, b) => a.localeCompare(b));
  const add = (list: { balance: number }[]) => round2(list.reduce((s, x) => s + x.balance, 0));

  /** Shown only if the ledger's payables account and the unpaid bills disagree, for example after a manual journal entry. */
  const ledgerCheck = async (owed: number, blanks: number): Promise<Row[]> => {
    const accounts = await listAccounts(db, companyId);
    const account = accounts.find((a) => a.code === o.apAccount);
    if (!account) return [];
    const inLedger = round2(-((await balances(db, companyId, { to })).get(account.id)?.net ?? 0));
    const diff = round2(inLedger - owed);
    return diff ? [{ style: "sub", cells: [`${t("r_ap_ledger_diff")} ${account.code}`, ...Array<null>(blanks).fill(null), diff] }] : [];
  };

  if (kind === "vendors") {
    const [partners, bills] = await Promise.all([
      db.select().from(schema.partners).where(and(eq(schema.partners.companyId, companyId), inArray(schema.partners.kind, ["supplier", "both"]))).orderBy(schema.partners.name),
      billsAsAt(companyId, to),
    ]);
    return {
      period: asAt,
      columns: [text(t("supplier")), text(t("tin")), text(t("phone")), text(t("email")), text(t("address")), money(t("balance"))],
      rows: partners.length ? [
        ...partners.map((p): Row => ({ style: "line", cells: [p.name, p.tin, p.phone, p.email, p.address, add(bills.filter((b) => b.partnerId === p.id))] })),
        { style: "total", cells: [t("total"), null, null, null, null, add(bills)] },
      ] : [],
    };
  }

  if (kind === "po-open") {
    const rows = await db.select({ o: schema.purchaseOrders, vendor: schema.partners.name, code: schema.projects.code, name: schema.projects.name }).from(schema.purchaseOrders)
      .innerJoin(schema.partners, eq(schema.partners.id, schema.purchaseOrders.partnerId)).innerJoin(schema.projects, eq(schema.projects.id, schema.purchaseOrders.projectId))
      .where(and(eq(schema.purchaseOrders.companyId, companyId), eq(schema.purchaseOrders.status, "issued"), lte(schema.purchaseOrders.date, to)))
      .orderBy(asc(schema.projects.code), asc(schema.purchaseOrders.number));
    const progress = await orderProgress(db, rows.map((r) => r.o.id));
    const open = rows.map((r) => { const billed = progress.get(r.o.id)?.billed ?? 0; return { ...r, billed, left: round2(r.o.subtotal - billed) }; }).filter((r) => r.left > 0.004);
    const projects = [...new Set(open.map((r) => r.code))];
    const tot = (list: typeof open, f: (r: (typeof open)[number]) => number) => round2(list.reduce((s, r) => s + f(r), 0));
    return {
      period: asAt, note: t("r_po_open_note"),
      columns: [text(t("number")), text(t("date")), text(t("supplier")), money(t("subtotal")), money(t("po_billed")), money(t("po_remaining"))],
      rows: open.length ? [
        ...projects.flatMap((code): Row[] => {
          const mine = open.filter((r) => r.code === code);
          return [
            head(`${code} · ${mine[0].name}`),
            ...mine.map((r): Row => ({ style: "line", cells: [r.o.number, r.o.date, r.vendor, r.o.subtotal, r.billed, r.left], links: { 0: `/purchases/orders/${r.o.id}` } })),
            { style: "sub", cells: [`${t("total")} ${code}`, null, null, tot(mine, (r) => r.o.subtotal), tot(mine, (r) => r.billed), tot(mine, (r) => r.left)] },
          ];
        }),
        { style: "total", cells: [t("total"), null, null, tot(open, (r) => r.o.subtotal), tot(open, (r) => r.billed), tot(open, (r) => r.left)] },
      ] : [],
    };
  }

  const bills = await billsAsAt(companyId, to);
  const unpaid = bills.filter((b) => b.balance > 0.004);
  const owed = add(unpaid);

  switch (kind) {
    case "ap": {
      const rows = vendorsOf(unpaid).map((vendor): Row => {
        const mine = unpaid.filter((b) => b.vendor === vendor);
        const by = BUCKETS.map((_, i) => add(mine.filter((b) => bucketOf(b.dueDate, to) === i)));
        return { style: "line", cells: [vendor, ...by.map((v) => v || null), add(mine)] };
      });
      const totals = BUCKETS.map((_, i) => add(unpaid.filter((b) => bucketOf(b.dueDate, to) === i)));
      return {
        period: asAt,
        columns: [text(t("supplier")), ...BUCKETS.map((b) => money(t(b))), money(t("total"))],
        rows: rows.length ? [...rows, { style: "total", cells: [t("total"), ...totals, owed] }, ...(await ledgerCheck(owed, 5))] : [],
      };
    }
    case "ap-aging-detail": {
      return {
        period: asAt,
        columns: [text(t("date")), text(t("number")), text(t("supplier")), text(t("due_date")), text(t("r_days_late")), money(t("total")), money(t("balance"))],
        rows: unpaid.length ? [
          ...BUCKETS.flatMap((bucket, i): Row[] => {
            const mine = unpaid.filter((b) => bucketOf(b.dueDate, to) === i);
            return mine.length ? [
              head(t(bucket)),
              ...mine.map((b): Row => ({ style: "line", cells: [b.date, b.number, b.vendor, b.dueDate, Math.max(0, daysBetween(b.dueDate, to)), b.total, b.balance], links: { 1: billLink(b.id) } })),
              { style: "sub", cells: [`${t("total")} ${t(bucket)}`, null, null, null, null, null, add(mine)] },
            ] : [];
          }),
          { style: "total", cells: [t("total"), null, null, null, null, null, owed] },
        ] : [],
      };
    }
    case "ap-balance-summary": {
      return {
        period: asAt,
        columns: [text(t("supplier")), money(t("balance"))],
        rows: unpaid.length ? [
          ...vendorsOf(unpaid).map((vendor): Row => ({ style: "line", cells: [vendor, add(unpaid.filter((b) => b.vendor === vendor))] })),
          { style: "total", cells: [t("total"), owed] },
          ...(await ledgerCheck(owed, 0)),
        ] : [],
      };
    }
    case "ap-balance-detail": {
      const opening = await billsAsAt(companyId, addDays(from, -1));
      const inPeriod = bills.filter((b) => b.date >= from);
      const ids = bills.map((b) => b.id);
      const pays = ids.length ? await db.select().from(schema.payments).where(and(inArray(schema.payments.billId, ids), lte(schema.payments.date, to))).orderBy(asc(schema.payments.date)) : [];
      const billOf = new Map(bills.map((b) => [b.id, b]));
      type Move = { date: string; type: string; number: string; id: string; memo: string; amount: number };
      const names = vendorsOf([...inPeriod, ...opening.filter((b) => b.balance > 0.004), ...pays.filter((p) => p.date >= from).map((p) => ({ vendor: billOf.get(p.billId!)?.vendor ?? "" }))]);
      let closingAll = 0;
      const rows = names.flatMap((vendor): Row[] => {
        const start = add(opening.filter((b) => b.vendor === vendor));
        const moves: Move[] = [
          ...inPeriod.filter((b) => b.vendor === vendor).map((b): Move => ({ date: b.date, type: t("r_bill"), number: b.number, id: b.id, memo: b.notes, amount: b.total })),
          ...pays.filter((p) => p.date >= from && billOf.get(p.billId!)?.vendor === vendor).map((p): Move => ({ date: p.date, type: t("r_payment"), number: billOf.get(p.billId!)!.number, id: p.billId!, memo: p.reference, amount: -p.amount })),
        ].sort((a, b) => a.date.localeCompare(b.date));
        let run = start;
        const body = moves.map((m): Row => { run = round2(run + m.amount); return { style: "line", cells: [m.date, m.type, m.number, m.memo, m.amount, run], links: { 2: billLink(m.id) } }; });
        closingAll = round2(closingAll + run);
        return [head(vendor), { style: "line", cells: [t("opening"), null, null, null, null, start] }, ...body, { style: "sub", cells: [t("closing"), null, null, null, null, run] }];
      });
      return {
        period,
        columns: [text(t("date")), text(t("r_txn_type")), text(t("number")), text(t("memo")), money(t("amount")), money(t("balance"))],
        rows: rows.length ? [...rows, { style: "total", cells: [t("total"), null, null, null, null, closingAll] }] : [],
      };
    }
    case "ap-unpaid": {
      return {
        period: asAt,
        columns: [text(t("date")), text(t("number")), text(t("due_date")), text(t("r_days_late")), money(t("total")), money(t("r_paid_so_far")), money(t("balance"))],
        rows: unpaid.length ? [
          ...vendorsOf(unpaid).flatMap((vendor): Row[] => {
            const mine = unpaid.filter((b) => b.vendor === vendor);
            return [
              head(vendor),
              ...mine.map((b): Row => ({ style: "line", cells: [b.date, b.number, b.dueDate, Math.max(0, daysBetween(b.dueDate, to)), b.total, b.paid, b.balance], links: { 1: billLink(b.id) } })),
              { style: "sub", cells: [`${t("total")} ${vendor}`, null, null, null, null, null, add(mine)] },
            ];
          }),
          { style: "total", cells: [t("total"), null, null, null, null, null, owed] },
        ] : [],
      };
    }
  }
}
