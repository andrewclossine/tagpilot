import "server-only";
import crypto from "node:crypto";
import { headers } from "next/headers";
import { and, asc, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getDb, schema, type Db, type Tx } from "@/db";
import type { EsignFieldType } from "@/db/schema";
import { readAttachment, saveAttachment } from "./storage";
import { mailConfigured, sendMail } from "./mail";
import { localDateTime, timeZoneOf } from "./format";

export type EsignDoc = typeof schema.esignDocuments.$inferSelect;
export type EsignSigner = typeof schema.esignSigners.$inferSelect;
export type EsignField = typeof schema.esignFields.$inferSelect;

/** The colour each signer's fields wear on screen, by their place in the list. */
export const SIGNER_COLORS = ["#2563eb", "#c2410c", "#0f766e", "#7c3aed", "#be123c", "#4d7c0f", "#a16207", "#0369a1"];
export const FIELD_TYPES: EsignFieldType[] = ["signature", "initials", "date", "name", "text", "checkbox"];

export const newToken = () => crypto.randomBytes(24).toString("base64url");
export const sha256 = (b: Buffer | Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");
export const signLink = (token: string) => `${(process.env.APP_URL || "").replace(/\/$/, "")}/sign/${token}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)).replace(/\n/g, "<br>");

/** Where a request comes from, for the audit trail. */
export async function requestMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  return { ip: ip.slice(0, 64), userAgent: (h.get("user-agent") ?? "").slice(0, 300) };
}

export async function logEvent(db: Db | Tx, documentId: string, action: string, o: { signerId?: string | null; userId?: string | null; ip?: string; userAgent?: string; detail?: string } = {}) {
  await db.insert(schema.esignEvents).values({ documentId, action, signerId: o.signerId ?? null, userId: o.userId ?? null, ip: o.ip ?? "", userAgent: o.userAgent ?? "", detail: (o.detail ?? "").slice(0, 500) });
}

/** Who is to sign now: everyone not yet signed when order does not matter, else the first in order not yet signed. */
export function whoseTurn(doc: Pick<EsignDoc, "ordered">, signers: EsignSigner[]) {
  const left = signers.filter((s) => s.status !== "signed").sort((a, b) => a.order - b.order);
  if (!doc.ordered) return left;
  return left.length ? left.filter((s) => s.order === left[0].order) : [];
}

/**
 * Invites signers by email with their private link. Without an email server the invitation is still recorded, and
 * the sender shares each link from the document page (WhatsApp, SMS).
 */
export async function invite(db: Db | Tx, doc: EsignDoc, company: { name: string }, sender: { name: string }, list: EsignSigner[], meta: { ip: string; userAgent: string; userId?: string }) {
  const mail = mailConfigured() || process.env.NODE_ENV !== "production";
  for (const s of list) {
    await db.update(schema.esignSigners).set({ status: s.status === "viewed" ? "viewed" : "sent", sentAt: new Date() }).where(eq(schema.esignSigners.id, s.id));
    let emailed = false;
    if (mail && s.email) {
      const link = signLink(s.token);
      const body = `${sender.name} (${company.name}) asks you to sign "${doc.title}".${doc.message ? `\n\n${doc.message}` : ""}\n\nOpen the document and sign: ${link}\n\nThis link is personal: do not forward it.`;
      try {
        await sendMail(s.email, `Please sign: ${doc.title}`, body,
          `<p>${esc(sender.name)} (${esc(company.name)}) asks you to sign <b>${esc(doc.title)}</b>.</p>${doc.message ? `<p>${esc(doc.message)}</p>` : ""}<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none">Review and sign</a></p><p style="color:#56647a;font-size:12px">This link is personal: do not forward it.</p>`);
        emailed = true;
      } catch (e) { console.error("e-sign invitation not emailed", e); }
    }
    await logEvent(db, doc.id, emailed ? "invited_email" : "invited", { signerId: s.id, userId: meta.userId, ip: meta.ip, userAgent: meta.userAgent, detail: emailed ? s.email : "" });
  }
}

