import Link from "next/link";
import { requireView } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { PageHead } from "@/components/ui";

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
    title: "r_group_other",
    items: [
      { kind: "vat", label: "r_vat", help: "rh_vat" },
      { kind: "ar", label: "r_ar", help: "rh_ar" },
      { kind: "ap", label: "r_ap", help: "rh_ap" },
    ],
  },
];

export default async function ReportsIndex() {
  const ctx = await requireView("reports");
  const { t } = await getI18n();
  return (
    <div className="stack">
      <PageHead title={t("r_title")} />
      {GROUPS.map((g) => (
        <section key={g.title} className="panel stack">
          <h2>{t(g.title)}</h2>
          <ul className="report-list">
            {g.items.filter((i) => i.kind !== "audit" || ctx.can("audit")).map((i) => (
              <li key={i.kind}>
                <Link href={`/reports/${i.kind}`}>{t(i.label)}</Link>
                <span className="small muted">{t(i.help)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
