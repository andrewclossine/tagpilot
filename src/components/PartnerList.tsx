import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { deletePartner, savePartner } from "@/app/(app)/partners/actions";
import { ConfirmButton } from "./editors";
import { Empty, ErrorNote, PageHead } from "./ui";

/** Customers, suppliers or both: someone who is both appears in each list. */
export async function PartnerList({ ctx, only, back, title, error, editId }: {
  ctx: Ctx; only?: "customer" | "supplier"; back: string; title: Key; error: string; editId: string;
}) {
  const { t, err, money } = await getI18n();
  const db = await getDb();
  const s = ctx.company.settings;
  const all = await db.select().from(schema.partners).where(eq(schema.partners.companyId, ctx.company.id)).orderBy(schema.partners.name);
  const partners = only ? all.filter((p) => p.kind === only || p.kind === "both") : all;
  const ctlAccounts = await db.select().from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, ctx.company.id), inArray(schema.accounts.code, [s.arAccount, s.apAccount])));
  const ar = ctlAccounts.find((a) => a.code === s.arAccount)?.id, ap = ctlAccounts.find((a) => a.code === s.apAccount)?.id;
  const bal = await db.select({
    partnerId: schema.journalLines.partnerId, accountId: schema.journalLines.accountId,
    net: sql<string>`sum(${schema.journalLines.debit} - ${schema.journalLines.credit})`,
  }).from(schema.journalLines).innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(and(eq(schema.journalLines.companyId, ctx.company.id), eq(schema.journalEntries.status, "posted")))
    .groupBy(schema.journalLines.partnerId, schema.journalLines.accountId);
  const balanceOf = (pid: string) => ({
    owed: Number(bal.find((b) => b.partnerId === pid && b.accountId === ar)?.net ?? 0),
    owe: -Number(bal.find((b) => b.partnerId === pid && b.accountId === ap)?.net ?? 0),
  });
  const editing = partners.find((p) => p.id === editId);
  const write = ctx.can("partners", "write");
  return (
    <div className="stack">
      <PageHead title={t(title)} />
      <ErrorNote message={err(error)} />
      <div className="panel">
        {partners.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("name")}</th><th>{t("kind")}</th><th>{t("tin")}</th><th>{t("phone")}</th>
              {only !== "supplier" ? <th className="num">{t("kpi_ar")}</th> : null}{only !== "customer" ? <th className="num">{t("kpi_ap")}</th> : null}<th /></tr></thead>
            <tbody>
              {partners.map((p) => {
                const b = balanceOf(p.id);
                return (
                  <tr key={p.id}>
                    <td><b>{p.name}</b>{p.email ? <div className="small muted">{p.email}</div> : null}</td>
                    <td>{t(p.kind)}</td><td>{p.tin}</td><td>{p.phone}</td>
                    {only !== "supplier" ? <td className="num">{b.owed ? money(b.owed) : ""}</td> : null}
                    {only !== "customer" ? <td className="num">{b.owe ? money(b.owe) : ""}</td> : null}
                    <td style={{ whiteSpace: "nowrap" }}>
                      {write ? <>
                        <a className="btn ghost sm" href={`${back}?edit=${p.id}#form`}>{t("edit")}</a>
                        <form action={deletePartner} style={{ display: "inline" }}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} />
                          <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
                      </> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
      {write ? (
        <form action={savePartner} className="panel stack" id="form" key={editing?.id ?? "new"}>
          <h2>{editing ? `${t("edit")}: ${editing.name}` : t("add")}</h2>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <input type="hidden" name="back" value={back} />
          <h3 className="small muted">{t("pt_identity")}</h3>
          <div className="fields">
            <label className="f">{t(only === "supplier" ? "pt_supplier_name" : "pt_customer_name")}<input id="p-name" name="name" defaultValue={editing?.name} required /></label>
            <label className="f">{t("kind")}
              <select id="p-kind" name="kind" defaultValue={editing?.kind ?? only ?? "customer"}>
                <option value="customer">{t("customer")}</option><option value="supplier">{t("supplier")}</option><option value="both">{t("both")}</option>
              </select>
            </label>
          </div>
          <h3 className="small muted">{t("pt_opening")}</h3>
          {editing?.openingDocId ? (
            <div className="small">{t("pt_opening_done")} {money(editing.openingBalance)} · {editing.openingDate} · <a href={`${editing.kind === "supplier" ? "/purchases/bills" : "/sales/invoices"}/${editing.openingDocId}`}>{t("pt_opening_doc")} →</a></div>
          ) : (
            <div className="fields">
              <label className="f">{t(only === "supplier" ? "pt_opening_owe" : "pt_opening_owed")}<input id="p-opening" name="openingBalance" className="num" inputMode="decimal" /></label>
              <label className="f">{t("pt_as_of")}<input id="p-opening-date" name="openingDate" type="date" /></label>
            </div>
          )}
          <h3 className="small muted">{t("pt_payment")}</h3>
          <div className="fields">
            <label className="f">{t("pt_bank_account")}<input id="p-bank" name="bankAccount" defaultValue={editing?.bankAccount} /></label>
            <label className="f">{t("pt_terms")}<input id="p-terms" name="paymentTerms" className="num" inputMode="numeric" defaultValue={editing?.paymentTerms || ""} placeholder="30" /></label>
            <label className="f">{t("pt_credit_limit")}<input id="p-limit" name="creditLimit" className="num" inputMode="decimal" defaultValue={editing?.creditLimit || ""} /></label>
          </div>
          <h3 className="small muted">{t("pt_tax")}</h3>
          <div className="fields">
            <label className="f">{t("tin")}<input id="p-tin" name="tin" defaultValue={editing?.tin} inputMode="numeric" /></label>
            <label className="f">{t("pt_tax_code")}
              <select id="p-tax" name="taxCode" defaultValue={editing?.taxCode ?? "standard"}>
                <option value="standard">{t("pt_tax_standard")}</option><option value="zero">{t("pt_tax_zero")}</option><option value="exempt">{t("pt_tax_exempt")}</option>
              </select></label>
          </div>
          <h3 className="small muted">{t("pt_address")}</h3>
          <div className="fields">
            <label className="f">{t("phone")}<input id="p-phone" name="phone" defaultValue={editing?.phone} /></label>
            <label className="f">{t("pt_work_phone")}<input id="p-work" name="workPhone" defaultValue={editing?.workPhone} /></label>
            <label className="f">{t("email")}<input id="p-email" name="email" type="email" defaultValue={editing?.email} /></label>
            <label className="f">{t("pt_website")}<input id="p-web" name="website" defaultValue={editing?.website} placeholder="www." /></label>
            <label className="f">{t("pt_address1")}<input id="p-address" name="address" defaultValue={editing?.address} /></label>
            <label className="f">{t("pt_address2")}<input id="p-address2" name="address2" defaultValue={editing?.address2} /></label>
            <label className="f">{t("pt_address3")}<input id="p-address3" name="address3" defaultValue={editing?.address3} /></label>
          </div>
          <div className="row"><button type="submit" className="btn primary">{t("save")}</button>{editing ? <a className="btn ghost" href={back}>{t("cancel")}</a> : null}</div>
        </form>
      ) : null}
    </div>
  );
}
