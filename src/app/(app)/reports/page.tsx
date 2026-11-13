import { requireView } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { PageHead } from "@/components/ui";
import { ReportFinder } from "@/components/ReportFinder";

export const metadata = { title: "Reports" };

const GROUPS: { title: Key; items: { kind: string; label: Key; help: Key }[] }[] = [
  {
    title: "r_group_company",
    items: [
      { kind: "pl", label: "r_pl", help: "rh_pl" },
      { kind: "pl-detail", label: "r_pl_detail", help: "rh_pl_detail" },
      { kind: "pl-compare", label: "r_pl_compare", help: "rh_pl_compare" },
      { kind: "proj", label: "r_proj", help: "rh_proj" },
      { kind: "pl-unclassified", label: "r_pl_unclassified", help: "rh_pl_unclassified" },
      { kind: "pl-customer", label: "r_pl_customer", help: "rh_pl_customer" },
      { kind: "pl-customer-detail", label: "r_pl_customer_detail", help: "rh_pl_customer_detail" },
      { kind: "bs", label: "r_bs", help: "rh_bs" },
      { kind: "bs-detail", label: "r_bs_detail", help: "rh_bs_detail" },
      { kind: "bs-summary", label: "r_bs_summary", help: "rh_bs_summary" },
      { kind: "bs-compare", label: "r_bs_compare", help: "rh_bs_compare" },
      { kind: "cf", label: "r_cf", help: "rh_cf" },
    ],
  },
  {
    title: "r_group_tax",
    items: [
      { kind: "tax-prep", label: "r_tax_prep", help: "rh_tax_prep" },
      { kind: "tax-summary", label: "r_tax_summary", help: "rh_tax_summary" },
      { kind: "tax-detail", label: "r_tax_detail", help: "rh_tax_detail" },
    ],
  },
  {
    title: "r_group_accountant",
    items: [
      { kind: "tb", label: "r_tb", help: "rh_tb" },
      { kind: "gl", label: "r_gl", help: "rh_gl" },
      { kind: "txn-account", label: "r_txn_account", help: "rh_txn_account" },
      { kind: "adjusting", label: "r_adjusting", help: "rh_adjusting" },
      { kind: "journal", label: "r_journal", help: "rh_journal" },
      { kind: "audit", label: "r_audit", help: "rh_audit" },
      { kind: "ignored-summary", label: "r_ignored_summary", help: "rh_ignored_summary" },
      { kind: "ignored-detail", label: "r_ignored_detail", help: "rh_ignored_detail" },
    ],
  },
  {
    title: "nav_vendor_reports",
    items: [
      { kind: "ap", label: "r_ap", help: "rh_ap" },
      { kind: "ap-aging-detail", label: "r_ap_aging_detail", help: "rh_ap_aging_detail" },
      { kind: "ap-balance-summary", label: "r_ap_balance_summary", help: "rh_ap_balance_summary" },
      { kind: "ap-balance-detail", label: "r_ap_balance_detail", help: "rh_ap_balance_detail" },
      { kind: "ap-unpaid", label: "r_ap_unpaid", help: "rh_ap_unpaid" },
      { kind: "vendors", label: "r_vendors", help: "rh_vendors" },
      { kind: "po-open", label: "r_po_open", help: "rh_po_open" },
    ],
  },
  {
    title: "nav_customer_reports",
    items: [
      { kind: "ar", label: "r_ar", help: "rh_ar" },
      { kind: "ar-aging-detail", label: "r_ar_aging_detail", help: "rh_ar_aging_detail" },
      { kind: "ar-balance-summary", label: "r_ar_balance_summary", help: "rh_ar_balance_summary" },
      { kind: "ar-balance-detail", label: "r_ar_balance_detail", help: "rh_ar_balance_detail" },
      { kind: "ar-unpaid", label: "r_ar_unpaid", help: "rh_ar_unpaid" },
      { kind: "customers", label: "r_customers", help: "rh_customers" },
    ],
  },
  {
    title: "r_group_other",
    items: [
      { kind: "vat", label: "r_vat", help: "rh_vat" },
    ],
  },
];

export default async function ReportsIndex() {
  const ctx = await requireView("reports");
  const { t } = await getI18n();
  const groups = GROUPS.map((g) => ({
    title: t(g.title),
    items: g.items.filter((i) => i.kind !== "audit" || ctx.can("audit")).map((i) => ({ kind: i.kind, label: t(i.label), help: t(i.help) })),
  }));
  return (
    <div className="stack">
      <PageHead title={t("r_title")} />
      <ReportFinder groups={groups} labels={{ search: t("rc_search"), favourites: t("rc_favourites"), star: t("rc_star"), unstar: t("rc_unstar"), none: t("rc_none") }} />
    </div>
  );
}
