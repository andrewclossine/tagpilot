import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Ctx } from "@/lib/auth";
import type { DocKind } from "@/lib/documents";
import { getI18n } from "@/lib/i18n";
import { bookOptions, docLabels } from "@/lib/data";
import { moneyAccounts } from "@/lib/ledger";
import { addDays, daysBetween, round2, today } from "@/lib/format";
import { ConfirmButton, DocLinesEditor, type DLine, type ItemOpt } from "./editors";
import { Empty, ErrorNote, PageHead, Pill, Tabs } from "./ui";
import { deleteDocDraft, payDocAction, saveDoc, voidDocAction } from "@/app/(app)/doc-actions";
import { sendInvoiceEmail } from "@/app/(app)/send-actions";

export const docBase = (kind: DocKind) => (kind === "invoice" ? "/sales/invoices" : "/purchases/bills");
const statusKey = { draft: "st_draft", open: "st_open", partial: "st_partial", paid: "st_paid", void: "st_void" } as const;

type DocRow = Omit<typeof schema.invoices.$inferSelect, "sentAt" | "sentTo"> & Partial<Pick<typeof schema.invoices.$inferSelect, "sentAt" | "sentTo">> & Partial<Pick<typeof schema.bills.$inferSelect, "supplierRef" | "whtRate" | "attachmentId">>;

async function loadDocs(kind: DocKind, companyId: string, statuses?: string[]) {
  const db = await getDb();
  const doc = kind === "invoice" ? schema.invoices : schema.bills;
  const conds = [eq(doc.companyId, companyId)];
  if (statuses) conds.push(inArray(doc.status, statuses as ("draft" | "open" | "partial" | "paid" | "void")[]));
  return db.select({ d: doc, partner: schema.partners.name }).from(doc)
    .innerJoin(schema.partners, eq(schema.partners.id, doc.partnerId))
    .where(and(...conds)).orderBy(desc(doc.date), desc(doc.createdAt)).limit(500);
}

export async function DocList({ kind, ctx, status }: { kind: DocKind; ctx: Ctx; status: string }) {
  const { t, money } = await getI18n();
  const base = docBase(kind);
  const filter = status === "unpaid" ? ["open", "partial"] : status && status in statusKey ? [status] : undefined;
  const rows = await loadDocs(kind, ctx.company.id, filter);
  const due = rows.reduce((s, r) => s + (r.d.status === "open" || r.d.status === "partial" ? r.d.total - r.d.amountPaid : 0), 0);
  return (
    <div className="stack">
      <PageHead title={t(kind === "invoice" ? "inv_title" : "bill_title")}>
        <Link className="btn" href={kind === "invoice" ? "/reports/ar" : "/reports/ap"}>{t(kind === "invoice" ? "r_ar" : "r_ap")}</Link>
        {ctx.can(kind === "invoice" ? "sales" : "purchases", "write") ? <Link className="btn primary" href={`${base}/new`}>{t(kind === "invoice" ? "inv_new" : "bill_new")}</Link> : null}
      </PageHead>
      <Tabs current={status || "all"} items={[
        { key: "all", href: base, label: t("all") },
        { key: "draft", href: `${base}?status=draft`, label: t("st_draft") },
        { key: "unpaid", href: `${base}?status=unpaid`, label: t("st_open") },
        { key: "paid", href: `${base}?status=paid`, label: t("st_paid") },
      ]} />
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t(kind === "invoice" ? "customer" : "supplier")}</th><th>{t("due_date")}</th>
              <th className="num">{t("total")}</th><th className="num">{t("balance_due")}</th><th>{t("status")}</th></tr></thead>
            <tbody>
              {rows.map(({ d, partner }) => {
                const overdue = (d.status === "open" || d.status === "partial") && d.dueDate < today();
                return (
                  <tr key={d.id} className="click">
                    <td><Link className="rowlink" href={`${base}/${d.id}`}>{d.number}</Link></td>
                    <td className="num" style={{ textAlign: "left" }}>{d.date}</td><td>{partner}</td>
                    <td className="num" style={{ textAlign: "left" }}>{d.dueDate}</td>
                    <td className="num">{money(d.total)}</td><td className="num">{d.status === "void" ? "" : money(d.total - d.amountPaid)}</td>
                    <td><Pill kind={overdue ? "overdue" : d.status}>{overdue ? `${daysBetween(d.dueDate, today())} ${t("days_overdue")}` : t(statusKey[d.status])}</Pill></td>
                  </tr>
                );
              })}
              <tr className="total"><td colSpan={5}>{t("balance_due")}</td><td className="num">{money(due)}</td><td /></tr>
            </tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}

