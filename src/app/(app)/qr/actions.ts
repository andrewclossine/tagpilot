"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { QrStyle, QrType } from "@/db/schema";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isUuid, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { audit } from "@/lib/audit";
import { saveAttachment, MAX_UPLOAD, ALLOWED_TYPES } from "@/lib/storage";
import { DEFAULT_STYLE, QR_FIELDS, QR_TYPES, qrContent } from "@/lib/qr";

const BASE = "/qr";
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newSlug = () => Array.from(crypto.randomBytes(7), (b) => ALPHABET[b % ALPHABET.length]).join("");
/** The details in one order: the database keeps them in its own. */
const same = (d: Record<string, string>) => JSON.stringify(Object.keys(d).sort().map((k) => [k, d[k] ?? ""]));
const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : d);

function readStyle(raw: string): QrStyle {
  let s: Partial<QrStyle> = {};
  try { s = JSON.parse(raw); } catch { s = {}; }
  const logo = typeof s.logo === "string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s.logo) && s.logo.length < 300_000 ? s.logo : null;
  return {
    fg: hex(s.fg, DEFAULT_STYLE.fg), bg: hex(s.bg, DEFAULT_STYLE.bg), eyeColor: hex(s.eyeColor, hex(s.fg, DEFAULT_STYLE.fg)), frameColor: hex(s.frameColor, DEFAULT_STYLE.frameColor),
    dots: s.dots === "rounded" || s.dots === "dots" ? s.dots : "square", eyes: s.eyes === "rounded" || s.eyes === "circle" ? s.eyes : "square",
    frame: s.frame === "box" || s.frame === "banner" ? s.frame : "none", frameText: String(s.frameText ?? "").slice(0, 30),
    ecc: (["L", "M", "Q", "H"] as const).find((e) => e === s.ecc) ?? "M", logo,
  };
}

/**
 * Saves a QR code. A dynamic code points to its TAGPILOT short link, so what it opens can change later and its scans
 * are counted; a static code holds its content itself. A file code is always dynamic: the file is kept here.
 */
export async function saveQr(fd: FormData) {
  const ctx = await requireWrite("qr");
  const id = str(fd, "id");
  const back = id ? `${BASE}/${id}` : `${BASE}/new`;
  let savedId = id;
  try {
    const type = QR_TYPES.find((t) => t === str(fd, "type")) as QrType | undefined;
    if (!type) throw new UserError("err_qr_type");
    const name = str(fd, "name").slice(0, 120);
    if (!name) throw new UserError("err_qr_name");
    const data = Object.fromEntries(QR_FIELDS[type].map((k) => [k, str(fd, `d_${k}`).slice(0, 1000)]));
    const dynamic = type === "file" || str(fd, "dynamic") === "1";
    if (type !== "file" && !qrContent(type, data)) throw new UserError("err_qr_content");
    const style = readStyle(str(fd, "style"));
    const db = await getDb();
    let fileAttachmentId: string | null | undefined;
    const file = fd.get("file");
    if (file instanceof File && file.size) {
      if (file.size > MAX_UPLOAD) throw new UserError("err_file_too_big");
      if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) throw new UserError("err_qr_file_type");
      fileAttachmentId = (await saveAttachment(ctx.company.id, ctx.user.id, file)).id;
      data.fileName = file.name.slice(0, 200);
    }
    if (id) {
      if (!isUuid(id)) throw new UserError("err_not_found");
      const [old] = await db.select().from(schema.qrCodes).where(and(eq(schema.qrCodes.id, id), eq(schema.qrCodes.companyId, ctx.company.id)));
      if (!old) throw new UserError("err_not_found");
      // A static code is printed with its content inside: only its name and look can change.
      if (!old.dynamic && (type !== old.type || same(data) !== same(old.data))) throw new UserError("err_qr_static");
      if (type === "file" && !fileAttachmentId && !old.fileAttachmentId) throw new UserError("err_qr_file");
      if (type === "file" && !fileAttachmentId) data.fileName = old.data.fileName ?? "";
      await db.update(schema.qrCodes).set({ name, type, data, style, dynamic: old.dynamic, ...(fileAttachmentId ? { fileAttachmentId } : {}), updatedAt: new Date() }).where(eq(schema.qrCodes.id, id));
      await audit(db, ctx.company.id, ctx.user.id, "update", "qr_code", name);
    } else {
      if (type === "file" && !fileAttachmentId) throw new UserError("err_qr_file");
      const [row] = await db.insert(schema.qrCodes).values({ companyId: ctx.company.id, name, type, data, dynamic, slug: newSlug(), style, fileAttachmentId: fileAttachmentId ?? null, createdBy: ctx.user.id }).returning({ id: schema.qrCodes.id });
      savedId = row.id;
      await audit(db, ctx.company.id, ctx.user.id, "create", "qr_code", name, { type, dynamic });
    }
  } catch (e) { fail(e, back); }
  revalidatePath(BASE);
  redirect(`${BASE}/${savedId}?saved=1`);
}

/** Pauses or resumes a dynamic code: paused, a scan says it is no longer active. */
export async function toggleQr(fd: FormData) {
  const ctx = await requireWrite("qr");
  const id = str(fd, "id");
  const db = await getDb();
  const [row] = isUuid(id) ? await db.select().from(schema.qrCodes).where(and(eq(schema.qrCodes.id, id), eq(schema.qrCodes.companyId, ctx.company.id))) : [];
  if (row) await db.update(schema.qrCodes).set({ active: !row.active, updatedAt: new Date() }).where(eq(schema.qrCodes.id, id));
  revalidatePath(BASE);
  redirect(`${BASE}/${id}`);
}

export async function deleteQr(fd: FormData) {
  const ctx = await requireWrite("qr");
  const id = str(fd, "id");
  const db = await getDb();
  if (isUuid(id)) await db.delete(schema.qrCodes).where(and(eq(schema.qrCodes.id, id), eq(schema.qrCodes.companyId, ctx.company.id)));
  revalidatePath(BASE);
  redirect(`${BASE}?deleted=1`);
}