const hex = (c: string) => { const n = parseInt(c.replace("#", ""), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

/** Writes text into a box, shrinking it until it fits. */
function fitText(page: PDFPage, font: PDFFont, text: string, x: number, y: number, w: number, h: number) {
  let size = Math.min(12, h * 0.75);
  while (size > 5 && font.widthOfTextAtSize(text, size) > w - 2) size -= 0.5;
  page.drawText(text, { x: x + 1, y: y + (h - size) / 2 + size * 0.2, size, font, color: rgb(0.07, 0.11, 0.18) });
}

/**
 * Seals a fully signed document: every field is written onto the PDF where it was placed, a certificate page records
 * who signed, when and from where, with the fingerprint of the original, and the result is stored and sent to all.
 */
export async function finalize(db: Db, documentId: string) {
  const [doc] = await db.select().from(schema.esignDocuments).where(eq(schema.esignDocuments.id, documentId));
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, doc.companyId));
  const [att] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, doc.originalAttachmentId));
  const signers = await db.select().from(schema.esignSigners).where(eq(schema.esignSigners.documentId, documentId)).orderBy(asc(schema.esignSigners.order));
  const fields = await db.select().from(schema.esignFields).where(eq(schema.esignFields.documentId, documentId));
  const events = await db.select().from(schema.esignEvents).where(eq(schema.esignEvents.documentId, documentId)).orderBy(asc(schema.esignEvents.at));
  const tz = timeZoneOf(company.country);
  const pdf = await PDFDocument.load(await readAttachment(att.storagePath), { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), oblique = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const pages = pdf.getPages();
  const images = new Map<string, Awaited<ReturnType<typeof embedSignature>>>();
  for (const f of fields) {
    const page = pages[f.page - 1];
    const s = signers.find((x) => x.id === f.signerId);
    if (!page || !s) continue;
    const { width: W, height: H } = page.getSize();
    const x = f.x * W, w = f.w * W, h = f.h * H, y = H - (f.y * H) - h;
    if (f.type === "signature") {
      if (!s.signature) continue;
      let img = images.get(s.id);
      if (!img) { img = await embedSignature(pdf, s.signature); images.set(s.id, img); }
      const scale = Math.min(w / img.width, h / img.height);
      page.drawImage(img, { x: x + (w - img.width * scale) / 2, y: y + (h - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
    } else if (f.type === "initials") fitText(page, oblique, s.initials, x, y, w, h);
    else if (f.type === "checkbox") {
      page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.2, 0.25, 0.35), borderWidth: 0.8 });
      if (f.value === "1") fitText(page, bold, "X", x + w * 0.2, y, w, h);
    } else fitText(page, font, f.value, x, y, w, h);
  }

  // The certificate of completion.
  const cert = pdf.addPage([595.28, 841.89]);
  const L = 50; let Y = 790;
  const line = (text: string, o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = o.size ?? 9.5;
    for (const part of wrap(text, o.f ?? font, size, 495)) {
      if (Y < 60) { const p = pdf.addPage([595.28, 841.89]); Y = 790; certPages.push(p); }
      certPages[certPages.length - 1].drawText(part, { x: L, y: Y, size, font: o.f ?? font, color: o.color ?? rgb(0.07, 0.11, 0.18) });
      Y -= size + (o.gap ?? 4);
    }
  };
  const certPages = [cert];
  line("Certificate of completion", { f: bold, size: 18, color: hex("#1d4ed8"), gap: 10 });
  line(`${doc.title}  ·  ${doc.number}`, { f: bold, size: 11 });
  line(`Sent by ${company.name} through TAGPILOT e-Signature.`, { color: rgb(0.34, 0.39, 0.48), gap: 10 });
  line(`Document ID: ${doc.id}`);
  line(`Original SHA-256: ${doc.originalHash}`);
  line(`Pages: ${pages.length}  ·  Signers: ${signers.length}  ·  Signing order: ${doc.ordered ? "in order" : "any order"}`);
  line(`Completed: ${localDateTime(new Date(), tz)} (${tz})`, { gap: 12 });
  line("Signers", { f: bold, size: 12, gap: 6 });
  for (const s of signers) {
    line(`${s.order}. ${s.name}${s.email ? ` <${s.email}>` : ""}`, { f: bold });
    line(`Signed ${localDateTime(s.signedAt, tz)}  ·  IP ${s.ip || "unknown"}  ·  First opened ${localDateTime(s.viewedAt, tz)}`);
    line(`Device: ${s.userAgent || "unknown"}`, { size: 8, color: rgb(0.34, 0.39, 0.48) });
    if (s.signature && Y > 110) {
      let img = images.get(s.id);
      if (!img) { img = await embedSignature(pdf, s.signature); images.set(s.id, img); }
      const scale = Math.min(160 / img.width, 40 / img.height);
      certPages[certPages.length - 1].drawImage(img, { x: L, y: Y - 40, width: img.width * scale, height: img.height * scale });
      Y -= 48;
    }
    Y -= 6;
  }
  line("Audit trail", { f: bold, size: 12, gap: 6 });
  const names = new Map(signers.map((s) => [s.id, s.name]));
  for (const e of events) line(`${localDateTime(e.at, tz)}  ${e.action.replace(/_/g, " ")}${e.signerId ? ` · ${names.get(e.signerId) ?? ""}` : ""}${e.ip ? ` · ${e.ip}` : ""}${e.detail ? ` · ${e.detail}` : ""}`, { size: 8.5 });
  line("Each signer was identified by a personal link sent to them and agreed to sign electronically. Any change to this file after completion changes its fingerprint.", { size: 8, color: rgb(0.34, 0.39, 0.48) });

  pdf.setTitle(doc.title); pdf.setProducer("TAGPILOT e-Signature"); pdf.setCreator("TAGPILOT");
  const bytes = Buffer.from(await pdf.save());
  const file = new File([bytes], `${doc.title.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 100)} - signed.pdf`, { type: "application/pdf" });
  const saved = await saveAttachment(doc.companyId, doc.createdBy, file);
  const finalHash = sha256(bytes);
  await db.update(schema.esignDocuments).set({ status: "completed", completedAt: new Date(), finalAttachmentId: saved.id, finalHash }).where(eq(schema.esignDocuments.id, doc.id));
  await logEvent(db, doc.id, "completed", { detail: `SHA-256 ${finalHash}` });

  // Everyone gets the signed copy.
  if (mailConfigured() || process.env.NODE_ENV !== "production") {
    const [owner] = doc.createdBy ? await db.select({ email: schema.users.email, name: schema.users.name }).from(schema.users).where(eq(schema.users.id, doc.createdBy)) : [];
    const to = [...new Set([...signers.map((s) => s.email), owner?.email ?? ""].filter(Boolean))];
    for (const addr of to) {
      try {
        await sendMail(addr, `Signed: ${doc.title}`, `Everyone has signed "${doc.title}". The signed copy with its certificate is attached.\n\n${company.name}`,
          `<p>Everyone has signed <b>${esc(doc.title)}</b>. The signed copy with its certificate is attached.</p><p>${esc(company.name)}</p>`,
          [{ filename: file.name, content: bytes, contentType: "application/pdf" }]);
      } catch (e) { console.error("signed copy not emailed", e); }
    }
  }
}

