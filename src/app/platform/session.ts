"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, count, eq, gt, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { checkPassword } from "@/lib/auth";
import { str } from "@/lib/format";
import { endPlatformSession, ensureFirstOwner, startPlatformSession } from "@/lib/platform";

const WINDOW_MS = 15 * 60 * 1000, MAX_PER_LOGIN = 5, MAX_PER_IP = 20;

/** Platform sign-in, by email. Repeated failures lock that email, and that address, for 15 minutes. */
export async function platformSignIn(fd: FormData) {
  await ensureFirstOwner();
  const email = str(fd, "email").toLowerCase(), password = String(fd.get("password") ?? "");
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
  const keys = { login: `p:${email}`, ip: `pip:${ip}` };
  const db = await getDb();
  const fails = await db.select({ key: schema.loginFailures.key, n: count() }).from(schema.loginFailures)
    .where(and(inArray(schema.loginFailures.key, [keys.login, keys.ip]), gt(schema.loginFailures.at, new Date(Date.now() - WINDOW_MS)))).groupBy(schema.loginFailures.key);
  const n = (k: string) => fails.find((f) => f.key === k)?.n ?? 0;
  if (n(keys.login) >= MAX_PER_LOGIN || n(keys.ip) >= MAX_PER_IP) redirect("/platform/login?error=err_login_locked");
  const [a] = await db.select().from(schema.platformAdmins).where(eq(schema.platformAdmins.email, email));
  if (!a || !(await checkPassword(password, a.passwordHash))) {
    await db.insert(schema.loginFailures).values([{ key: keys.login }, { key: keys.ip }]);
    await db.delete(schema.loginFailures).where(lt(schema.loginFailures.at, new Date(Date.now() - 86400000)));
    redirect("/platform/login?error=err_login");
  }
  await db.delete(schema.loginFailures).where(eq(schema.loginFailures.key, keys.login));
  await startPlatformSession(a.id);
  redirect("/platform");
}

export async function platformSignOut() {
  await endPlatformSession();
  redirect("/platform/login");
}
