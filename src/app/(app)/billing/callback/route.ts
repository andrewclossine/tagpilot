import { redirect } from "next/navigation";
import { confirmPayment } from "@/lib/billing";

/** Flutterwave sends the payer back here; the payment only counts after we verify it with Flutterwave. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const transactionId = url.searchParams.get("transaction_id");
  if (status === "cancelled" || status === "failed" || !transactionId) redirect("/billing?error=err_payment_cancelled");
  let ok = false;
  try { ok = (await confirmPayment(transactionId)).ok; } catch (e) { console.error("Payment verification failed", e); }
  redirect(ok ? "/billing?paid=1" : "/billing?pending=1");
}
