import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { isUuid } from "@/lib/format";
import { loadDoc } from "@/lib/esign";
import { readAttachment } from "@/lib/storage";

/** A document's PDF for its organisation: the original, or the signed copy with its certificate (?kind=signed). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireView("esign");
  const { id } = await params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const loaded = await loadDoc(db, ctx.company.id, id);
  if (!loaded) return new Response("Not found", { status: 404 });
  const signed = new URL(req.url).searchParams.get("kind") === "signed";
  const attId = signed ? loaded.doc.finalAttachmentId : loaded.doc.originalAttachmentId;
  if (!attId) return new Response("Not found", { status: 404 });
  const [att] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, attId));
  const bytes = await readAttachment(att.storagePath);
  const name = `${loaded.doc.title}${signed ? " - signed" : ""}.pdf`;
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"`, "Cache-Control": "private, no-store" } });
}
