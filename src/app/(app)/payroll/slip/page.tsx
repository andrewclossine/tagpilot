import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";

export const metadata = { title: "Payslip" };

/** One employee's payslip for a saved payroll run, laid out to print on one page. */
export default async function SlipPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getCtx();
  const { t, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [run] = await db.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.id, q("run")), eq(schema.payrollRuns.companyId, ctx.company.id)));
  const r = run?.rows.find((x) => x.employeeId === q("emp"));
  if (!run || !r) notFound();
  const [emp] = await db.select().from(schema.employees).where(eq(schema.employees.id, r.employeeId));
  const line = (label: string, v: number, bold = false) => v || bold ? <tr className={bold ? "total" : undefined}><td>{label}</td><td className="num">{money(v)}</td></tr> : null;
  return (
    <div className="panel stack" style={{ maxWidth: 720 }}>
      <div className="row"><div style={{ flex: 1 }}><h1>{t("payslip")} · {run.month}</h1><div className="muted">{ctx.company.name}{ctx.company.tin ? ` · ${t("tin")} ${ctx.company.tin}` : ""}</div></div></div>
      <div className="fields">
        <div><div className="label">{t("emp_name")}</div><b>{r.name}</b></div>
        <div><div className="label">{t("position")}</div>{emp?.position || "—"}</div>
        <div><div className="label">{t("rssb_no")}</div>{emp?.rssbNo || "—"}</div>
        <div><div className="label">{t("national_id")}</div>{emp?.nationalId || "—"}</div>
      </div>
      <table><tbody>
        {line(t("basic"), r.basic)}{line(t("transport"), r.transport)}{line(t("allowances"), r.other)}{line(t("bonus"), r.bonus)}
        {line(t("gross"), r.gross, true)}
        {line(`${t("paye")}`, -r.paye)}{line(`${t("pension")} (${run.settings.pensionEmp}%)`, -r.penE)}{line(`${t("maternity")} (${run.settings.matEmp}%)`, -r.matE)}
        {line(`${t("cbhi")} (${run.settings.cbhi}%)`, -r.cbhi)}{line(t("deduction"), -r.deduction)}
        {line(t("net"), r.net, true)}
      </tbody></table>
      <div className="small muted">{t("er_cost")}: {t("pension")} {money(r.penR)} · {t("maternity")} {money(r.matR)} · {t("oh")} {money(r.oh)}</div>
    </div>
  );
}
