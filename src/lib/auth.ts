import "server-only";
import crypto from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Role } from "@/db/schema";
import { can, type Area } from "./roles";

const SESSION_COOKIE = "konti_session";
const COMPANY_COOKIE = "konti_company";
const SESSION_DAYS = 30;

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function hashPassword(password: string) { return bcrypt.hash(password, 12); }
export async function checkPassword(password: string, hash: string) { return bcrypt.compare(password, hash); }

export async function startSession(userId: string) {
  const db = await getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(schema.sessions).values({ id: hashToken(token), userId, expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db.select({ user: schema.users, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions).innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, hashToken(token)));
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  const { passwordHash: _omit, ...user } = row.user;
  return user;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export type Ctx = {
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
  company: typeof schema.companies.$inferSelect;
  role: Role;
  isAdmin: boolean;
  /** Days left in the free trial, or null on a paid plan. */
  trialDaysLeft: number | null;
  /** True when the trial has ended without a subscription: the books stay readable but cannot change. */
  locked: boolean;
  can: (area: Area, mode?: "read" | "write") => boolean;
};

/** The signed-in user, their current company and their role in it. Sends them to login or onboarding when missing. */
export const getCtx = cache(async (): Promise<Ctx> => {
  const user = await requireUser();
  const db = await getDb();
  const rows = await db.select({ company: schema.companies, role: schema.memberships.role })
    .from(schema.memberships).innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
    .where(eq(schema.memberships.userId, user.id));
  if (!rows.length) redirect("/onboarding");
  const wanted = (await cookies()).get(COMPANY_COOKIE)?.value;
  const row = rows.find((r) => r.company.id === wanted) ?? rows[0];
  // A company is paid up while its last paid period has not ended; otherwise the free trial applies.
  const paid = !!row.company.paidUntil && row.company.paidUntil.getTime() > Date.now();
  const trialDaysLeft = paid ? null : Math.max(0, Math.ceil((row.company.trialEndsAt.getTime() - Date.now()) / 86400000));
  const locked = !paid && trialDaysLeft === 0;
  return {
    user, company: row.company, role: row.role, isAdmin: row.role === "admin", trialDaysLeft, locked,
    can: (area, mode = "read") => (mode === "write" && locked ? false : can(row.role, area, mode)),
  };
});

/** For server actions: the context, refusing anyone whose role may not change this area. */
export async function requireWrite(area: Area): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx.can(area, "write")) throw new Error("You do not have permission to change this part of the books.");
  return ctx;
}

/** For pages: the context, or the no-access page when the role may not see this area. */
export async function requireView(area: Area): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx.can(area)) redirect("/no-access");
  return ctx;
}

export async function listMyCompanies(userId: string) {
  const db = await getDb();
  return db.select({ id: schema.companies.id, name: schema.companies.name, role: schema.memberships.role })
    .from(schema.memberships).innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
    .where(eq(schema.memberships.userId, userId));
}

export async function switchCompany(companyId: string) {
  const user = await requireUser();
  const db = await getDb();
  const [m] = await db.select().from(schema.memberships)
    .where(and(eq(schema.memberships.companyId, companyId), eq(schema.memberships.userId, user.id)));
  if (!m) throw new Error("Not a member of this company.");
  (await cookies()).set(COMPANY_COOKIE, companyId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86400 });
}
