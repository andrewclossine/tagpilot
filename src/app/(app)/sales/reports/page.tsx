import Link from "next/link";
import { requireView } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Customer reports" };

const CUSTOMER_REPORTS: { kind: string; label: Key; help: Key }[] = [
  { kind: "ar-aging-detail", label: "r_ar_aging_detail", help: "rh_ar_aging_detail" },
  { kind: "ar-balance-summary", label: "r_ar_balance_summary", help: "rh_ar_balance_summary" },
  { kind: "ar-balance-detail", label: "r_ar_balance_detail", help: "rh_ar_balance_detail" },
  { kind: "ar-unpaid", label: "r_ar_unpaid", help: "rh_ar_unpaid" },
  { kind: "customers", label: "r_customers", help: "rh_customers" },
];

export default async function CustomerReportsPage() {
  await requireView("sales");
  const { t } = await getI18n();
  return (
    <div className="stack">
      <PageHead title={t("nav_customer_reports")} />
      <section className="panel stack">
        <ul className="report-list">
          {CUSTOMER_REPORTS.map((i) => (
            <li key={i.kind}>
              <Link href={`/reports/${i.kind}`}>{t(i.label)}</Link>
              <span className="small muted">{t(i.help)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
