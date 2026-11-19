import JSZip from "jszip";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { folderFiles, isFolder, folderArea, uniqueNames } from "@/lib/myfiles";
import { readAttachment } from "@/lib/storage";

const MAX_FILES = 500;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * A folder of My Files as a zip: one month, or a whole year with a folder per month. Attached files are read from
 * storage; printed documents are made by the same address that opens them, with the reader's own sign-in, so the zip
 * holds exactly what they may open one by one.
 */
export async function GET(req: Request) {
  const ctx = await getCtx();
  const url = new URL(req.url);
  const folder = url.searchParams.get("folder") ?? "", from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
  if (!isFolder(folder) || !MONTH.test(from) || !MONTH.test(to) || from > to || !ctx.can(folderArea(folder))) return new Response("Not found", { status: 404 });
  const { t } = await getI18n();
  const items = (await folderFiles(ctx, folder, from, to)).slice(0, MAX_FILES);
  const db = await getDb();
  const ids = items.flatMap((i) => (i.attachmentId ? [i.attachmentId] : []));
  const paths = new Map((ids.length ? await db.select({ id: schema.attachments.id, path: schema.attachments.storagePath }).from(schema.attachments)
    .where(and(eq(schema.attachments.companyId, ctx.company.id), inArray(schema.attachments.id, ids))) : []).map((a) => [a.id, a.path]));
  // Printed documents come from this same server, asked as the reader.
  const base = process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : url.origin;
  const cookie = req.headers.get("cookie") ?? "";
  const zip = new JSZip();
  const months = from.slice(0, 4) !== to.slice(0, 4) || from !== to;
  const byMonth = new Map<string, typeof items>();
  for (const it of items) byMonth.set(it.month, [...(byMonth.get(it.month) ?? []), it]);
  for (const [month, list] of byMonth) {
    const dir = months ? zip.folder(`${month} ${t(`mf_m_${month.slice(5)}` as never)}`)! : zip;
    const names = uniqueNames(list);
    for (const [i, it] of list.entries()) {
      try {
        let bytes: Buffer | null = null;
        if (it.attachmentId && paths.get(it.attachmentId)) bytes = await readAttachment(paths.get(it.attachmentId)!);
        else if (it.kind === "generated") {
          const res = await fetch(base + it.href, { headers: { cookie }, cache: "no-store" });
          if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
        }
        if (bytes) dir.file(names[i], bytes);
      } catch (e) { console.error("my files zip: skipped", it.href, (e as Error).message); }
    }
  }
  const body = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const label = `${t(`mf_f_${folder}` as never)} ${from === to ? from : from.slice(0, 4) === to.slice(0, 4) && from.endsWith("-01") && to.endsWith("-12") ? from.slice(0, 4) : `${from} - ${to}`}`;
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${encodeURIComponent(label)}.zip"`, "Cache-Control": "private, no-store" },
  });
}
