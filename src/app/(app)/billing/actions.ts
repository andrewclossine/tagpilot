"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { str } from "@/lib/format";
import { startCheckout } from "@/lib/billing";
import { UserError } from "@/lib/ledger";
import { MODULES } from "@/lib/roles";
import { audit } from "@/lib/audit";

/** Sends the administrator to Flutterwave to pay for the next month or year. */
export async function subscribe(fd: FormData) {
  const ctx = await getCtx();
  let link = "";
  try {
    // Paying must work even after the trial has locked the books, so this checks the role, not write access.
    if (!ctx.isAdmin) throw new UserError("err_admin_only");
    link = await startCheckout(ctx.company, ctx.user, str(fd, "period") === "yearly" ? "yearly" : "monthly");
  } catch (e) { fail(e, "/billing"); }
  redirect(link);
}

/** Changes what the organisation subscribes to. Nothing is deleted when a module is removed: its records come back with it. */
export async function changeModules(fd: FormData) {
  const ctx = await getCtx();
  try {
    if (!ctx.isAdmin) throw new UserError("err_admin_only");
    const modules = MODULES.filter((m) => fd.getAll("modules").includes(m));
    if (!modules.length) throw new UserError("err_no_modules");
    const db = await getDb();
    await db.update(schema.companies).set({ modules }).where(eq(schema.companies.id, ctx.company.id));
    await audit(db, ctx.company.id, ctx.user.id, "change_modules", "company", ctx.company.id, { modules });
  } catch (e) { fail(e, "/billing"); }
  revalidatePath("/", "layout");
  redirect("/billing?saved=1");
}
