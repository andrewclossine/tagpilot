import crypto from "node:crypto";
import { getDb } from "@/db";
import { runDailyNotices } from "@/lib/notices";
import { runDailyAccounting } from "@/lib/reminders";

/**
 * The daily run (recurring documents, payment and procurement reminders), called once a day by the server's scheduler with the secret in CRON_SECRET.
 * Without that secret set, it does nothing.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("x-cron-secret") ?? "";
  const ok = secret.length >= 24 && given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return new Response("Not found", { status: 404 });
  try {
    const db = await getDb();
    // Recurring documents do not need email, so they run even when reminders cannot be sent.
    const accounting = await runDailyAccounting(db);
    const result = await runDailyNotices(db);
    return Response.json({ ok: true, ...result, accounting });
  } catch (e) {
    console.error("Daily notices failed", e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
