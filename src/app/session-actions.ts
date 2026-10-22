"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, or } from "drizzle-orm";
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

/** Signs in with a username (or the admin's email). */
export async function signIn(fd: FormData) {
  const login = str(fd, "login").toLowerCase(), password = String(fd.get("password") ?? "");
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(or(eq(schema.users.username, login), eq(schema.users.email, login)));
  if (!u || !(await checkPassword(password, u.passwordHash))) redirect("/login?error=err_login");
  await startSession(u.id);
  redirect("/dashboard");
}

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
