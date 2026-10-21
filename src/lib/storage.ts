import "server-only";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { getDb, schema } from "@/db";

const root = () => process.env.STORAGE_DIR || path.join(process.cwd(), "storage");

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] as const;
export const MAX_UPLOAD = 15 * 1024 * 1024;

/** Saves an uploaded supporting document and records it. Returns the attachment id. */
export async function saveAttachment(companyId: string, userId: string, file: File): Promise<{ id: string; bytes: Buffer }> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 8);
  const rel = path.join(companyId, `${new Date().toISOString().slice(0, 7)}`, crypto.randomUUID() + ext);
  await fs.mkdir(path.dirname(path.join(root(), rel)), { recursive: true });
  await fs.writeFile(path.join(root(), rel), bytes);
  const db = await getDb();
  const [row] = await db.insert(schema.attachments).values({
    companyId, fileName: file.name.slice(0, 200), mimeType: file.type, size: bytes.length, storagePath: rel, uploadedBy: userId,
  }).returning({ id: schema.attachments.id });
  return { id: row.id, bytes };
}

export async function readAttachment(storagePath: string): Promise<Buffer> {
  const full = path.resolve(root(), storagePath);
  if (!full.startsWith(path.resolve(root()))) throw new Error("Bad path");
  return fs.readFile(full);
}
