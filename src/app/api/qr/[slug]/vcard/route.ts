import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { qrContent } from "@/lib/qr";

/** A dynamic contact code's card, to save to the phone's contacts. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[A-Za-z0-9]{4,16}$/.test(slug)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [c] = await db.select().from(schema.qrCodes).where(eq(schema.qrCodes.slug, slug));
  if (!c || !c.active || c.type !== "vcard") return new Response("Not found", { status: 404 });
  return new Response(qrContent("vcard", c.data).replace(/\n/g, "\r\n"), { headers: { "Content-Type": "text/vcard; charset=utf-8", "Content-Disposition": `attachment; filename="contact.vcf"` } });
}
