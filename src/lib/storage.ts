import "server-only";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema, type Db, type Tx } from "@/db";
import { UserError } from "./ledger";
import { chosenPlan, lowerTier, storageBytes } from "./plans";

/** Bytes of all the files an organisation keeps. */
export async function storageUsed(db: Db | Tx, companyId: string): Promise<number> {
  const [r] = await db.select({ n: sql<string>`coalesce(sum(${schema.attachments.size}), 0)` }).from(schema.attachments).where(eq(schema.attachments.companyId, companyId));
  return Number(r?.n ?? 0);
}

/** The storage the organisation's My Files package allows, held to what it paid for once a subscription runs. */
export async function storageLimit(db: Db | Tx, companyId: string): Promise<number> {
  const [c] = await db.select().from(schema.companies).where(and(eq(schema.companies.id, companyId)));
  if (!c) return 0;
  // The free trial has the largest storage; once paid, the package chosen and paid for.
  const paid = !!c.paidUntil && c.paidUntil.getTime() > Date.now();
  if (!paid) return storageBytes("premium");
  const want = chosenPlan(c).storage;
  return storageBytes(Object.keys(c.paidTiers ?? {}).length ? lowerTier(want, chosenPlan({ ...c, storageTier: c.paidStorageTier }).storage) : want);
}

/** A file of this size still fits in the organisation's storage. */
export async function assertStorage(companyId: string, size: number) {
  const db = await getDb();
  const [used, limit] = await Promise.all([storageUsed(db, companyId), storageLimit(db, companyId)]);
  if (used + size > limit) throw new UserError("err_plan_storage");
}

const root = () => process.env.STORAGE_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "storage");

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] as const;
export const MAX_UPLOAD = 15 * 1024 * 1024;

/** Saves an uploaded supporting document and records it. Returns the attachment id. */
/** Saves an uploaded file. The uploader is empty only for a supplier registering, before its account exists. */
export async function saveAttachment(companyId: string, userId: string | null, file: File, opts: { skipQuota?: boolean } = {}): Promise<{ id: string; bytes: Buffer }> {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!opts.skipQuota) await assertStorage(companyId, bytes.length);
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
