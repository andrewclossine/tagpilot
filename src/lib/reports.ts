import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { balances, listAccounts } from "./ledger";
import { addDays, round2 } from "./format";
import type { Key, T } from "./i18n";
import { buildFinancialReport, FINANCIAL_KINDS, FINANCIAL_TITLES, isFinancialKind, ledgerLines, natural, type Column, type Report, type Row } from "./financial-reports";
import { buildVendorReport, isVendorKind, VENDOR_TITLES, type VendorKind } from "./vendor-reports";
import { EXPENSE_TAX_LINES, INCOME_TAX_LINES, taxLineKey, taxLineOf, type TaxLine } from "./tax-lines";

const LEDGER_TITLES = {
  "tax-prep": "r_tax_prep", "tax-summary": "r_tax_summary", "tax-detail": "r_tax_detail",
  tb: "r_tb", gl: "r_gl", "txn-account": "r_txn_account", adjusting: "r_adjusting", journal: "r_journal", audit: "r_audit",
  "ignored-summary": "r_ignored_summary", "ignored-detail": "r_ignored_detail",
} as const satisfies Record<string, Key>;

export const REPORT_TITLES: Record<string, Key> = { ...FINANCIAL_TITLES, ...LEDGER_TITLES, ...VENDOR_TITLES };
export type ReportKind = (typeof FINANCIAL_KINDS)[number] | keyof typeof LEDGER_TITLES | VendorKind;
export const isReportKind = (k: string): k is ReportKind => k in REPORT_TITLES;

/** The area a person needs to open a report. */
export const reportArea = (k: ReportKind) => (k === "audit" ? ("audit" as const) : isVendorKind(k) ? ("purchases" as const) : ("reports" as const));

type Options = { companyId: string; apAccount: string; from: string; to: string; account?: string; t: T; accName: (a: { nameEn: string; nameFr: string }) => string };

