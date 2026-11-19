"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail, withParam } from "@/lib/actions";
import { computeTotals, saveDocDraft } from "@/lib/documents";
import { isIsoDate, isUuid, str, today } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { nextNumber } from "@/lib/numbering";
import { parseDocLines } from "@/lib/parse";
import { audit } from "@/lib/audit";
import { getI18n } from "@/lib/i18n";
import { mailConfigured, sendMail } from "@/lib/mail";
import { buildProformaPdf } from "@/lib/pdf-data";

const BASE = "/sales/proformas";
const vatOf = (c: { vatRegistered: boolean; vatRate: number }) => (c.vatRegistered ? c.vatRate : 0);
/** A proforma can change until it is invoiced or cancelled. */
const LIVE = ["draft", "open", "sent"];
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const html = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)).replace(/\n/g, "<br>");

async function lockProforma(tx: Tx, companyId: string, id: string) {
  if (!isUuid(id)) throw new UserError("err_not_found");
  const [p] = await tx.select().from(schema.proformas).where(and(eq(schema.proformas.id, id), eq(schema.proformas.companyId, companyId))).for("update");
  if (!p) throw new UserError("err_not_found");
  return p;
}

/**
 * Saves a proforma. It books nothing, so it can change freely while it is a draft. Once sent to the customer, a
 * change is a revision: what was sent is kept with the reason (a negotiated price), the revision number goes up, and
 * the proforma waits to be sent again.
 */
export async function saveProforma(fd: FormData) {
  const ctx = await requireWrite("sales");
  const id = str(fd, "id"), back = id ? `${BASE}/${id}?edit=1` : `${BASE}/new`;
  let savedId = id;
  try {
    const partnerId = str(fd, "partnerId"), date = str(fd, "date"), validUntil = str(fd, "validUntil");
    if (!isUuid(partnerId) || !isIsoDate(date) || !isIsoDate(validUntil)) throw new UserError("err_required");
    const parsed = parseDocLines(fd);
    const totals = computeTotals(parsed, vatOf(ctx.company));
    const db = await getDb();
    const [partner] = await db.select({ id: schema.partners.id }).from(schema.partners).where(and(eq(schema.partners.id, partnerId), eq(schema.partners.companyId, ctx.company.id)));
    if (!partner) throw new UserError("err_not_found");
    const values = { partnerId, date, validUntil, notes: str(fd, "notes"), projectId: str(fd, "projectId") || null, subtotal: totals.subtotal, vat: totals.vat, total: totals.total };
    savedId = await db.transaction(async (tx) => {
      let pid = id;
      if (pid) {
        const old = await lockProforma(tx, ctx.company.id, pid);
        if (!LIVE.includes(old.status)) throw new UserError("err_voucher_state");
        if (old.status === "sent") {
          const reason = str(fd, "reason").slice(0, 500);
          if (!reason) throw new UserError("err_pf_reason");
          const oldLines = await tx.select().from(schema.proformaLines).where(eq(schema.proformaLines.proformaId, pid)).orderBy(schema.proformaLines.lineNo);
          await tx.insert(schema.proformaRevisions).values({
            proformaId: pid, revision: old.revision, reason, createdBy: ctx.user.id,
            snapshot: { date: old.date, validUntil: old.validUntil, subtotal: old.subtotal, vat: old.vat, total: old.total, sentAt: old.sentAt?.toISOString() ?? null, sentTo: old.sentTo,
              lines: oldLines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, vatApplies: l.vatApplies, amount: l.amount })) },
          });
          await tx.update(schema.proformas).set({ ...values, revision: old.revision + 1, status: "draft", sentAt: null, sentTo: "" }).where(eq(schema.proformas.id, pid));
          await audit(tx, ctx.company.id, ctx.user.id, "revise", "proforma", old.number, { revision: old.revision + 1, reason, from: old.total, to: totals.total });
        } else {
          await tx.update(schema.proformas).set({ ...values, status: "draft" }).where(eq(schema.proformas.id, pid));
        }
        await tx.delete(schema.proformaLines).where(eq(schema.proformaLines.proformaId, pid));
      } else {
        const number = await nextNumber(tx, schema.proformas, { number: schema.proformas.number, companyId: schema.proformas.companyId }, ctx.company.id, "PRO");
        const [row] = await tx.insert(schema.proformas).values({ ...values, companyId: ctx.company.id, number, status: "draft" }).returning({ id: schema.proformas.id });
        pid = row.id;
        await audit(tx, ctx.company.id, ctx.user.id, "create", "proforma", number, { total: totals.total });
      }
      await tx.insert(schema.proformaLines).values(totals.lines.map((l, i) => ({
        proformaId: pid, lineNo: i + 1, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, vatApplies: l.vatApplies,
        accountId: l.accountId, projectId: l.projectId || values.projectId, itemId: l.itemId || null, amount: l.amount,
      })));
      return pid;
    });
  } catch (e) { fail(e, back); }
  revalidatePath(BASE);
  redirect(`${BASE}/${savedId}?saved=1`);
}