export async function DocForm({ kind, ctx, doc, lines, error }: { kind: DocKind; ctx: Ctx; doc?: DocRow; lines?: DLine[]; error: string }) {
  const { t, accName } = await getI18n();
  const o = await bookOptions(ctx.company.id, accName);
  const db = await getDb();
  const itemRows = await db.select().from(schema.items).where(and(eq(schema.items.companyId, ctx.company.id), eq(schema.items.isActive, true))).orderBy(schema.items.sku);
  const accId = (code: string) => o.accounts.find((a) => a.code === code)?.id ?? "";
  // Picking an item fills the price and the account: income on invoices; inventory (stock) or expense (services) on bills.
  const items: ItemOpt[] = itemRows.map((it) => ({
    id: it.id, label: `${it.sku} · ${it.name}`, name: it.name, unit: it.unit, stock: it.kind === "stock" ? it.qtyOnHand : null,
    price: kind === "invoice" ? it.salePrice : it.purchaseCost,
    accountId: accId(kind === "invoice" ? it.incomeAccount : it.kind === "stock" ? it.inventoryAccount : it.expenseAccount),
  }));
  const partners = o.partners.filter((p) => p.kind === "both" || p.kind === (kind === "invoice" ? "customer" : "supplier"));
  const vatRate = ctx.company.vatRegistered ? ctx.company.vatRate : 0;
  const defaultAcc = o.accounts.find((a) => a.code === (kind === "invoice" ? "4200" : "6900"))?.id ?? "";
  const accountTypes = kind === "invoice" ? ["income", "liability"] as const : ["expense", "asset"] as const;
  return (
    <div className="stack">
      <PageHead title={doc ? `${t(kind === "invoice" ? "inv_invoice" : "bill_bill")} ${doc.number}` : t(kind === "invoice" ? "inv_new" : "bill_new")}>
        {doc ? <Pill kind="draft">{t("st_draft")}</Pill> : null}
        <Link className="btn ghost" href={docBase(kind)}>{t("back")}</Link>
      </PageHead>
      <ErrorNote message={error} />
      {!partners.length ? <div className="note warn small"><Link href="/partners">{t("nav_partners")} →</Link></div> : null}
      <form action={saveDoc} className="panel stack">
        <input type="hidden" name="kind" value={kind} />
        {doc ? <input type="hidden" name="id" value={doc.id} /> : null}
        <div className="fields">
          <label className="f">{t(kind === "invoice" ? "customer" : "supplier")}
            <select id="partnerId" name="partnerId" defaultValue={doc?.partnerId ?? ""} required>
              <option value="">—</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="f">{t("date")}<input id="date" type="date" name="date" defaultValue={doc?.date ?? today()} required /></label>
          <label className="f">{t("due_date")}<input id="dueDate" type="date" name="dueDate" defaultValue={doc?.dueDate ?? addDays(today(), 30)} required /></label>
          <label className="f">{t("project")}
            <select id="projectId" name="projectId" defaultValue={doc?.projectId ?? ""}>
              <option value="">{t("none")}</option>
              {o.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </label>
          {kind === "bill" ? <>
            <label className="f">{t("supplier_ref")}<input id="supplierRef" name="supplierRef" defaultValue={doc?.supplierRef ?? ""} /></label>
            <label className="f">{t("wht_rate")}<input id="whtRate" name="whtRate" className="num" inputMode="decimal" defaultValue={doc?.whtRate ?? 0} /></label>
          </> : null}
        </div>
        <DocLinesEditor accounts={o.accountOpts} projects={o.projectOpts} initial={lines ?? []} vatRate={vatRate}
          accountTypes={accountTypes} defaultAccountId={defaultAcc} labels={docLabels(t)} items={items} />
        <label className="f">{t("notes")}<textarea id="notes" name="notes" rows={2} defaultValue={doc?.notes ?? ""} /></label>
        <div className="small muted">{t(kind === "invoice" ? "issued_note" : "approved_note")}{kind === "bill" ? ` ${t("wht_note")}` : ""}</div>
        <div className="row">
          <button type="submit" name="intent" value="post" className="btn primary">{t(kind === "invoice" ? "inv_issue" : "approve_bill")}</button>
          <button type="submit" name="intent" value="draft" className="btn">{t("save_draft")}</button>
          <span className="spacer" />
          {doc ? <ConfirmButton className="btn danger" formAction={deleteDocDraft} confirmLabel={t("confirm")}>{t("delete_draft")}</ConfirmButton> : null}
        </div>
      </form>
    </div>
  );
}

export async function DocView({ kind, ctx, doc, error }: { kind: DocKind; ctx: Ctx; doc: DocRow; error: string }) {
  const { t, money } = await getI18n();
  const db = await getDb();
  const lineTable = kind === "invoice" ? schema.invoiceLines : schema.billLines;
  const fk = kind === "invoice" ? schema.invoiceLines.invoiceId : schema.billLines.billId;
  const [lines, [partner], pays, moneyAccs] = await Promise.all([
    db.select().from(lineTable).where(eq(fk, doc.id)).orderBy(lineTable.lineNo),
    db.select().from(schema.partners).where(eq(schema.partners.id, doc.partnerId)),
    db.select({ p: schema.payments, acc: schema.accounts.nameEn }).from(schema.payments)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.payments.moneyAccountId))
      .where(kind === "invoice" ? eq(schema.payments.invoiceId, doc.id) : eq(schema.payments.billId, doc.id)).orderBy(schema.payments.date),
    moneyAccounts(db, ctx.company.id),
  ]);
  const balance = round2(doc.total - doc.amountPaid);
  const canPay = ctx.can(kind === "invoice" ? "sales" : "purchases", "write") && (doc.status === "open" || doc.status === "partial");
  return (
    <div className="stack">
      <PageHead title={`${t(kind === "invoice" ? "inv_invoice" : "bill_bill")} ${doc.number}`}>
        <Pill kind={doc.status}>{t(statusKey[doc.status])}</Pill>
        <Link className="btn ghost" href={docBase(kind)}>{t("back")}</Link>
      </PageHead>
      <ErrorNote message={error} />
      <div className="grid-doc">
        <div className="panel stack">
          <div>
            <div className="label">{t(kind === "invoice" ? "customer" : "supplier")}</div>
            <b>{partner?.name}</b>
            {partner?.tin ? <div className="small muted">{t("tin")} {partner.tin}</div> : null}
            {partner?.address ? <div className="small muted">{partner.address}</div> : null}
          </div>
          <div className="fields">
            <div><div className="label">{t("date")}</div>{doc.date}</div>
            <div><div className="label">{t("due_date")}</div>{doc.dueDate}</div>
            {doc.supplierRef ? <div><div className="label">{t("supplier_ref")}</div>{doc.supplierRef}</div> : null}
            {doc.whtRate ? <div><div className="label">{t("wht_rate")}</div>{doc.whtRate}%</div> : null}
          </div>
          {doc.entryId ? <Link href={`/journal/${doc.entryId}`} className="small">{t("open_entry")} →</Link> : null}
          {doc.attachmentId ? <a href={`/api/files/${doc.attachmentId}`} target="_blank" rel="noopener" className="small">{t("attachment")} →</a> : null}
          {kind === "invoice" && doc.status !== "void" ? (
            <div className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 12, gap: 10 }}>
              <div className="row">
                <h3 style={{ flex: 1 }}>{t("pdf_send_title")}</h3>
                <a className="btn sm" href={`/api/pdf/invoice/${doc.id}`} target="_blank" rel="noopener">{t("pdf_download")}</a>
              </div>
              {doc.sentAt ? <div className="note ok small">{t("pdf_sent_to")} {doc.sentTo} · {doc.sentAt.toISOString().slice(0, 16).replace("T", " ")}</div> : null}
              {ctx.can("sales", "write") ? (
                <form action={sendInvoiceEmail} className="stack" style={{ gap: 8 }}>
                  <input type="hidden" name="id" value={doc.id} />
                  <label className="f">{t("email")}<input id="send-to" name="to" type="email" defaultValue={doc.sentTo || partner?.email || ""} required /></label>
                  <label className="f">{t("pdf_message")}<textarea id="send-msg" name="message" rows={3} placeholder={t("pdf_message_default")} /></label>
                  <div><button type="submit" className="btn">{t("pdf_send")}</button></div>
                </form>
              ) : null}
            </div>
          ) : null}
          {canPay ? (
            <form action={payDocAction} className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <h3>{t(kind === "invoice" ? "receive_payment" : "pay_bill")}</h3>
              <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={doc.id} />
              <div className="fields">
                <label className="f">{t("date")}<input id="payDate" type="date" name="date" defaultValue={today()} required /></label>
                <label className="f">{t("amount")}<input id="payAmount" name="amount" className="num" inputMode="decimal" defaultValue={balance} required /></label>
                <label className="f">{t(kind === "invoice" ? "paid_into" : "paid_from")}
                  <select id="moneyAccountId" name="moneyAccountId" required>
                    {moneyAccs.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.nameEn}</option>)}
                  </select>
                </label>
                <label className="f">{t("reference")}<input id="payRef" name="reference" /></label>
              </div>
              <div><button type="submit" className="btn primary">{t("record_payment")}</button></div>
            </form>
          ) : null}
          {ctx.can(kind === "invoice" ? "sales" : "purchases", "write") && doc.status !== "void" && doc.amountPaid === 0 ? (
            <form action={voidDocAction}>
              <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={doc.id} />
              <ConfirmButton className="btn danger sm" confirmLabel={t("confirm")}>{t("void_doc")}</ConfirmButton>
            </form>
          ) : null}
        </div>
        <div className="panel stack">
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("description")}</th><th className="num">{t("qty")}</th><th className="num">{t("unit_price")}</th><th>{t("vat")}</th><th className="num">{t("amount")}</th></tr></thead>
            <tbody>
              {lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitPrice, 2)}</td><td>{l.vatApplies ? "✓" : ""}</td><td className="num">{money(l.amount, 2)}</td></tr>)}
              <tr><td colSpan={4} className="num">{t("subtotal")}</td><td className="num">{money(doc.subtotal, 2)}</td></tr>
              <tr><td colSpan={4} className="num">{t("vat")}</td><td className="num">{money(doc.vat, 2)}</td></tr>
              <tr className="total"><td colSpan={4} className="num">{t("total")}</td><td className="num">{money(doc.total, 2)}</td></tr>
              <tr><td colSpan={4} className="num">{t("amount_paid")}</td><td className="num">{money(doc.amountPaid, 2)}</td></tr>
              <tr className="total"><td colSpan={4} className="num">{t("balance_due")}</td><td className="num">{money(balance, 2)}</td></tr>
            </tbody>
          </table></div>
          {doc.notes ? <div className="small">{doc.notes}</div> : null}
          {pays.length ? (
            <div className="stack" style={{ gap: 8 }}>
              <h3>{t("payments")}</h3>
              <table><tbody>
                {pays.map(({ p, acc }) => (
                  <tr key={p.id}><td className="num" style={{ textAlign: "left" }}>{p.date}</td><td>{acc}{p.reference ? ` · ${p.reference}` : ""}</td>
                    <td className="num">{money(p.amount, 2)}</td><td className="small muted">{p.wht ? `${t("wht")} ${money(p.wht, 2)}` : ""}</td>
                    <td><Link href={`/journal/${p.entryId}`} className="small">→</Link></td></tr>
                ))}
              </tbody></table>
            </div>
          ) : null}
          {!pays.length && !lines.length ? <Empty>{t("nothing_yet")}</Empty> : null}
        </div>
      </div>
    </div>
  );
}

/** The page for one document: an editable form while it is a draft, the posted view afterwards. */
export async function DocPage({ kind, ctx, id, error }: { kind: DocKind; ctx: Ctx; id: string; error: string }) {
  const db = await getDb();
  const doc = kind === "invoice"
    ? (await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.companyId, ctx.company.id))))[0]
    : (await db.select().from(schema.bills).where(and(eq(schema.bills.id, id), eq(schema.bills.companyId, ctx.company.id))))[0];
  if (!doc) return null;
  if (doc.status === "draft" && ctx.can(kind === "invoice" ? "sales" : "purchases", "write")) {
    const lineTable = kind === "invoice" ? schema.invoiceLines : schema.billLines;
    const fk = kind === "invoice" ? schema.invoiceLines.invoiceId : schema.billLines.billId;
    const lines = await db.select().from(lineTable).where(eq(fk, id)).orderBy(lineTable.lineNo);
    return <DocForm kind={kind} ctx={ctx} doc={doc} error={error} lines={lines.map((l) => ({
      description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatApplies: l.vatApplies, accountId: l.accountId, projectId: l.projectId ?? "", itemId: l.itemId ?? "",
    }))} />;
  }
  return <DocView kind={kind} ctx={ctx} doc={doc} error={error} />;
}

