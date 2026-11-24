import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { bySigningToken } from "@/lib/esign";
import { readAttachment } from "@/lib/storage";

/** The document a signer's link opens: the PDF to sign, then, once everyone has signed, the signed copy. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await bySigningToken(token);
  if (!row || row.d.status === "draft" || row.d.status === "voided") return new Response("Not found", { status: 404 });
  const signed = new URL(req.url).searchParams.get("kind") === "signed" && row.d.status === "completed";
  const attId = signed ? row.d.finalAttachmentId : row.d.originalAttachmentId;
  if (!attId) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [att] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, attId));
  const bytes = await readAttachment(att.storagePath);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="document.pdf"`, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
}
