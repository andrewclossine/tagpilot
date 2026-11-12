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
import { PartnerPicker } from "./PartnerPicker";
import { Empty, ErrorNote, PageHead, Pill, Tabs } from "./ui";
import { createCreditNote, deleteDocDraft, payDocAction, saveDoc, voidCreditNoteAction, voidDocAction } from "@/app/(app)/doc-actions";
import { creditableLines } from "@/lib/credit-notes";
import { sendInvoiceEmail } from "@/app/(app)/send-actions";

export const docBase = (kind: DocKind) => (kind === "invoice" ? "/sales/invoices" : "/purchases/bills");
const statusKey = { draft: "st_draft", open: "st_open", partial: "st_partial", paid: "st_paid", void: "st_void" } as const;

type DocRow = Omit<typeof schema.invoices.$inferSelect, "sentAt" | "sentTo" | "docType"> & Partial<Pick<typeof schema.invoices.$inferSelect, "sentAt" | "sentTo" | "docType">> & Partial<Pick<typeof schema.bills.$inferSelect, "supplierRef" | "whtRate" | "attachmentId">>;

async function loadDocs(kind: DocKind, companyId: string, statuses?: string[], receipts = false) {
  const db = await getDb();
  const doc = kind === "invoice" ? schema.invoices : schema.bills;
  const conds = [eq(doc.companyId, companyId)];
  if (kind === "invoice") conds.push(eq(schema.invoices.docType, receipts ? "receipt" : "invoice"));
  if (statuses) conds.push(inArray(doc.status, statuses as ("draft" | "open" | "partial" | "paid" | "void")[]));
  return db.select({ d: doc, partner: schema.partners.name }).from(doc)
    .innerJoin(schema.partners, eq(schema.partners.id, doc.partnerId))
    .where(and(...conds)).orderBy(desc(doc.date), desc(doc.createdAt)).limit(500);
}

