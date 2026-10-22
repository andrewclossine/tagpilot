"use server";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { str } from "@/lib/format";
import { startCheckout } from "@/lib/billing";
import { UserError } from "@/lib/ledger";

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
