import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { Empty, ErrorNote, PageHead, Pill } from "@/components/ui";
import { acceptBill, rejectBill } from "./actions";

export const metadata = { title: "Receive bills" };

/** Bills suppliers sent through TAGPILOT against their contracts. */
export default async function ReceivedBillsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("purchases");
  const { t, err, money, accName } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [rows, accounts] = await Promise.all([
    db.select({ s: schema.supplierBills, supplier: schema.partners.name, contract: schema.contracts.number }).from(schema.supplierBills)
      .innerJoin(schema.partners, eq(schema.partners.id, schema.supplierBills.partnerId))
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.supplierBills.contractId))
      .where(eq(schema.supplierBills.companyId, ctx.company.id)).orderBy(desc(schema.supplierBills.createdAt)).limit(300),
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), eq(schema.accounts.isActive, true), inArray(schema.accounts.type, ["expense", "asset"]))).orderBy(schema.accounts.code),
  ]);
  const write = ctx.can("purchases", "write");
  const pill = { received: "open", accepted: "paid", rejected: "void" } as const;
  return (
    <div className="stack">
      <PageHead title={t("nav_receive_bill")} />
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("rb_help")}</p>
      <ErrorNote message={err(q("error"))} />
      {rows.length ? rows.map(({ s, supplier, contract }) => (
        <div key={s.id} className="panel stack">
          <div className="row">
            <h2 style={{ flex: 1 }}>{supplier} · {s.reference}</h2>
            <Pill kind={pill[s.status]}>{t(`rb_${s.status}`)}</Pill>
          </div>
          <div className="fields">
            <div><div className="label">{t("nav_contracts")}</div><Link href={`/contracts/${s.contractId}`}>{contract}</Link></div>
            <div><div className="label">{t("date")}</div>{s.date}</div>
            <div><div className="label">{t("due_date")}</div>{s.dueDate}</div>
            <div><div className="label">{t("rb_amount")}</div><b className="num">{money(s.amount, 2)}</b></div>
          </div>
          <div style={{ whiteSpace: "pre-wrap" }}>{s.description}</div>
          <div className="row small">
            {s.attachmentId ? <a href={`/api/files/${s.attachmentId}`} target="_blank" rel="noreferrer">{t("attachment")} →</a> : null}
            {s.billId ? <Link href={`/purchases/bills/${s.billId}`}>{t("bill_bill")} →</Link> : null}
            {s.decisionNote ? <span className="muted">{s.decisionNote}</span> : null}
          </div>
          {write && s.status === "received" ? (
            <div className="grid2">
              <form action={acceptBill} className="stack">
                <input type="hidden" name="id" value={s.id} />
                <label className="f">{t("expense_account")}
                  <select id={`rb-acc-${s.id}`} name="accountId" required defaultValue="">
                    <option value="">—</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
                  </select></label>
                {ctx.company.vatRegistered ? <label className="row small" style={{ gap: 8 }}><input id={`rb-vat-${s.id}`} name="vatApplies" type="checkbox" style={{ width: "auto" }} defaultChecked /> {t("rb_vat")}</label> : null}
                <div><button type="submit" className="btn primary">{t("rb_accept")}</button></div>
              </form>
              <form action={rejectBill} className="stack">
                <input type="hidden" name="id" value={s.id} />
                <label className="f">{t("pv_decision_note")}<input id={`rb-note-${s.id}`} name="note" /></label>
                <div><button type="submit" className="btn danger">{t("pv_reject")}</button></div>
              </form>
            </div>
          ) : null}
        </div>
      )) : <div className="panel"><Empty>{t("nothing_yet")}</Empty></div>}
    </div>
  );
}
