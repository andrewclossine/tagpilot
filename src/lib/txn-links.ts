import type { EntrySource } from "@/db/schema";

/**
 * Where a posted transaction is opened and adjusted: its own document when it has one (the invoice for a sale or its
 * payment, the bill for a purchase or its payment, the voucher, the production order), otherwise its journal entry.
 */
export function txnHref(e: { id: string; source: EntrySource; sourceId: string | null }) {
  const s = e.sourceId;
  if (s) {
    if (e.source === "invoice" || e.source === "invoice_payment") return `/sales/invoices/${s}`;
    if (e.source === "bill" || e.source === "bill_payment") return `/purchases/bills/${s}`;
    if (e.source === "voucher") return `/vouchers/${s}`;
    if (e.source === "production") return `/inventory/production/${s}`;
  }
  if (e.source === "payroll") return "/payroll";
  return `/journal/${e.id}`;
}
