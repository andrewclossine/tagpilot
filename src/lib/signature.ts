import "server-only";
import { eq } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import { UserError } from "./ledger";

const PREFIX = "data:image/png;base64,";
const MAX_LENGTH = 700_000; // the drawing pad's picture is far smaller; this stops anything else being stored

/** Checks that what was sent as a signature really is a PNG picture of a reasonable size, and returns it. */
export function readSignature(value: string): string {
  if (!value.startsWith(PREFIX) || value.length > MAX_LENGTH) throw new UserError("err_signature");
  const body = value.slice(PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new UserError("err_signature");
  const png = Buffer.from(body, "base64");
  if (png.length < 24 || png.toString("latin1", 1, 4) !== "PNG" || png.toString("latin1", 12, 16) !== "IHDR") throw new UserError("err_signature");
  return value;
}

export async function savedSignature(db: Db | Tx, userId: string): Promise<string | null> {
  const [row] = await db.select({ image: schema.userSignatures.image }).from(schema.userSignatures).where(eq(schema.userSignatures.userId, userId));
  return row?.image ?? null;
}

/** Keeps a person's signature for next time, or forgets it when they untick the box. It is theirs alone. */
export async function rememberSignature(db: Db | Tx, userId: string, image: string, remember: boolean) {
  if (!remember) {
    await db.delete(schema.userSignatures).where(eq(schema.userSignatures.userId, userId));
    return;
  }
  await db.insert(schema.userSignatures).values({ userId, image })
    .onConflictDoUpdate({ target: schema.userSignatures.userId, set: { image, updatedAt: new Date() } });
}
