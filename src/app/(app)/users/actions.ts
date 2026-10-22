"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { hashPassword, requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isUsername, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { ROLES } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { Role } from "@/db/schema";

const roleOf = (fd: FormData): Role => ROLES.find((r) => r === str(fd, "role")) ?? "viewer";
const done = () => { revalidatePath("/users"); redirect("/users?saved=1"); };

/** The company admin creates a user who signs in with a username and the password the admin gives them. */
export async function createUser(fd: FormData) {
  const ctx = await requireWrite("users");
  const username = str(fd, "username").toLowerCase(), name = str(fd, "name"), password = String(fd.get("password") ?? "");
  try {
    if (!name) throw new UserError("err_required");
    if (!isUsername(username)) throw new UserError("err_username");
    if (password.length < 8) throw new UserError("err_password_short");
    const db = await getDb();
    const [taken] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, username));
    if (taken) throw new UserError("err_username_taken");
    // An email is optional; with one, the person can reset a forgotten password themselves.
    const email = str(fd, "email").toLowerCase() || null;
    if (email) {
      const [used] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
      if (used) throw new UserError("err_email_taken");
    }
    await db.transaction(async (tx) => {
      const [u] = await tx.insert(schema.users).values({ username, name, email, passwordHash: await hashPassword(password), createdBy: ctx.user.id })
        .returning({ id: schema.users.id });
      await tx.insert(schema.memberships).values({ companyId: ctx.company.id, userId: u.id, role: roleOf(fd) });
      await audit(tx, ctx.company.id, ctx.user.id, "create", "user", username, { role: roleOf(fd) });
    });
  } catch (e) { fail(e, "/users"); }
  done();
}

async function memberOf(companyId: string, userId: string) {
  const db = await getDb();
  const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.companyId, companyId), eq(schema.memberships.userId, userId)));
  if (!m) throw new UserError("err_not_found");
  return m;
}

export async function changeRole(fd: FormData) {
  const ctx = await requireWrite("users");
  const userId = str(fd, "userId");
  try {
    if (userId === ctx.user.id) throw new UserError("err_self_role");
    await memberOf(ctx.company.id, userId);
    const db = await getDb();
    await db.update(schema.memberships).set({ role: roleOf(fd) }).where(and(eq(schema.memberships.companyId, ctx.company.id), eq(schema.memberships.userId, userId)));
    await audit(db, ctx.company.id, ctx.user.id, "change_role", "user", userId, { role: roleOf(fd) });
  } catch (e) { fail(e, "/users"); }
  done();
}

/** Sets a new password for a user the admin created; their open sessions end. */
export async function resetPassword(fd: FormData) {
  const ctx = await requireWrite("users");
  const userId = str(fd, "userId"), password = String(fd.get("password") ?? "");
  try {
    if (password.length < 8) throw new UserError("err_password_short");
    await memberOf(ctx.company.id, userId);
    const db = await getDb();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!u || (u.createdBy !== ctx.user.id && userId !== ctx.user.id)) throw new UserError("err_not_your_user");
    await db.update(schema.users).set({ passwordHash: await hashPassword(password) }).where(eq(schema.users.id, userId));
    if (userId !== ctx.user.id) await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await audit(db, ctx.company.id, ctx.user.id, "reset_password", "user", u.username);
  } catch (e) { fail(e, "/users"); }
  done();
}

export async function removeUser(fd: FormData) {
  const ctx = await requireWrite("users");
  const userId = str(fd, "userId");
  try {
    if (userId === ctx.user.id) throw new UserError("err_self_role");
    await memberOf(ctx.company.id, userId);
    const db = await getDb();
    await db.delete(schema.memberships).where(and(eq(schema.memberships.companyId, ctx.company.id), eq(schema.memberships.userId, userId)));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await audit(db, ctx.company.id, ctx.user.id, "remove", "user", userId);
  } catch (e) { fail(e, "/users"); }
  done();
}
