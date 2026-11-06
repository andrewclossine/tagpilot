import "server-only";
import crypto from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/**
 * The platform owner's account is separate from every organisation's accounts, as on hrleave.com: its own table,
 * its own sign-in at /platform/login and its own session cookie. The same email can also have an ordinary account.
 */
const COOKIE = "tp_platform";
const SESSION_HOURS = 12;
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * The first platform owner. While there is none, an existing ordinary account whose email is in PLATFORM_OWNER_EMAILS
 * (set on the server only) gives the platform owner their name, email and password. An account that already runs an
 * organisation keeps it and stays as it is; one with no organisation is moved into the platform.
 * Nobody can claim the platform from the web.
 */
async function ensureFirstOwner() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.platformAdmins);
  if (Number(n)) return;
  const emails = (process.env.PLATFORM_OWNER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const email of emails) {
    const [u] = await db.select().from(schema.users).where(eq(sql`lower(${schema.users.email})`, email));
    if (!u) continue;
    await db.insert(schema.platformAdmins).values({ email, name: u.name, passwordHash: u.passwordHash }).onConflictDoNothing();
    const [member] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, u.id)).limit(1);
    if (member) continue;
    // With no organisation, the ordinary account is moved, not copied, so its email is free for an organisation's account.
    // If something still points to it, it stays; the platform account works either way.
    try { await db.delete(schema.users).where(eq(schema.users.id, u.id)); } catch { /* kept */ }
  }
}

export const getPlatformOwner = cache(async () => {
  await ensureFirstOwner();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db.select({ a: schema.platformAdmins, expiresAt: schema.platformSessions.expiresAt }).from(schema.platformSessions)
    .innerJoin(schema.platformAdmins, eq(schema.platformAdmins.id, schema.platformSessions.adminId))
    .where(eq(schema.platformSessions.id, hashToken(token)));
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  const { passwordHash: _omit, ...owner } = row.a;
  return owner;
});

/** For the platform pages: anyone not signed in to the platform goes to its sign-in page. */
export async function requirePlatformOwner() {
  const owner = await getPlatformOwner();
  if (!owner) redirect("/platform/login");
  return owner;
}

export async function startPlatformSession(adminId: string) {
  const db = await getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600000);
  await db.insert(schema.platformSessions).values({ id: hashToken(token), adminId, expiresAt });
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
}

export async function endPlatformSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await (await getDb()).delete(schema.platformSessions).where(eq(schema.platformSessions.id, hashToken(token)));
  jar.delete(COOKIE);
}

export { ensureFirstOwner };

export type CompanyStatus = "suspended" | "paid" | "trial" | "expired";

export function companyStatus(c: { suspendedAt: Date | null; paidUntil: Date | null; trialEndsAt: Date }, now = Date.now()): { status: CompanyStatus; days: number } {
  if (c.suspendedAt) return { status: "suspended", days: 0 };
  if (c.paidUntil && c.paidUntil.getTime() > now) return { status: "paid", days: Math.ceil((c.paidUntil.getTime() - now) / 86400000) };
  const left = Math.ceil((c.trialEndsAt.getTime() - now) / 86400000);
  return left > 0 ? { status: "trial", days: left } : { status: "expired", days: -left };
}
