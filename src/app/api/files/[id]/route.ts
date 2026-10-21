import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { readAttachment } from "@/lib/storage";

/** Serves a supporting document to members of the company that owns it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const db = await getDb();
  const [a] = await db.select().from(schema.attachments)
    .where(and(eq(schema.attachments.id, id), eq(schema.attachments.companyId, ctx.company.id)));
  if (!a) return new Response("Not found", { status: 404 });
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
