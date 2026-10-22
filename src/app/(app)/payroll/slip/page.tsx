import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { payrollConfig, readPayslip } from "@/lib/payroll";
import { isUuid } from "@/lib/format";
import { LogoMark } from "@/components/Logo";

export const metadata = { title: "Payslip" };

/** One person's payslip for a saved payroll run, laid out to print on one page. */
export default async function SlipPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("payroll");
  const { t, money } = await getI18n();
  const q = await sp(searchParams);
  if (!isUuid(q("run"))) notFound();
  const db = await getDb();
  const [run] = await db.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.id, q("run")), eq(schema.payrollRuns.companyId, ctx.company.id)));
  const raw = run?.rows[Number(q("row"))];
  if (!run || !raw) notFound();
  const r = readPayslip(raw);
  const comps = payrollConfig(run.settings).components;
  return (
    <div className="panel stack" style={{ maxWidth: 720 }}>
      <div className="row">
        <div style={{ flex: 1 }}><h1>{t("payslip")} · {run.month}</h1><div className="muted">{ctx.company.name}{ctx.company.registrationNo ? ` · ${t("co_reg")} ${ctx.company.registrationNo}` : ""}</div></div>
        <LogoMark size={36} id="slip" />
      </div>
      <div className="fields">
        <div><div className="label">{t("emp_name")}</div><b>{r.name}</b></div>
        <div><div className="label">{t("position")}</div>{r.position || "—"}</div>
        <div><div className="label">{t("currency")}</div>{ctx.company.currency}</div>
      </div>
      <table><tbody>
        <tr className="total"><td>{t("gross")}</td><td className="num">{money(r.gross)}</td></tr>
        {comps.filter((c) => c.kind === "employee").map((c) => <tr key={c.code}><td>{c.name}{c.method === "percent" ? ` (${c.rate}%)` : ""}</td><td className="num">-{money(r.deductions[c.code] ?? 0)}</td></tr>)}
        {r.otherDeduction ? <tr><td>{t("deduction")}</td><td className="num">-{money(r.otherDeduction)}</td></tr> : null}
        <tr className="total"><td>{t("net")}</td><td className="num">{money(r.net)}</td></tr>
      </tbody></table>
      <div className="small muted">{t("er_cost")}: {comps.filter((c) => c.kind === "employer").map((c) => `${c.name} ${money(r.employer[c.code] ?? 0)}`).join(" · ") || "—"}</div>
    </div>
  );
}