/** Submits the proforma to the customer by email, with its PDF attached. */
export async function sendProformaEmail(fd: FormData) {
  const ctx = await requireWrite("sales");
  const id = str(fd, "id"), back = `${BASE}/${id}`;
  const to = str(fd, "to").toLowerCase();
  const { t, money } = await getI18n();
  try {
    if (!isEmail(to)) throw new UserError("err_email_invalid");
    if (!mailConfigured() && process.env.NODE_ENV === "production") throw new UserError("err_mail_off");
    const db = await getDb();
    const [p] = await db.select().from(schema.proformas).where(and(eq(schema.proformas.id, id), eq(schema.proformas.companyId, ctx.company.id)));
    if (!p || !LIVE.includes(p.status)) throw new UserError("err_voucher_state");
    const [customer] = await db.select().from(schema.partners).where(eq(schema.partners.id, p.partnerId));
    const { pdf, filename } = await buildProformaPdf(ctx, id);
    const ref = p.revision ? `${p.number} Rev. ${p.revision}` : p.number;
    const message = str(fd, "message") || `${t("pf_mail_body")} ${ref} (${money(p.total, 2)} ${ctx.company.currency}, ${t("pf_valid_until").toLowerCase()} ${p.validUntil}).`;
    await sendMail(to, `${t("pf_proforma")} ${ref} - ${ctx.company.name}`,
      `${t("reset_mail_hello")} ${customer.name},\n\n${message}\n\n${ctx.company.name}`,
      `<p>${t("reset_mail_hello")} ${html(customer.name)},</p><p>${html(message)}</p><p>${html(ctx.company.name)}</p>`,
      [{ filename, content: pdf, contentType: "application/pdf" }]);
    await db.update(schema.proformas).set({ status: "sent", sentAt: new Date(), sentTo: to }).where(eq(schema.proformas.id, id));
    if (!customer.email) await db.update(schema.partners).set({ email: to }).where(eq(schema.partners.id, customer.id));
    await audit(db, ctx.company.id, ctx.user.id, "email", "proforma", ref, { to });
  } catch (e) { fail(e, back); }
  revalidatePath(BASE);
  redirect(withParam(back, "sent", to));
}

/** The proforma was handed over another way (printed, WhatsApp): it is recorded as submitted. */
export async function markProformaSent(fd: FormData) {
  const ctx = await requireWrite("sales");
  const id = str(fd, "id"), back = `${BASE}/${id}`;
  try {
    const db = await getDb();
    await db.transaction(async (tx) => {
      const p = await lockProforma(tx, ctx.company.id, id);
      if (!LIVE.includes(p.status)) throw new UserError("err_voucher_state");
      const how = str(fd, "how").slice(0, 120);
      await tx.update(schema.proformas).set({ status: "sent", sentAt: new Date(), sentTo: how }).where(eq(schema.proformas.id, id));
      await audit(tx, ctx.company.id, ctx.user.id, "submit", "proforma", p.number, { how });
    });
  } catch (e) { fail(e, back); }
  revalidatePath(BASE);
  redirect(`${back}?saved=1`);
}

/** The goods were delivered or the service rendered: the proforma becomes a draft invoice, to check and issue. */
export async function convertProforma(fd: FormData) {
  const ctx = await requireWrite("sales");
  const id = str(fd, "id");
  let invoiceId = "";
  try {
    const db = await getDb();
    invoiceId = await db.transaction(async (tx) => {
      const p = await lockProforma(tx, ctx.company.id, id);
      if (!LIVE.includes(p.status)) throw new UserError("err_voucher_state");
      const lines = await tx.select().from(schema.proformaLines).where(eq(schema.proformaLines.proformaId, id)).orderBy(schema.proformaLines.lineNo);
      const date = today();
      const ref = p.revision ? `${p.number} Rev. ${p.revision}` : p.number;
      const inv = await saveDocDraft(tx, "invoice", ctx.company.id, ctx.user.id, undefined, {
        partnerId: p.partnerId, date, dueDate: p.validUntil > date ? p.validUntil : date, notes: [ref, p.notes].filter(Boolean).join(" · "), projectId: p.projectId,
      }, lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, vatApplies: l.vatApplies, accountId: l.accountId, projectId: l.projectId, itemId: l.itemId })), vatOf(ctx.company));
      await tx.update(schema.proformas).set({ status: "converted", invoiceId: inv }).where(eq(schema.proformas.id, id));
      await audit(tx, ctx.company.id, ctx.user.id, "convert", "proforma", ref, { invoice: inv });
      return inv;
    });
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  revalidatePath("/sales/invoices");
  redirect(`/sales/invoices/${invoiceId}`);
}

export async function cancelProforma(fd: FormData) {
  const ctx = await requireWrite("sales");
  const id = str(fd, "id");
  try {
    const db = await getDb();
    await db.transaction(async (tx) => {
      const p = await lockProforma(tx, ctx.company.id, id);
      if (!LIVE.includes(p.status)) throw new UserError("err_voucher_state");
      await tx.update(schema.proformas).set({ status: "cancelled" }).where(eq(schema.proformas.id, id));
      await audit(tx, ctx.company.id, ctx.user.id, "cancel", "proforma", p.number);
    });
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}`);
}
