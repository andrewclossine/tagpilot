"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { getDb, schema } from "@/db";
import type { EsignFieldType } from "@/db/schema";
import { requireWrite } from "@/lib/auth";
import { fail, withParam } from "@/lib/actions";
import { str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { nextNumber } from "@/lib/numbering";
import { saveAttachment, MAX_UPLOAD } from "@/lib/storage";
import { FIELD_TYPES, invite, loadDoc, logEvent, newToken, requestMeta, sha256, whoseTurn } from "@/lib/esign";
import { assertEsignSend } from "@/lib/limits";

const BASE = "/esign";
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const frac = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0));

/** Uploads a PDF to be signed and opens it to place the signers and their fields. */
export async function createEsign(fd: FormData) {
  const ctx = await requireWrite("esign");
  let id = "";
  try {
    const file = fd.get("file");
    const title = str(fd, "title").slice(0, 200);
    if (!(file instanceof File) || !file.size) throw new UserError("err_es_file");
    if (file.size > MAX_UPLOAD) throw new UserError("err_file_too_big");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new UserError("err_es_pdf");
    let pages: { w: number; h: number }[];
    try {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      pages = pdf.getPages().map((p) => { const s = p.getSize(); return { w: Math.round(s.width * 100) / 100, h: Math.round(s.height * 100) / 100 }; });
    } catch { throw new UserError("err_es_pdf"); }
    if (!pages.length) throw new UserError("err_es_pdf");
    const saved = await saveAttachment(ctx.company.id, ctx.user.id, new File([bytes], file.name || "document.pdf", { type: "application/pdf" }));
    const db = await getDb();
    const meta = await requestMeta();
    id = await db.transaction(async (tx) => {
      const number = await nextNumber(tx, schema.esignDocuments, { number: schema.esignDocuments.number, companyId: schema.esignDocuments.companyId }, ctx.company.id, "ES");
      const [doc] = await tx.insert(schema.esignDocuments).values({
        companyId: ctx.company.id, number, title: title || file.name.replace(/\.pdf$/i, "") || number, originalAttachmentId: saved.id,
        originalHash: sha256(bytes), pages, createdBy: ctx.user.id,
      }).returning({ id: schema.esignDocuments.id });
      await logEvent(tx, doc.id, "created", { userId: ctx.user.id, ...meta, detail: `${pages.length} pages` });
      return doc.id;
    });
  } catch (e) { fail(e, `${BASE}/new`); }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}`);
}

type Draft = {
  title: string; message: string; ordered: boolean;
  signers: { key: string; name: string; email: string; order: number }[];
  fields: { signer: string; type: string; page: number; x: number; y: number; w: number; h: number; required: boolean; label: string }[];
};

/** Saves the prepared document: its signers and where each signs. With "send", it goes out to the first to sign. */
export async function saveEsignDraft(fd: FormData) {
  const ctx = await requireWrite("esign");
  const id = str(fd, "id"), send = str(fd, "intent") === "send";
  try {
    let d: Draft;
    try { d = JSON.parse(str(fd, "draft")); } catch { throw new UserError("err_required"); }
    const db = await getDb();
    const meta = await requestMeta();
    await db.transaction(async (tx) => {
      const loaded = await loadDoc(tx, ctx.company.id, id);
      if (!loaded) throw new UserError("err_not_found");
      if (loaded.doc.status !== "draft") throw new UserError("err_voucher_state");
      const pageCount = loaded.doc.pages.length;
      const signers = (d.signers ?? []).slice(0, 30).map((s, i) => ({ key: String(s.key), name: String(s.name ?? "").trim().slice(0, 120), email: String(s.email ?? "").trim().toLowerCase().slice(0, 200), order: d.ordered ? Math.max(1, Math.trunc(Number(s.order) || i + 1)) : 1 }));
      const fields = (d.fields ?? []).slice(0, 500).filter((f) => FIELD_TYPES.includes(f.type as EsignFieldType) && signers.some((s) => s.key === String(f.signer)) && f.page >= 1 && f.page <= pageCount);
      if (send) {
        await assertEsignSend(tx, ctx);
        if (!signers.length) throw new UserError("err_es_no_signers");
        if (signers.some((s) => !s.name)) throw new UserError("err_es_signer_name");
        if (signers.some((s) => s.email && !isEmail(s.email))) throw new UserError("err_email_invalid");
        if (signers.some((s) => !fields.some((f) => String(f.signer) === s.key && f.type === "signature"))) throw new UserError("err_es_no_signature");
      }
      await tx.update(schema.esignDocuments).set({ title: String(d.title ?? "").trim().slice(0, 200) || loaded.doc.title, message: String(d.message ?? "").slice(0, 2000), ordered: !!d.ordered })
        .where(eq(schema.esignDocuments.id, id));
      // A draft's signers have no link in use yet: they are written afresh each time it is saved.
      await tx.delete(schema.esignSigners).where(eq(schema.esignSigners.documentId, id));
      const keyToId = new Map<string, string>();
      for (const s of signers.filter((x) => x.name || x.email)) {
        const [row] = await tx.insert(schema.esignSigners).values({ documentId: id, name: s.name || s.email, email: s.email, order: s.order, token: newToken() }).returning({ id: schema.esignSigners.id });
        keyToId.set(s.key, row.id);
      }
      const rows = fields.filter((f) => keyToId.has(String(f.signer))).map((f) => ({
        documentId: id, signerId: keyToId.get(String(f.signer))!, type: f.type as EsignFieldType, page: Math.trunc(f.page),
        x: frac(f.x), y: frac(f.y), w: Math.max(0.01, frac(f.w)), h: Math.max(0.01, frac(f.h)), required: f.type === "checkbox" ? !!f.required : f.required !== false, label: String(f.label ?? "").slice(0, 80),
      }));
      if (rows.length) await tx.insert(schema.esignFields).values(rows);
      if (send) {
        await tx.update(schema.esignDocuments).set({ status: "sent", sentAt: new Date() }).where(eq(schema.esignDocuments.id, id));
        await logEvent(tx, id, "sent", { userId: ctx.user.id, ...meta, detail: `${keyToId.size} signers` });
        const fresh = await loadDoc(tx, ctx.company.id, id);
        await invite(tx, fresh!.doc, ctx.company, ctx.user, whoseTurn(fresh!.doc, fresh!.signers), { ...meta, userId: ctx.user.id });
      }
    });
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?${send ? "sent" : "saved"}=1`);
}

