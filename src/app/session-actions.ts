"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { and, count, eq, gt, inArray, lt, or } from "drizzle-orm";
import { appUrl } from "@/lib/billing";
import { sendMail } from "@/lib/mail";
import { getI18n } from "@/lib/i18n";
import { getDb, schema } from "@/db";
import { checkPassword, endSession, hashPassword, requireUser, startSession, switchCompany } from "@/lib/auth";
import { isUsername, parseAmount, str } from "@/lib/format";
import { companyProfile, CURRENCIES, DEFAULT_POLICIES, DEFAULT_SETTINGS, PAYROLL_DEFAULTS } from "@/lib/template";
import { ensureAssetCategories, ensureStarterAccounts } from "@/lib/setup";
import { audit } from "@/lib/audit";

/** Starts a subscription: the person who signs up becomes the admin of the company they create next, on a free trial. */
export async function signUp(fd: FormData) {
  const email = str(fd, "email").toLowerCase(), name = str(fd, "name"), username = str(fd, "username").toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!email || !name) redirect("/signup?error=err_required");
  if (!isUsername(username)) redirect("/signup?error=err_username");
  if (password.length < 8) redirect("/signup?error=err_password_short");
  const db = await getDb();
  const [exists] = await db.select({ email: schema.users.email, username: schema.users.username }).from(schema.users)
    .where(or(eq(schema.users.email, email), eq(schema.users.username, username)));
  if (exists) redirect(`/signup?error=${exists.username === username ? "err_username_taken" : "err_email_taken"}`);
  const [u] = await db.insert(schema.users).values({ email, name, username, passwordHash: await hashPassword(password) }).returning({ id: schema.users.id });
  await startSession(u.id);
  redirect("/onboarding");
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_LOGIN = 8, MAX_PER_IP = 30;

/** Signs in with a username (or the admin's email). Repeated failures lock that login, and that address, for 15 minutes. */
export async function signIn(fd: FormData) {
  const login = str(fd, "login").toLowerCase(), password = String(fd.get("password") ?? "");
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
  const keys = { login: `u:${login}`, ip: `ip:${ip}` };
  const db = await getDb();
  const since = new Date(Date.now() - WINDOW_MS);
  const fails = await db.select({ key: schema.loginFailures.key, n: count() }).from(schema.loginFailures)
    .where(and(inArray(schema.loginFailures.key, [keys.login, keys.ip]), gt(schema.loginFailures.at, since))).groupBy(schema.loginFailures.key);
  const n = (k: string) => fails.find((f) => f.key === k)?.n ?? 0;
  if (n(keys.login) >= MAX_PER_LOGIN || n(keys.ip) >= MAX_PER_IP) redirect("/login?error=err_login_locked");

  const [u] = await db.select().from(schema.users).where(or(eq(schema.users.username, login), eq(schema.users.email, login)));
  if (!u || !(await checkPassword(password, u.passwordHash))) {
    await db.insert(schema.loginFailures).values([{ key: keys.login }, { key: keys.ip }]);
    await db.delete(schema.loginFailures).where(lt(schema.loginFailures.at, new Date(Date.now() - 86400000)));
    redirect("/login?error=err_login");
  }
  await db.delete(schema.loginFailures).where(eq(schema.loginFailures.key, keys.login));
  await startSession(u.id);
  redirect("/dashboard");
}

const resetHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * Emails a one-hour reset link to the address on the account. The answer is the same whether or not the
 * account exists, so the form cannot be used to find out who has an account.
 */
