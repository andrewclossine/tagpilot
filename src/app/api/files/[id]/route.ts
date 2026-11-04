import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { canReadAsBidder, canReadAttachment } from "@/lib/access";
import { getCtx } from "@/lib/auth";
import { isUuid } from "@/lib/format";
import { readAttachment } from "@/lib/storage";

/** Serves a file to those who may see it: members of the organisation that holds it, or a supplier organisation bidding to it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [a] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, id));
  const allowed = a && (a.companyId === ctx.company.id ? await canReadAttachment(db, ctx, a.id) : await canReadAsBidder(db, ctx, a.id));
  if (!a || !allowed) return new Response("Not found", { status: 404 });
  const bytes = await readAttachment(a.storagePath);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": a.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(a.fileName)}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