/** Sends a signer their link again. */
export async function remindSigner(fd: FormData) {
  const ctx = await requireWrite("esign");
  const id = str(fd, "id"), signerId = str(fd, "signerId");
  try {
    const db = await getDb();
    const loaded = await loadDoc(db, ctx.company.id, id);
    if (!loaded || loaded.doc.status !== "sent") throw new UserError("err_voucher_state");
    const s = loaded.signers.find((x) => x.id === signerId);
    if (!s || s.status === "signed" || s.status === "declined") throw new UserError("err_voucher_state");
    if (!whoseTurn(loaded.doc, loaded.signers).some((x) => x.id === s.id)) throw new UserError("err_es_not_turn");
    await invite(db, loaded.doc, ctx.company, ctx.user, [s], { ...(await requestMeta()), userId: ctx.user.id });
  } catch (e) { fail(e, `${BASE}/${id}`); }
  redirect(`${BASE}/${id}?reminded=1`);
}

/** Withdraws a document sent for signature: its links stop working. */
export async function voidEsign(fd: FormData) {
  const ctx = await requireWrite("esign");
  const id = str(fd, "id");
  try {
    const db = await getDb();
    const loaded = await loadDoc(db, ctx.company.id, id);
    if (!loaded || loaded.doc.status !== "sent") throw new UserError("err_voucher_state");
    const reason = str(fd, "reason").slice(0, 300);
    await db.update(schema.esignDocuments).set({ status: "voided", voidReason: reason }).where(eq(schema.esignDocuments.id, id));
    await logEvent(db, id, "voided", { userId: ctx.user.id, ...(await requestMeta()), detail: reason });
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}`);
}

/** Deletes a draft, or a document that was voided or declined. Signed documents are kept. */
export async function deleteEsign(fd: FormData) {
  const ctx = await requireWrite("esign");
  const id = str(fd, "id");
  try {
    const db = await getDb();
    const loaded = await loadDoc(db, ctx.company.id, id);
    if (!loaded || !["draft", "voided", "declined"].includes(loaded.doc.status)) throw new UserError("err_voucher_state");
    await db.delete(schema.esignDocuments).where(and(eq(schema.esignDocuments.id, id), inArray(schema.esignDocuments.status, ["draft", "voided", "declined"])));
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  redirect(withParam(BASE, "deleted", "1"));
}
