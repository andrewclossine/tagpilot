import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { requireView, requireWrite } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { parseAmount, str, today } from "@/lib/format";
import { balances } from "@/lib/ledger";
import { audit } from "@/lib/audit";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Budgets" };

async function saveBudget(fd: FormData) {
  "use server";
  const ctx = await requireWrite("budgets");
  const year = Number(str(fd, "year")), projectId = str(fd, "projectId") || null;
  const db = await getDb();
  const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id));
  await db.transaction(async (tx) => {
    await tx.delete(schema.budgets).where(and(eq(schema.budgets.companyId, ctx.company.id), eq(schema.budgets.year, year),
      projectId ? eq(schema.budgets.projectId, projectId) : isNull(schema.budgets.projectId)));
    const rows = accounts.map((a) => ({ accountId: a.id, amount: parseAmount(fd.get(`a_${a.id}`)) })).filter((r) => r.amount);
    if (rows.length) await tx.insert(schema.budgets).values(rows.map((r) => ({ ...r, companyId: ctx.company.id, year, projectId })));
    await audit(tx, ctx.company.id, ctx.user.id, "update", "budget", `${year}/${projectId ?? "company"}`, { lines: rows.length });
  });
  revalidatePath("/budgets");
  redirect(`/budgets?year=${year}&project=${projectId ?? ""}&saved=1`);
}

export default async function BudgetsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("budgets");
  const { t, accName, money } = await getI18n();
  const q = await sp(searchParams);
  const year = /^\d{4}$/.test(q("year")) ? Number(q("year")) : Number(today().slice(0, 4));
  const projectId = q("project") || null;
  const db = await getDb();
  const [accounts, projects, budgetRows, actual] = await Promise.all([
    db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id)).orderBy(schema.accounts.code),
    db.select().from(schema.projects).where(eq(schema.projects.companyId, ctx.company.id)).orderBy(schema.projects.code),
    db.select().from(schema.budgets).where(and(eq(schema.budgets.companyId, ctx.company.id), eq(schema.budgets.year, year),
      projectId ? eq(schema.budgets.projectId, projectId) : isNull(schema.budgets.projectId))),
    balances(db, ctx.company.id, { from: `${year}-01-01`, to: `${year}-12-31`, projectId: projectId ?? undefined }),
  ]);
  const budgetOf = (id: string) => budgetRows.find((b) => b.accountId === id)?.amount ?? 0;
  const section = (type: "income" | "expense") => {
    const accs = accounts.filter((a) => a.type === type);
    const sign = type === "income" ? -1 : 1;
    let tb = 0, ta = 0;
    const rows = accs.map((a) => {
      const b = budgetOf(a.id), act = (actual.get(a.id)?.net ?? 0) * sign;
      tb += b; ta += act;
      const used = b ? Math.round((act / b) * 100) : 0;
      return (
        <tr key={a.id}>
          <td><code className="k">{a.code}</code> {accName(a)}</td>
          <td className="num">{ctx.can("budgets", "write") ? <input name={`a_${a.id}`} id={`a_${a.id}`} className="num" style={{ width: 140 }} defaultValue={b || ""} inputMode="decimal" aria-label={t("budget")} /> : money(b)}</td>
          <td className="num">{money(act)}</td>
          <td className="num" style={{ color: b && (type === "expense" ? act > b : act < b) ? "var(--bad)" : undefined }}>{b ? money(b - act) : ""}</td>
          <td>{b ? <><span className={`meter${used > 100 ? " over" : ""}`}><i style={{ width: `${Math.min(used, 100)}%` }} /></span> <span className="small num">{used}%</span></> : null}</td>
        </tr>
      );
    });
    return { rows, tb, ta };
  };
  const inc = section("income"), exp = section("expense");
  return (
    <div className="stack">
      <PageHead title={t("bud_title")} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      <form className="row" method="get">
        <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{t("year")}<input id="year" name="year" className="num" defaultValue={year} style={{ width: 90 }} /></label>
        <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{t("bud_for")}
          <select id="project" name="project" defaultValue={projectId ?? ""} style={{ width: "auto" }}>
            <option value="">{t("bud_company")}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select></label>
        <button type="submit" className="btn sm">{t("show")}</button>
      </form>
      <form action={saveBudget} className="panel stack">
        <input type="hidden" name="year" value={year} /><input type="hidden" name="projectId" value={projectId ?? ""} />
        <h2>{t("bud_vs_actual")} · {year}</h2>
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("account")}</th><th className="num">{t("budget")}</th><th className="num">{t("actual")}</th><th className="num">{t("variance")}</th><th>{t("used")}</th></tr></thead>
          <tbody>
            <tr className="sub"><td colSpan={5}>{t("income")}</td></tr>{inc.rows}
            <tr><td><b>{t("total")} {t("income").toLowerCase()}</b></td><td className="num"><b>{money(inc.tb)}</b></td><td className="num"><b>{money(inc.ta)}</b></td><td className="num">{money(inc.tb - inc.ta)}</td><td /></tr>
            <tr className="sub"><td colSpan={5}>{t("expenses")}</td></tr>{exp.rows}
            <tr><td><b>{t("total")} {t("expenses").toLowerCase()}</b></td><td className="num"><b>{money(exp.tb)}</b></td><td className="num"><b>{money(exp.ta)}</b></td><td className="num">{money(exp.tb - exp.ta)}</td><td /></tr>
            <tr className="total"><td>{t("net_result")}</td><td className="num">{money(inc.tb - exp.tb)}</td><td className="num">{money(inc.ta - exp.ta)}</td><td /><td /></tr>
          </tbody>
        </table></div>
        {ctx.can("budgets", "write") ? <div><button type="submit" className="btn primary">{t("bud_save")}</button></div> : null}
      </form>
    </div>
  );
}
