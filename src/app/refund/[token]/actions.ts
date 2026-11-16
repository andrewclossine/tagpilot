"use server";
import { redirect } from "next/navigation";
import { str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { savePayoutDetails } from "@/lib/subscriptions";

/** Saves where the refund should go. The token in the link is the only key, so nothing else is trusted from the form. */
export async function savePayoutAction(fd: FormData) {
  const token = str(fd, "token");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) redirect("/");
  try {
    await savePayoutDetails(token, {
      payTo: str(fd, "payTo") === "momo" ? "momo" : "bank", accountName: str(fd, "accountName"), bankName: str(fd, "bankName"),
      accountNumber: str(fd, "accountNumber"), bankCode: str(fd, "bankCode"), phone: str(fd, "phone"),
    });
  } catch (e) {
    if (e instanceof UserError) redirect(`/refund/${token}?error=${e.message}`);
    throw e;
  }
  redirect(`/refund/${token}?saved=1`);
}