/** A signature picture, drawn (PNG) or uploaded (PNG or JPEG). */
async function embedSignature(pdf: PDFDocument, dataUrl: string) {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  return dataUrl.startsWith("data:image/jpeg") ? pdf.embedJpg(bytes) : pdf.embedPng(bytes);
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && cur) { out.push(cur); cur = word; } else cur = next;
    }
    out.push(cur);
  }
  return out.map((s) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, "?"));
}

/** A signer and their document by the token in their link. */
export async function bySigningToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const db = await getDb();
  const [row] = await db.select({ s: schema.esignSigners, d: schema.esignDocuments, company: schema.companies.name, country: schema.companies.country })
    .from(schema.esignSigners).innerJoin(schema.esignDocuments, eq(schema.esignDocuments.id, schema.esignSigners.documentId))
    .innerJoin(schema.companies, eq(schema.companies.id, schema.esignDocuments.companyId))
    .where(eq(schema.esignSigners.token, token));
  return row ?? null;
}

/** A document of this organisation, with its signers in order. */
export async function loadDoc(db: Db | Tx, companyId: string, id: string) {
  const [doc] = await db.select().from(schema.esignDocuments).where(and(eq(schema.esignDocuments.id, id), eq(schema.esignDocuments.companyId, companyId)));
  if (!doc) return null;
  const signers = await db.select().from(schema.esignSigners).where(eq(schema.esignSigners.documentId, id)).orderBy(asc(schema.esignSigners.order), asc(schema.esignSigners.name));
  const fields = await db.select().from(schema.esignFields).where(eq(schema.esignFields.documentId, id));
  return { doc, signers, fields };
}
