import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { readAttachment } from "@/lib/storage";

/** The file a dynamic file QR code opens (a menu, a brochure, a price list). Public, as the code itself is. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[A-Za-z0-9]{4,16}$/.test(slug)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [c] = await db.select().from(schema.qrCodes).where(eq(schema.qrCodes.slug, slug));
  if (!c || !c.active || c.type !== "file" || !c.fileAttachmentId) return new Response("Not found", { status: 404 });
  const [att] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, c.fileAttachmentId));
  if (!att) return new Response("Not found", { status: 404 });
  const bytes = await readAttachment(att.storagePath);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": att.mimeType, "Content-Disposition": `inline; filename="${att.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"`, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