export async function buildReport(kind: ReportKind, o: Options): Promise<Report> {
  if (isFinancialKind(kind)) return buildFinancialReport(kind, o.companyId, o.from, o.to, o.t, o.accName);
  if (isVendorKind(kind)) return buildVendorReport(kind, o);
  const { companyId, from, to, t, accName } = o;
  const db = await getDb();
  const accounts = await listAccounts(db, companyId);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  type Account = (typeof accounts)[number];
  const label = (a: Account) => `${a.code} ${accName(a)}`;
  const gl = (a: Account) => `/reports/gl?from=${from}&to=${to}&account=${a.id}`;
  const journal = (id: string) => `/journal/${id}`;
  const period = `${from} → ${to}`;
  const money = (l: string): Column => ({ label: l, type: "money" });
  const text = (l: string): Column => ({ label: l, type: "text" });
  const head = (title: string): Row => ({ style: "head", cells: [title] });

  switch (kind) {
    case "tax-prep":
    case "tax-summary":
    case "tax-detail": {
      const note = t("r_tax_note");
      const results = accounts.filter((a) => a.type === "income" || a.type === "expense");
      if (kind === "tax-prep") {
        const m = await balances(db, companyId, { from, to });
        return {
          period, note,
          columns: [text(t("account")), text(t("r_tax_line")), money(t("amount"))],
          rows: results.map((a): Row => ({ style: "line", cells: [label(a), t(taxLineKey(taxLineOf(a))), natural(a, m.get(a.id)?.net ?? 0)], links: { 0: gl(a) } })),
        };
      }
      if (kind === "tax-summary") {
        const m = await balances(db, companyId, { from, to });
        const lineTotal = (l: TaxLine) => round2(results.filter((a) => taxLineOf(a) === l).reduce((s, a) => s + natural(a, m.get(a.id)?.net ?? 0), 0));
        const taxableIncome = INCOME_TAX_LINES.filter((l) => l !== "exempt");
        const deductible = EXPENSE_TAX_LINES.filter((l) => l !== "non_deductible");
        const lines = (list: readonly TaxLine[]) => list.flatMap((l): Row[] => { const v = lineTotal(l); return v ? [{ style: "line", indent: true, cells: [t(taxLineKey(l)), v] }] : []; });
        const add = (list: readonly TaxLine[]) => round2(list.reduce((s, l) => s + lineTotal(l), 0));
        const income = add(taxableIncome), costs = add(deductible), exempt = lineTotal("exempt"), nonDeductible = lineTotal("non_deductible");
        const taxable = round2(income - costs);
        if (!income && !costs && !exempt && !nonDeductible) return { period, note, columns: [], rows: [] };
        return {
          period, note,
          columns: [text(t("r_tax_line")), money(t("amount"))],
          rows: [
            head(t("income")), ...lines(taxableIncome), { style: "sub", cells: [t("r_tax_total_income"), income] },
            head(t("r_tax_deductions")), ...lines(deductible), { style: "sub", cells: [t("r_tax_total_deductions"), costs] },
            { style: "total", cells: [t("r_tax_taxable_profit"), taxable] },
            head(t("r_tax_reconcile")),
            { style: "line", indent: true, cells: [t("r_tax_book_result"), round2(taxable + exempt - nonDeductible)] },
            { style: "line", indent: true, cells: [t("r_tax_add_non_deductible"), nonDeductible] },
            { style: "line", indent: true, cells: [t("r_tax_less_exempt"), -exempt] },
            { style: "total", cells: [t("r_tax_taxable_profit"), taxable] },
          ],
        };
      }
      const lines = await ledgerLines(db, companyId, from, to);
      const part = (list: readonly TaxLine[]) => list.flatMap((tl) => {
        const own = results.filter((a) => taxLineOf(a) === tl);
        const rows: Row[] = [];
        let total = 0;
        for (const a of own) {
          const moved = lines.filter((l) => l.accountId === a.id);
          for (const l of moved) {
            const amount = natural(a, l.debit - l.credit);
            total = round2(total + amount);
            rows.push({ style: "line", cells: [l.date, l.number, l.partner ?? "", l.memo, label(a), amount], links: { 1: journal(l.entryId) } });
          }
        }
        return rows.length ? [{ tl, total, rows: [head(t(taxLineKey(tl))), ...rows, { style: "sub" as const, cells: [`${t("total")} ${t(taxLineKey(tl))}`, null, null, null, null, total] }] }] : [];
      });
      const parts = [...part(INCOME_TAX_LINES), ...part(EXPENSE_TAX_LINES)];
      if (!parts.length) return { period, note, columns: [], rows: [] };
      const taxable = round2(parts.reduce((s, p) => s + (p.tl === "exempt" || p.tl === "non_deductible" ? 0 : (INCOME_TAX_LINES as readonly string[]).includes(p.tl) ? p.total : -p.total), 0));
      return {
        period, note,
        columns: [text(t("date")), text(t("number")), text(t("r_name")), text(t("memo")), text(t("account")), money(t("amount"))],
        rows: [...parts.flatMap((p) => p.rows), { style: "total", cells: [t("r_tax_taxable_profit"), null, null, null, null, taxable] }],
      };
    }

    case "tb": {
      const [open, move] = await Promise.all([balances(db, companyId, { to: addDays(from, -1) }), balances(db, companyId, { from, to })]);
      const totals = [0, 0, 0, 0, 0, 0];
      const rows = accounts.flatMap((a): Row[] => {
        const op = open.get(a.id)?.net ?? 0, d = move.get(a.id)?.debit ?? 0, c = move.get(a.id)?.credit ?? 0;
        if (!op && !d && !c) return [];
        const cl = round2(op + d - c);
        const v = [op > 0 ? op : 0, op < 0 ? -op : 0, d, c, cl > 0 ? cl : 0, cl < 0 ? -cl : 0].map(round2);
        v.forEach((x, i) => { totals[i] = round2(totals[i] + x); });
        return [{ style: "line", cells: [label(a), ...v.map((x) => x || null)], links: { 0: gl(a) } }];
      });
      return {
        period,
        columns: [text(t("account")), money(t("r_tb_open_dr")), money(t("r_tb_open_cr")), money(t("debit")), money(t("credit")), money(t("r_tb_close_dr")), money(t("r_tb_close_cr"))],
        rows: rows.length ? [...rows, { style: "total", cells: [t("total"), ...totals] }] : [],
      };
    }

    case "gl":
    case "txn-account": {
      const lines = await ledgerLines(db, companyId, from, to);
      const open = kind === "gl" ? await balances(db, companyId, { to: addDays(from, -1) }) : null;
      const chosen = byId.get(o.account ?? "");
      const list = chosen ? [chosen] : accounts;
      let dr = 0, cr = 0;
      const rows = list.flatMap((a): Row[] => {
        const own = lines.filter((l) => l.accountId === a.id);
        const opening = open ? natural(a, open.get(a.id)?.net ?? 0) : 0;
        if (!own.length && !opening) return [];
        let run = opening, d = 0, c = 0;
        const body = own.map((l): Row => {
          run = round2(run + natural(a, l.debit - l.credit)); d = round2(d + l.debit); c = round2(c + l.credit);
          const who = l.partner ?? "";
          return { style: "line", cells: kind === "gl"
            ? [l.date, l.number, who, l.memo, l.debit || null, l.credit || null, run]
            : [l.date, t(`src_${l.source}`), l.number, who, l.memo, l.debit || null, l.credit || null, run], links: { [kind === "gl" ? 1 : 2]: journal(l.entryId) } };
        });
        dr = round2(dr + d); cr = round2(cr + c);
        const pad = kind === "gl" ? [null, null, null] : [null, null, null, null];
        return [
          { style: "group", cells: [label(a)] },
          ...(kind === "gl" ? [{ style: "line" as const, cells: [t("opening"), null, null, null, null, null, opening] }] : []),
          ...body,
          { style: "sub", cells: [kind === "gl" ? t("closing") : `${t("total")} ${label(a)}`, ...pad, d, c, run] },
        ];
      });
      const pad = kind === "gl" ? [null, null, null] : [null, null, null, null];
      return {
        period,
        columns: kind === "gl"
          ? [text(t("date")), text(t("number")), text(t("r_name")), text(t("memo")), money(t("debit")), money(t("credit")), money(t("balance"))]
          : [text(t("date")), text(t("r_txn_type")), text(t("number")), text(t("r_name")), text(t("memo")), money(t("debit")), money(t("credit")), money(t("balance"))],
        rows: rows.length ? [...rows, { style: "total", cells: [t("total"), ...pad, dr, cr, null] }] : [],
      };
    }

    case "adjusting":
    case "journal": {
      const all = await ledgerLines(db, companyId, from, to);
      const lines = kind === "adjusting" ? all.filter((l) => l.isAdjusting) : all;
      let d = 0, c = 0, last = "";
      const rows = lines.map((l): Row => {
        const a = byId.get(l.accountId)!;
        const first = l.entryId !== last;
        last = l.entryId;
        d = round2(d + l.debit); c = round2(c + l.credit);
        return { style: "line", cells: [first ? l.date : "", first ? l.number : "", label(a), l.partner ?? "", first ? l.memo : "", l.debit || null, l.credit || null], links: first ? { 1: journal(l.entryId) } : undefined };
      });
      return {
        period, note: kind === "adjusting" ? t("r_adjusting_note") : undefined,
        columns: [text(t("date")), text(t("number")), text(t("account")), text(t("r_name")), text(t("memo")), money(t("debit")), money(t("credit"))],
        rows: rows.length ? [...rows, { style: "total", cells: [t("total"), null, null, null, null, d, c] }] : [],
      };
    }

    case "audit": {
      const rows = await db.select({ a: schema.auditLog, who: schema.users.name }).from(schema.auditLog)
        .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
        .where(and(eq(schema.auditLog.companyId, companyId), gte(schema.auditLog.at, new Date(`${from}T00:00:00Z`)), lte(schema.auditLog.at, new Date(`${to}T23:59:59.999Z`))))
        .orderBy(desc(schema.auditLog.at));
      return {
        period,
        columns: [text(t("audit_when")), text(t("audit_who")), text(t("audit_what")), text(t("description"))],
        rows: rows.map(({ a, who }): Row => ({ style: "line", cells: [
          a.at.toISOString().slice(0, 16).replace("T", " "), who ?? "—", `${a.action} · ${a.entity}`,
          a.details ? Object.entries(a.details).map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : "",
        ] })),
      };
    }

    case "ignored-summary":
    case "ignored-detail": {
      type Item = { type: Key; date: string; ref: string; text: string; who: string; amount: number; href?: string };
      const items: Item[] = [];
      // Who did it comes from the audit trail, which records every one of these actions.
      const trail = await db.select({ a: schema.auditLog, who: schema.users.name }).from(schema.auditLog)
        .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
        .where(and(eq(schema.auditLog.companyId, companyId), inArray(schema.auditLog.action, ["void", "ignore", "delete_draft", "delete", "cancel"])));
      const whoDid = (action: string, entity: string, id: string) => trail.find((r) => r.a.action === action && r.a.entity === entity && r.a.entityId === id)?.who ?? "";

      const je = schema.journalEntries;
      const reversed = await db.select().from(je).where(and(eq(je.companyId, companyId), eq(je.status, "posted"), isNotNull(je.reversedById), gte(je.date, from), lte(je.date, to))).orderBy(je.date);
      if (reversed.length) {
        const amounts = await db.select({ entryId: schema.journalLines.entryId, debit: schema.journalLines.debit }).from(schema.journalLines).where(inArray(schema.journalLines.entryId, reversed.map((e) => e.id)));
        const posters = await db.select({ id: je.id, who: schema.users.name }).from(je).leftJoin(schema.users, eq(schema.users.id, je.postedBy)).where(inArray(je.id, reversed.map((e) => e.reversedById!)));
        for (const e of reversed) {
          items.push({ type: "ig_reversed", date: e.date, ref: `#${e.number}`, text: e.memo, who: posters.find((p) => p.id === e.reversedById)?.who ?? "", amount: round2(amounts.filter((x) => x.entryId === e.id).reduce((s, x) => s + x.debit, 0)), href: journal(e.id) });
        }
      }
      for (const [doc, entity, type] of [[schema.invoices, "invoice", "ig_void_invoice"], [schema.bills, "bill", "ig_void_bill"]] as const) {
        const rows = await db.select({ d: doc, partner: schema.partners.name }).from(doc).innerJoin(schema.partners, eq(schema.partners.id, doc.partnerId))
          .where(and(eq(doc.companyId, companyId), eq(doc.status, "void"), gte(doc.date, from), lte(doc.date, to))).orderBy(doc.date);
        for (const { d, partner } of rows) items.push({ type, date: d.date, ref: d.number, text: partner, who: whoDid("void", entity, d.id), amount: d.total, href: `/${entity === "invoice" ? "sales/invoices" : "purchases/bills"}/${d.id}` });
      }
      const bank = await db.select().from(schema.bankLines).where(and(eq(schema.bankLines.companyId, companyId), eq(schema.bankLines.status, "ignored"), gte(schema.bankLines.date, from), lte(schema.bankLines.date, to))).orderBy(schema.bankLines.date);
      for (const b of bank) items.push({ type: "ig_bank", date: b.date, ref: b.reference, text: b.description, who: whoDid("ignore", "bank_line", b.id), amount: Math.abs(b.amount) });
      // Deleted records no longer exist, so the audit trail is all that remains of them.
      const deleted: [string, string, Key][] = [
        ["delete_draft", "journal_entry", "ig_deleted_entry"], ["delete_draft", "invoice", "ig_deleted_invoice"], ["delete_draft", "bill", "ig_deleted_bill"],
        ["delete", "payroll_run", "ig_deleted_payroll"], ["void", "goods_receipt", "ig_void_receipt"], ["delete", "payment_voucher", "ig_deleted_voucher"],
        ["cancel", "payment_voucher", "ig_cancelled_voucher"], ["cancel", "proforma", "ig_cancelled_proforma"],
      ];
      for (const { a, who } of trail) {
        const kindOf = deleted.find(([action, entity]) => action === a.action && entity === a.entity);
        const date = a.at.toISOString().slice(0, 10);
        if (!kindOf || date < from || date > to) continue;
        const details = a.details ?? {};
        items.push({
          type: kindOf[2], date, ref: String(details.number ?? (a.entityId.length < 36 ? a.entityId : "")),
          text: String(details.memo ?? details.note ?? details.month ?? ""), who: who ?? "", amount: Number(details.amount) || 0,
        });
      }
      const order: Key[] = ["ig_reversed", "ig_void_invoice", "ig_void_bill", "ig_bank", "ig_deleted_entry", "ig_deleted_invoice", "ig_deleted_bill", "ig_deleted_payroll", "ig_void_receipt", "ig_deleted_voucher", "ig_cancelled_voucher", "ig_cancelled_proforma"];
      const groups = order.map((type) => ({ type, list: items.filter((i) => i.type === type).sort((x, y) => x.date.localeCompare(y.date)) })).filter((g) => g.list.length);
      const totalOf = (list: Item[]) => round2(list.reduce((s, i) => s + i.amount, 0));
      if (kind === "ignored-summary") {
        return {
          period, note: t("r_ignored_note"),
          columns: [text(t("r_txn_type")), { label: t("r_count"), type: "money" }, money(t("amount"))],
          rows: groups.length ? [
            ...groups.map((g): Row => ({ style: "line", cells: [t(g.type), g.list.length, totalOf(g.list)] })),
            { style: "total", cells: [t("total"), items.length, totalOf(items)] },
          ] : [],
        };
      }
      return {
        period, note: t("r_ignored_note"),
        columns: [text(t("date")), text(t("reference")), text(t("description")), text(t("audit_who")), money(t("amount"))],
        rows: groups.length ? [
          ...groups.flatMap((g): Row[] => [
            head(t(g.type)),
            ...g.list.map((i): Row => ({ style: "line", cells: [i.date, i.ref, i.text, i.who, i.amount || null], links: i.href ? { 1: i.href } : undefined })),
            { style: "sub", cells: [`${t("total")} ${t(g.type)}`, null, null, null, totalOf(g.list)] },
          ]),
          { style: "total", cells: [t("total"), null, null, null, totalOf(items)] },
        ] : [],
      };
    }
  }
}
