import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { requireView, requireWrite } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { fail, sp, type SearchParams } from "@/lib/actions";
import { str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { audit } from "@/lib/audit";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead } from "@/components/ui";

export const metadata = { title: "Customers & suppliers" };

async function savePartner(fd: FormData) {
  "use server";
  const ctx = await requireWrite("partners");
  const id = str(fd, "id");
  const kind = (["customer", "supplier", "both"] as const).find((k) => k === str(fd, "kind")) ?? "customer";
  const values = { name: str(fd, "name"), kind, tin: str(fd, "tin"), phone: str(fd, "phone"), email: str(fd, "email"), address: str(fd, "address") };
  try {
    if (!values.name) throw new UserError("err_required");
    const db = await getDb();
    if (id) await db.update(schema.partners).set(values).where(and(eq(schema.partners.id, id), eq(schema.partners.companyId, ctx.company.id)));
    else await db.insert(schema.partners).values({ ...values, companyId: ctx.company.id });
    await audit(db, ctx.company.id, ctx.user.id, id ? "update" : "create", "partner", id || values.name);
  } catch (e) { fail(e, "/partners"); }
  revalidatePath("/partners");
  redirect("/partners");
}

async function deletePartner(fd: FormData) {
  "use server";
  const ctx = await requireWrite("partners");
  const id = str(fd, "id");
  try {
    const db = await getDb();
    const [used] = await db.select({ n: sql<number>`count(*)` }).from(schema.journalLines)
      .where(and(eq(schema.journalLines.companyId, ctx.company.id), eq(schema.journalLines.partnerId, id)));
    const [docs] = await db.select({ n: sql<number>`(select count(*) from invoices where partner_id = ${id}) + (select count(*) from bills where partner_id = ${id})` }).from(schema.companies).limit(1);
    if (Number(used.n) || Number(docs?.n)) throw new UserError("err_in_use");
    await db.delete(schema.partners).where(and(eq(schema.partners.id, id), eq(schema.partners.companyId, ctx.company.id)));
  } catch (e) { fail(e, "/partners"); }
  revalidatePath("/partners");
  redirect("/partners");
}

export default async function PartnersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("partners");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const s = ctx.company.settings;
  const partners = await db.select().from(schema.partners).where(eq(schema.partners.companyId, ctx.company.id)).orderBy(schema.partners.name);
  const ctlAccounts = await db.select().from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, ctx.company.id), inArray(schema.accounts.code, [s.arAccount, s.apAccount])));
  const ar = ctlAccounts.find((a) => a.code === s.arAccount)?.id, ap = ctlAccounts.find((a) => a.code === s.apAccount)?.id;
  const bal = await db.select({
    partnerId: schema.journalLines.partnerId, accountId: schema.journalLines.accountId,
    net: sql<string>`sum(${schema.journalLines.debit} - ${schema.journalLines.credit})`,
  }).from(schema.journalLines).innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(and(eq(schema.journalLines.companyId, ctx.company.id), eq(schema.journalEntries.status, "posted")))
    .groupBy(schema.journalLines.partnerId, schema.journalLines.accountId);
  const balanceOf = (pid: string) => {
    const owed = Number(bal.find((b) => b.partnerId === pid && b.accountId === ar)?.net ?? 0);
    const owe = -Number(bal.find((b) => b.partnerId === pid && b.accountId === ap)?.net ?? 0);
    return { owed, owe };
  };
  const editing = partners.find((p) => p.id === q("edit"));
  return (
    <div className="stack">
      <PageHead title={t("partners_title")} />
      <ErrorNote message={err(q("error"))} />
      <div className="panel">
        {partners.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("name")}</th><th>{t("kind")}</th><th>{t("tin")}</th><th>{t("phone")}</th>
              <th className="num">{t("kpi_ar")}</th><th className="num">{t("kpi_ap")}</th><th /></tr></thead>
            <tbody>
              {partners.map((p) => {
                const b = balanceOf(p.id);
                return (
                  <tr key={p.id}>
                    <td><b>{p.name}</b>{p.email ? <div className="small muted">{p.email}</div> : null}</td>
                    <td>{t(p.kind)}</td><td>{p.tin}</td><td>{p.phone}</td>
                    <td className="num">{b.owed ? money(b.owed) : ""}</td><td className="num">{b.owe ? money(b.owe) : ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {ctx.can("partners", "write") ? <>
                        <a className="btn ghost sm" href={`/partners?edit=${p.id}#form`}>{t("edit")}</a>
                        <form action={deletePartner} style={{ display: "inline" }}><input type="hidden" name="id" value={p.id} />
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
      {ctx.can("partners", "write") ? (
        <form action={savePartner} className="panel stack" id="form" key={editing?.id ?? "new"}>
          <h2>{editing ? `${t("edit")}: ${editing.name}` : t("add")}</h2>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <div className="fields">
            <label className="f">{t("name")}<input id="p-name" name="name" defaultValue={editing?.name} required /></label>
            <label className="f">{t("kind")}
              <select id="p-kind" name="kind" defaultValue={editing?.kind ?? "customer"}>
                <option value="customer">{t("customer")}</option><option value="supplier">{t("supplier")}</option><option value="both">{t("both")}</option>
              </select>
            </label>
            <label className="f">{t("tin")}<input id="p-tin" name="tin" defaultValue={editing?.tin} inputMode="numeric" /></label>
            <label className="f">{t("phone")}<input id="p-phone" name="phone" defaultValue={editing?.phone} /></label>
            <label className="f">{t("email")}<input id="p-email" name="email" type="email" defaultValue={editing?.email} /></label>
            <label className="f">{t("address")}<input id="p-address" name="address" defaultValue={editing?.address} /></label>
          </div>
          <div className="row"><button type="submit" className="btn primary">{t("save")}</button>{editing ? <a className="btn ghost" href="/partners">{t("cancel")}</a> : null}</div>
        </form>
      ) : null}
    </div>
  );
}
