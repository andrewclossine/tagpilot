import crypto from "node:crypto";
import { getDb } from "@/db";
import { runDailyNotices } from "@/lib/notices";

/**
 * The daily reminders, called once a day by the server's scheduler with the secret in CRON_SECRET.
 * Without that secret set, it does nothing.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("x-cron-secret") ?? "";
  const ok = secret.length >= 24 && given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return new Response("Not found", { status: 404 });
  try {
    const result = await runDailyNotices(await getDb());
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("Daily notices failed", e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
