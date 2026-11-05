import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { balances, moneyAccounts } from "@/lib/ledger";
import { today } from "@/lib/format";
import { Empty, Pill } from "@/components/ui";

const ROWS = 5;

/** The company's own-currency money accounts, each with its balance so it can be seen before money leaves. */
export async function homeBanks(ctx: Ctx) {
  const { accName, money } = await getI18n();
  const db = await getDb();
  const [accounts, bal] = await Promise.all([moneyAccounts(db, ctx.company.id), balances(db, ctx.company.id)]);
  // Banks come first: that is where cheques and deposits usually go.
  const rank = (s: string | null) => (s === "bank" ? 0 : 1);
  return accounts.filter((a) => !a.currency).sort((x, y) => rank(x.subtype) - rank(y.subtype)).map((a) => ({ id: a.id, label: `${a.code} · ${accName(a)} (${money(bal.get(a.id)?.net ?? 0)})` }));
}

/** The form of a cheque or a deposit: which bank, who, and the accounts the money goes to or comes from. */
export async function BankDocFields({ ctx, kind }: { ctx: Ctx; kind: "check" | "deposit" }) {
  const { t, accName } = await getI18n();
  const db = await getDb();
  const [banks, accounts, projects, partners] = await Promise.all([
    homeBanks(ctx),
    db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), eq(schema.accounts.isActive, true))).orderBy(schema.accounts.code),
    db.select().from(schema.projects).where(and(eq(schema.projects.companyId, ctx.company.id), eq(schema.projects.isActive, true))).orderBy(schema.projects.code),
    db.select().from(schema.partners).where(eq(schema.partners.companyId, ctx.company.id)).orderBy(schema.partners.name),
  ]);
  const usable = accounts.filter((a) => !a.currency && a.subtype !== "ar" && a.subtype !== "ap" && (kind === "deposit" || !["bank", "cash", "momo"].includes(a.subtype ?? "")));
  if (!banks.length) return <Empty>{t("bank_no_accounts")}</Empty>;
  return (
    <>
      <div className="fields">
        <label className="f">{t(kind === "check" ? "bk_from_bank" : "bk_to_bank")}
          <select id="b-account" name="accountId" required>{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
        <label className="f">{t("date")}<input id="b-date" name="date" type="date" required defaultValue={today()} /></label>
        <label className="f">{t(kind === "check" ? "bk_check_no" : "reference")}<input id="b-reference" name="reference" placeholder={kind === "check" ? t("bk_check_no_auto") : undefined} /></label>
        <label className="f">{t("partner")}
          <select id="b-partner" name="partnerId" defaultValue="">
            <option value="">{t("none")}</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <label className="f">{t(kind === "check" ? "pv_payee" : "bk_received_from")}<input id="b-payee" name="payee" /></label>
      </div>
      <label className="f">{t("memo")}<input id="b-memo" name="memo" /></label>
      <div className="tbl-wrap"><table className="lines">
        <thead><tr><th>{t("account")}</th><th>{t("project")}</th><th>{t("description")}</th><th className="num">{t("amount")} ({ctx.company.currency})</th></tr></thead>
        <tbody>{Array.from({ length: ROWS }, (_, i) => (
          <tr key={i}>
            <td><select id={`b-acc-${i}`} name="lineAccount" aria-label={t("account")} defaultValue="">
              <option value="">{t("none")}</option>
              {usable.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}
            </select></td>
            <td><select id={`b-prj-${i}`} name="lineProject" aria-label={t("project")} defaultValue="">
              <option value="">{t("none")}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
            </select></td>
            <td><input id={`b-desc-${i}`} name="lineDescription" aria-label={t("description")} /></td>
            <td><input id={`b-amt-${i}`} name="lineAmount" className="num" inputMode="decimal" aria-label={t("amount")} /></td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="small muted">{t(kind === "check" ? "bk_check_help" : "bk_deposit_help")}</div>
    </>
  );
}

/** The latest transactions of some kinds. A transaction whose journal entry was reversed shows as voided. */
export async function BankRegister({ ctx, kinds, pdf }: { ctx: Ctx; kinds: (typeof schema.bankTransactions.$inferSelect.kind)[]; pdf?: boolean }) {
  const { t, money, accName } = await getI18n();
  const db = await getDb();
  const bt = schema.bankTransactions;
  const rows = await db.select({ b: bt, reversed: schema.journalEntries.reversedById }).from(bt)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, bt.entryId))
    .where(and(eq(bt.companyId, ctx.company.id), inArray(bt.kind, kinds))).orderBy(desc(bt.date), desc(bt.createdAt)).limit(100);
  const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id));
  const name = (id: string | null) => { const a = accounts.find((x) => x.id === id); return a ? `${a.code} ${accName(a)}` : ""; };
  if (!rows.length) return <Empty>{t("nothing_yet")}</Empty>;
  return (
    <div className="tbl-wrap"><table>
      <thead><tr><th>{t("date")}</th><th>{t("reference")}</th><th>{t("account")}</th><th>{t("memo")}</th><th className="num">{t("amount")}</th><th>{t("status")}</th><th /></tr></thead>
      <tbody>{rows.map(({ b, reversed }) => (
        <tr key={b.id}>
          <td style={{ whiteSpace: "nowrap" }}>{b.date}</td>
          <td><Link className="rowlink" href={`/journal/${b.entryId}`}>{b.number || "→"}</Link></td>
          <td>{name(b.accountId)}{b.toAccountId ? ` → ${name(b.toAccountId)}` : ""}</td>
          <td>{b.payee ? <b>{b.payee} </b> : null}{b.memo}{b.currency && b.kind !== "fx_revaluation" ? <div className="small muted">{[money(Math.abs(b.foreignAmount || b.toForeignAmount), 2), b.currency, "@", b.rate].join(" ")}</div> : null}</td>
          <td className="num">{money(b.amount, 2)}</td>
          <td><Pill kind={reversed ? "void" : "posted"}>{t(reversed ? "bk_voided" : "st_posted")}</Pill></td>
          <td>{pdf ? <a className="small" href={`/api/pdf/check/${b.id}`} download={`cheque-${b.number}.pdf`}>PDF</a> : null}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
