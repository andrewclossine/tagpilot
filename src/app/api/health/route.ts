import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/** For the hosting platform: answers 200 when the app and its database respond. */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("Health check failed", e);
    return Response.json({ ok: false }, { status: 503 });
  }
}
