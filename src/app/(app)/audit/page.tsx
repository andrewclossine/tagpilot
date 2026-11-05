import { redirect } from "next/navigation";

/** The audit trail now lives with the accountant reports. */
export default function AuditPage() {
  redirect("/reports/audit");
}
