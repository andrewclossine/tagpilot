"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { checkPassword, endSession, hashPassword, requireUser, startSession, switchCompany } from "@/lib/auth";
import { parseAmount, str } from "@/lib/format";
import { DEFAULT_POLICIES, DEFAULT_SETTINGS, PAYROLL_DEFAULTS, RWANDA_ACCOUNTS } from "@/lib/template";
import { audit } from "@/lib/audit";

export async function signUp(fd: FormData) {
  const email = str(fd, "email").toLowerCase(), name = str(fd, "name"), password = String(fd.get("password") ?? "");
  if (!email || !name) redirect("/signup?error=err_required");
  if (password.length < 8) redirect("/signup?error=err_password_short");
  const db = await getDb();
  const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (exists) redirect("/signup?error=err_email_taken");
  const [u] = await db.insert(schema.users).values({ email, name, passwordHash: await hashPassword(password) }).returning({ id: schema.users.id });
  await startSession(u.id);
  redirect("/dashboard");
}

export async function signIn(fd: FormData) {
  const email = str(fd, "email").toLowerCase(), password = String(fd.get("password") ?? "");
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
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

/** Creates a company with the Rwanda starter chart of accounts, a general project and an example policy. */
export async function createCompany(fd: FormData) {
  const user = await requireUser();
  const name = str(fd, "name");
  if (!name) redirect("/onboarding?error=err_required");
  const db = await getDb();
  const companyId = await db.transaction(async (tx) => {
    const [c] = await tx.insert(schema.companies).values({
      name, tin: str(fd, "tin"), vatRegistered: str(fd, "vat") !== "0", vatRate: parseAmount(fd.get("vatRate")) || 18,
      policies: DEFAULT_POLICIES, settings: { ...DEFAULT_SETTINGS, payroll: PAYROLL_DEFAULTS },
    }).returning({ id: schema.companies.id });
    await tx.insert(schema.memberships).values({ companyId: c.id, userId: user.id, role: "owner" });
    await tx.insert(schema.accounts).values(RWANDA_ACCOUNTS.map((a) => ({
      companyId: c.id, code: a.code, nameEn: a.en, nameFr: a.fr, type: a.type, subtype: a.subtype ?? null,
    })));
    await tx.insert(schema.projects).values({ companyId: c.id, code: "GEN", name: "General administration" });
    await audit(tx, c.id, user.id, "create", "company", c.id, { name });
    return c.id;
  });
  await switchCompany(companyId);
  redirect("/dashboard");
}