export async function DocList({ kind, ctx, status, receipts = false }: { kind: DocKind; ctx: Ctx; status: string; receipts?: boolean }) {
  const { t, money } = await getI18n();
  const base = docBase(kind);
  const filter = status === "unpaid" ? ["open", "partial"] : status && status in statusKey ? [status] : undefined;
  const rows = await loadDocs(kind, ctx.company.id, filter, receipts);
  const due = rows.reduce((s, r) => s + (r.d.status === "open" || r.d.status === "partial" ? r.d.total - r.d.amountPaid : 0), 0);
  return (
    <div className="stack">
      <PageHead title={t(receipts ? "sr_title" : kind === "invoice" ? "inv_title" : "bill_title")}>
        {receipts ? null : <Link className="btn" href={kind === "invoice" ? "/reports/ar" : "/reports/ap"}>{t(kind === "invoice" ? "r_ar" : "r_ap")}</Link>}
        {ctx.can(kind === "invoice" ? "sales" : "purchases", "write") ? <Link className="btn primary" href={receipts ? "/sales/receipts/new" : `${base}/new`}>{t(receipts ? "sr_new" : kind === "invoice" ? "inv_new" : "bill_new")}</Link> : null}
      </PageHead>
      {receipts ? null : <Tabs current={status || "all"} items={[
        { key: "all", href: base, label: t("all") },
        { key: "draft", href: `${base}?status=draft`, label: t("st_draft") },
        { key: "unpaid", href: `${base}?status=unpaid`, label: t("st_open") },
        { key: "paid", href: `${base}?status=paid`, label: t("st_paid") },
      ]} />}
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

export async function DocForm({ kind, ctx, doc, lines, error, receipt = false }: { kind: DocKind; ctx: Ctx; doc?: DocRow; lines?: DLine[]; error: string; receipt?: boolean }) {
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
  const moneyAccs = receipt ? (await moneyAccounts(db, ctx.company.id)).filter((a) => !a.currency) : [];
  return (
    <div className="stack">
      <PageHead title={receipt ? t("sr_new") : doc ? `${t(kind === "invoice" ? "inv_invoice" : "bill_bill")} ${doc.number}` : t(kind === "invoice" ? "inv_new" : "bill_new")}>
        {doc ? <Pill kind="draft">{t("st_draft")}</Pill> : null}
        <Link className="btn ghost" href={receipt ? "/sales/receipts" : docBase(kind)}>{t("back")}</Link>
      </PageHead>
      <ErrorNote message={error} />
      {doc && kind === "invoice" ? await creditWarning(ctx.company.id, doc.partnerId, doc.total, doc.id) : null}
      <form action={saveDoc} className="panel stack">
        <input type="hidden" name="kind" value={kind} />
        {doc ? <input type="hidden" name="id" value={doc.id} /> : null}
        <div className="fields">
          <label className="f">{t(kind === "invoice" ? "customer" : "supplier")}
            <PartnerPicker kind={kind === "invoice" ? "customer" : "supplier"} options={partners.map((p) => ({ id: p.id, name: p.name, terms: p.paymentTerms }))} defaultValue={doc?.partnerId ?? ""} canAdd={ctx.can("partners", "write")}
              labels={kind === "invoice" ? { add: t("cust_add_new"), title: t("cust_add_new_title"), name: t("name"), tin: t("tin"), phone: t("phone"), email: t("email"), save: t("save"), cancel: t("cancel") } : { add: t("supp_add_new"), title: t("supp_add_new_title"), name: t("name"), tin: t("tin"), phone: t("phone"), email: t("email"), save: t("save"), cancel: t("cancel") }} />
          </label>
          <label className="f">{t("date")}<input id="date" type="date" name="date" defaultValue={doc?.date ?? today()} required /></label>
          {receipt ? <>
            <label className="f">{t("paid_into")}
              <select id="moneyAccountId" name="moneyAccountId" required>{moneyAccs.map((a) => <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>)}</select></label>
            <label className="f">{t("reference")}<input id="payReference" name="payReference" /></label>
          </> : <label className="f">{t("due_date")}<input id="dueDate" type="date" name="dueDate" defaultValue={doc?.dueDate ?? addDays(today(), 30)} required /></label>}
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
        <div className="small muted">{receipt ? t("sr_note") : <>{t(kind === "invoice" ? "issued_note" : "approved_note")}{kind === "bill" ? ` ${t("wht_note")}` : ""}</>}</div>
        <div className="row">
          {receipt ? <button type="submit" name="intent" value="receipt" className="btn primary">{t("sr_save")}</button> : <>
            <button type="submit" name="intent" value="post" className="btn primary">{t(kind === "invoice" ? "inv_issue" : "approve_bill")}</button>
            <button type="submit" name="intent" value="draft" className="btn">{t("save_draft")}</button>
          </>}
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
  const [notes, creditable] = await Promise.all([
    db.select().from(schema.creditNotes).where(kind === "invoice" ? eq(schema.creditNotes.invoiceId, doc.id) : eq(schema.creditNotes.billId, doc.id)).orderBy(schema.creditNotes.date),
    creditableLines(db, kind, doc.id),
  ]);
  const credited = round2(notes.filter((n) => n.status === "posted").reduce((s, n) => s + n.total, 0));
  const isReceipt = kind === "invoice" && doc.docType === "receipt";
  const balance = round2(doc.total - doc.amountPaid);
  const canPay = ctx.can(kind === "invoice" ? "sales" : "purchases", "write") && (doc.status === "open" || doc.status === "partial");
  return (
    <div className="stack">
      <PageHead title={`${t(isReceipt ? "sr_receipt" : kind === "invoice" ? "inv_invoice" : "bill_bill")} ${doc.number}`}>
        <Pill kind={doc.status}>{t(statusKey[doc.status])}</Pill>
        <Link className="btn ghost" href={isReceipt ? "/sales/receipts" : docBase(kind)}>{t("back")}</Link>
      </PageHead>
      <ErrorNote message={error} />
      {kind === "invoice" && (doc.status === "open" || doc.status === "partial") ? await creditWarning(ctx.company.id, doc.partnerId, 0, doc.id) : null}
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
              {credited ? <tr><td colSpan={4} className="num">{t("cn_credited")}</td><td className="num">{money(credited, 2)}</td></tr> : null}
              <tr><td colSpan={4} className="num">{t("amount_paid")}</td><td className="num">{money(round2(doc.amountPaid - credited), 2)}</td></tr>
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
          {notes.length || canPay ? (
            <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }} id="credit-notes">
              <h3>{t("cn_title")}</h3>
              {notes.length ? (
                <table><tbody>
                  {notes.map((n) => (
                    <tr key={n.id} style={n.status === "void" ? { opacity: 0.55 } : undefined}>
                      <td><a href={`/api/pdf/credit-note/${n.id}`} target="_blank" rel="noopener"><b>{n.number}</b></a>{n.status === "void" ? ` · ${t("st_void")}` : ""}</td>
                      <td className="num" style={{ textAlign: "left" }}>{n.date}</td><td className="small">{n.reason}</td>
                      <td className="num">{money(n.total, 2)}</td>
                      <td>{n.entryId ? <Link href={`/journal/${n.entryId}`} className="small">→</Link> : null}</td>
                      <td>{n.status === "posted" && ctx.can(kind === "invoice" ? "sales" : "purchases", "write") ? (
                        <form action={voidCreditNoteAction}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={doc.id} /><input type="hidden" name="creditNoteId" value={n.id} />
                          <ConfirmButton className="btn sm ghost danger" confirmLabel={t("confirm")}>{t("void_doc")}</ConfirmButton></form>
                      ) : null}</td>
                    </tr>
                  ))}
                </tbody></table>
              ) : null}
              {canPay && !isReceipt ? (
                <details>
                  <summary className="btn sm" style={{ display: "inline-block" }}>{t("cn_new")}</summary>
                  <form action={createCreditNote} className="stack" style={{ marginTop: 10 }}>
                    <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={doc.id} />
                    <div className="small muted">{t(kind === "invoice" ? "cn_help_invoice" : "cn_help_bill")}</div>
                    <div className="tbl-wrap"><table>
                      <thead><tr><th>{t("description")}</th><th className="num">{t("amount")}</th><th className="num">{t("cn_left")}</th><th className="num">{t("cn_amount")}</th></tr></thead>
                      <tbody>{creditable.map((l) => (
                        <tr key={l.id}><td>{l.description}{l.isStock ? <div className="small muted">{t("cn_stock_line")}</div> : null}</td><td className="num">{money(l.amount, 2)}</td><td className="num">{money(l.left, 2)}</td>
                          <td>{l.isStock || l.left <= 0 ? null : <input name={`credit_${l.lineNo}`} className="num" style={{ width: 120 }} inputMode="decimal" aria-label={`${t("cn_amount")} ${l.description}`} />}</td></tr>
                      ))}</tbody>
                    </table></div>
                    <div className="fields">
                      <label className="f">{t("date")}<input type="date" name="date" defaultValue={today()} required /></label>
                      {kind === "bill" ? <label className="f">{t("cn_supplier_ref")}<input name="supplierRef" /></label> : null}
                    </div>
                    <label className="f">{t("cn_reason")}<input name="reason" required placeholder={t("cn_reason_example")} /></label>
                    <div><button type="submit" className="btn primary">{t("cn_post")}</button></div>
                  </form>
                </details>
              ) : null}
            </div>
          ) : null}
          {!pays.length && !lines.length ? <Empty>{t("nothing_yet")}</Empty> : null}
        </div>
      </div>
    </div>
  );
}

/** The page for one document: an editable form while it is a draft, the posted view afterwards. */
/** A warning when a customer would owe more than their credit limit. It does not stop the invoice: the person decides. */
async function creditWarning(companyId: string, partnerId: string, extra: number, docId: string) {
  const { t, money } = await getI18n();
  const db = await getDb();
  const [p] = await db.select().from(schema.partners).where(and(eq(schema.partners.id, partnerId), eq(schema.partners.companyId, companyId)));
  if (!p || !(p.creditLimit > 0)) return null;
  const open = await db.select({ total: schema.invoices.total, paid: schema.invoices.amountPaid, id: schema.invoices.id }).from(schema.invoices)
    .where(and(eq(schema.invoices.companyId, companyId), eq(schema.invoices.partnerId, partnerId), inArray(schema.invoices.status, ["open", "partial"])));
  const owed = round2(open.filter((x) => x.id !== docId || !extra).reduce((s, x) => s + x.total - x.paid, 0) + extra);
  if (owed <= p.creditLimit) return null;
  return <div className="note warn small">{t("pt_over_limit").replace("{name}", p.name).replace("{owed}", money(owed)).replace("{limit}", money(p.creditLimit))}</div>;
}

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

