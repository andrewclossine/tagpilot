"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { str } from "@/lib/format";
import { startCheckout } from "@/lib/billing";
import { UserError } from "@/lib/ledger";
import { MODULES } from "@/lib/roles";
import { audit } from "@/lib/audit";
import { parseAmount } from "@/lib/format";
import { reportTransfer } from "@/lib/subscriptions";
import { chosenPlan, readPlan, storageBytes, userLimit } from "@/lib/plans";
import { storageUsed } from "@/lib/storage";

/** Sends the administrator to Flutterwave to pay for the next month or year. */
export async function subscribe(fd: FormData) {
  const ctx = await getCtx();
  let link = "";
  try {
    // Paying must work even after the trial has locked the books, so this checks the role, not write access.
    if (!ctx.isAdmin) throw new UserError("err_admin_only");
    link = await startCheckout(ctx.company, chosenPlan(ctx.company), ctx.user, str(fd, "period") === "yearly" ? "yearly" : "monthly", str(fd, "currency").toUpperCase());
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
    const plan = readPlan(fd, modules);
    const db = await getDb();
    // A smaller package cannot leave more people in the organisation than it allows.
    const [{ n }] = await db.select({ n: count() }).from(schema.memberships).where(and(eq(schema.memberships.companyId, ctx.company.id), ne(schema.memberships.role, "supplier")));
    if (n > userLimit(plan)) throw new UserError("err_plan_users_down");
    // Nor keep more files than its storage holds.
    if ((await storageUsed(db, ctx.company.id)) > storageBytes(plan.storage)) throw new UserError("err_plan_storage_down");
    await db.update(schema.companies).set({ modules, tiers: plan.tiers, seats: plan.seats, storageTier: plan.storage }).where(eq(schema.companies.id, ctx.company.id));
    await audit(db, ctx.company.id, ctx.user.id, "change_modules", "company", ctx.company.id, { modules, tiers: plan.tiers, seats: plan.seats });
  } catch (e) { fail(e, "/billing"); }
  revalidatePath("/", "layout");
  redirect("/billing?saved=1");
}

/** The administrator paid by bank transfer or mobile money and tells the platform owner, who confirms it. */
export async function reportTransferAction(fd: FormData) {
  const ctx = await getCtx();
  try {
    if (!ctx.isAdmin) throw new UserError("err_admin_only");
    await reportTransfer(ctx.company.id, ctx.user.id, {
      period: str(fd, "period") === "yearly" ? "yearly" : "monthly", amount: parseAmount(fd.get("amount")), currency: str(fd, "currency").toUpperCase().slice(0, 3),
      reference: str(fd, "reference").slice(0, 120), note: str(fd, "note"), modules: ctx.company.modules, tiers: ctx.company.tiers ?? {}, seats: ctx.company.seats ?? 0, storageTier: ctx.company.storageTier,
    });
  } catch (e) { fail(e, "/billing"); }
  revalidatePath("/billing");
  redirect("/billing?reported=1");
}
