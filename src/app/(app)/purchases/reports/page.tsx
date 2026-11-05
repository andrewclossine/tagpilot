import Link from "next/link";
import { requireView } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Vendor reports" };

const VENDOR_REPORTS: { kind: string; label: Key; help: Key }[] = [
  { kind: "ap", label: "r_ap", help: "rh_ap" },
  { kind: "ap-aging-detail", label: "r_ap_aging_detail", help: "rh_ap_aging_detail" },
  { kind: "ap-balance-summary", label: "r_ap_balance_summary", help: "rh_ap_balance_summary" },
  { kind: "ap-balance-detail", label: "r_ap_balance_detail", help: "rh_ap_balance_detail" },
  { kind: "ap-unpaid", label: "r_ap_unpaid", help: "rh_ap_unpaid" },
  { kind: "vendors", label: "r_vendors", help: "rh_vendors" },
  { kind: "po-open", label: "r_po_open", help: "rh_po_open" },
];

export default async function VendorReportsPage() {
  await requireView("purchases");
  const { t } = await getI18n();
  return (
    <div className="stack">
      <PageHead title={t("nav_vendor_reports")} />
      <section className="panel stack">
        <ul className="report-list">
          {VENDOR_REPORTS.map((i) => (
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
