import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { balances, moneyAccounts } from "@/lib/ledger";
import { Empty, PageHead } from "@/components/ui";

export const metadata = { title: "Banking" };

export default async function BankingPage() {
  const ctx = await requireView("banking");
  const { t, accName, money } = await getI18n();
  const db = await getDb();
  const [accs, bal, open] = await Promise.all([
    moneyAccounts(db, ctx.company.id),
    balances(db, ctx.company.id),
    db.select({ accountId: schema.bankLines.accountId, n: sql<number>`count(*)` }).from(schema.bankLines)
      .where(and(eq(schema.bankLines.companyId, ctx.company.id), eq(schema.bankLines.status, "open"))).groupBy(schema.bankLines.accountId),
  ]);
  return (
    <div className="stack">
      <PageHead title={t("bank_title")} />
      {accs.length ? (
        <div className="kpis">
          {accs.map((a) => (
            <Link key={a.id} href={`/banking/${a.id}`} className="panel kpi" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="label">{a.code} · {accName(a)}</div>
              <div className="v">{money(bal.get(a.id)?.net ?? 0)}</div>
              <div className="small muted">{t("bank_open")}: {Number(open.find((o) => o.accountId === a.id)?.n ?? 0)}</div>
            </Link>
          ))}
        </div>
      ) : <div className="panel"><Empty>{t("bank_no_accounts")}</Empty></div>}
    </div>
  );
}