export async function requestPasswordReset(fd: FormData) {
  const login = str(fd, "login").toLowerCase();
  if (login) {
    const db = await getDb();
    const [u] = await db.select().from(schema.users).where(or(eq(schema.users.username, login), eq(schema.users.email, login)));
    if (u?.email) {
      const recent = await db.select({ id: schema.passwordResets.id }).from(schema.passwordResets)
        .where(and(eq(schema.passwordResets.userId, u.id), gt(schema.passwordResets.createdAt, new Date(Date.now() - 3600000))));
      if (recent.length < 3) {
        const token = crypto.randomBytes(32).toString("base64url");
        await db.insert(schema.passwordResets).values({ id: resetHash(token), userId: u.id, expiresAt: new Date(Date.now() + 3600000) });
        const link = `${await appUrl()}/reset?token=${token}`;
        const { t } = await getI18n();
        try {
          await sendMail(u.email, t("reset_mail_subject"),
            `${t("reset_mail_hello")} ${u.name},\n\n${t("reset_mail_body")}\n\n${link}\n\n${t("reset_mail_ignore")}`,
            `<p>${t("reset_mail_hello")} ${escapeHtml(u.name)},</p><p>${t("reset_mail_body")}</p><p><a href="${link}">${t("reset_mail_button")}</a></p><p style="color:#666">${t("reset_mail_ignore")}</p>`);
        } catch (e) { console.error("Password reset email failed", e); }
      }
    }
  }
  redirect("/forgot?sent=1");
}

export async function resetPassword(fd: FormData) {
  const token = str(fd, "token"), password = String(fd.get("password") ?? ""), confirm = String(fd.get("confirm") ?? "");
  const back = `/reset?token=${encodeURIComponent(token)}`;
  if (password.length < 8) redirect(`${back}&error=err_password_short`);
  if (password !== confirm) redirect(`${back}&error=err_password_match`);
  const db = await getDb();
  const [r] = await db.select().from(schema.passwordResets).where(eq(schema.passwordResets.id, resetHash(token)));
  if (!r || r.usedAt || r.expiresAt.getTime() < Date.now()) redirect("/forgot?error=err_reset_expired");
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ passwordHash: await hashPassword(password) }).where(eq(schema.users.id, r.userId));
    await tx.update(schema.passwordResets).set({ usedAt: new Date() }).where(eq(schema.passwordResets.id, r.id));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, r.userId));
  });
  redirect("/login?reset=1");
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export async function signOut() {
  await endSession();
  redirect("/login");
}

export async function setLang(fd: FormData) {
  (await cookies()).set("konti_lang", str(fd, "lang") === "fr" ? "fr" : "en", { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
  redirect(str(fd, "back") || "/dashboard");
}

export async function changeCompany(fd: FormData) {
  await switchCompany(str(fd, "companyId"));
  redirect("/dashboard");
}

/** Creates a company with the starter chart of accounts, asset classes, a general project and an example policy. */
export async function createCompany(fd: FormData) {
  const user = await requireUser();
  const name = str(fd, "name");
  if (!name || !str(fd, "country")) redirect("/onboarding?error=err_required");
  const db = await getDb();
  // One subscription, one organisation: users who already belong to one go straight to it.
  const [member] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id)).limit(1);
  if (member) redirect("/dashboard");
  const currency = CURRENCIES.includes(str(fd, "currency")) ? str(fd, "currency") : "USD";
  const vatRegistered = str(fd, "vat") === "1";
  const companyId = await db.transaction(async (tx) => {
    const [c] = await tx.insert(schema.companies).values({
      name, ...companyProfile(fd), currency,
      vatRegistered, vatRate: vatRegistered ? parseAmount(fd.get("vatRate")) : 0,
      policies: DEFAULT_POLICIES, settings: { ...DEFAULT_SETTINGS, payroll: { ...PAYROLL_DEFAULTS, country: str(fd, "country") } },
    }).returning({ id: schema.companies.id });
    await tx.insert(schema.memberships).values({ companyId: c.id, userId: user.id, role: "admin" });
    await ensureStarterAccounts(tx, c.id);
    await ensureAssetCategories(tx, c.id);
    await tx.insert(schema.projects).values({ companyId: c.id, code: "GEN", name: "General administration" });
    await audit(tx, c.id, user.id, "create", "company", c.id, { name });
    return c.id;
  });
  await switchCompany(companyId);
  redirect("/dashboard");
}
