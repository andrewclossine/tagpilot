import crypto from "node:crypto";
import { confirmPayment } from "@/lib/billing";

/**
 * Flutterwave calls this when a charge completes, even if the payer closed the browser before coming back.
 * The secret hash set in the Flutterwave dashboard must match FLW_SECRET_HASH; the transaction is then
 * verified with Flutterwave before anything changes.
 */
export async function POST(req: Request) {
  const expected = process.env.FLW_SECRET_HASH ?? "";
  const got = req.headers.get("verif-hash") ?? "";
  const same = expected.length > 0 && got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  if (!same) return new Response("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null) as { event?: string; data?: { id?: number | string } } | null;
  if (body?.event === "charge.completed" && body.data?.id) {
    try { await confirmPayment(String(body.data.id)); } catch (e) { console.error("Webhook verification failed", e); return new Response("Retry", { status: 500 }); }
  }
  return new Response("OK", { status: 200 });
}
