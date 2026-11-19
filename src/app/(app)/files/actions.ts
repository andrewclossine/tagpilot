"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isUuid, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { audit } from "@/lib/audit";
import { FILE_TYPES, folderArea, isFolder } from "@/lib/myfiles";
import { MAX_UPLOAD, saveAttachment } from "@/lib/storage";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Puts one or more files into a month of a folder. Only people who may change that part of the books can. */
export async function uploadToFolder(fd: FormData) {
  const ctx = await getCtx();
  const folder = str(fd, "folder"), month = str(fd, "month");
  const back = isFolder(folder) && MONTH.test(month) ? `/files/${folder}/${month}` : "/files";
  try {
    if (!isFolder(folder) || !MONTH.test(month)) throw new UserError("err_not_found");
    if (!ctx.can(folderArea(folder), "write")) throw new UserError("err_no_access");
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new UserError("err_file_required");
    if (files.length > 20) throw new UserError("err_mf_too_many");
    for (const f of files) {
      if (f.size > MAX_UPLOAD) throw new UserError("err_file_size");
      if (!FILE_TYPES.includes(f.type)) throw new UserError("err_mf_type");
    }
    const db = await getDb();
    for (const f of files) {
      const { id } = await saveAttachment(ctx.company.id, ctx.user.id, f);
      await db.insert(schema.fileUploads).values({ companyId: ctx.company.id, folder, month, attachmentId: id, uploadedBy: ctx.user.id });
    }
    await audit(db, ctx.company.id, ctx.user.id, "upload", "my_files", `${folder}/${month}`, { files: files.length });
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}

/** Takes a file someone put in a folder out again. Documents the system keeps are not deleted from here. */
export async function deleteUpload(fd: FormData) {
  const ctx = await getCtx();
  const id = str(fd, "id");
  let back = "/files";
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    const db = await getDb();
    const [u] = await db.select({ u: schema.fileUploads, name: schema.attachments.fileName }).from(schema.fileUploads)
      .innerJoin(schema.attachments, eq(schema.attachments.id, schema.fileUploads.attachmentId))
      .where(and(eq(schema.fileUploads.id, id), eq(schema.fileUploads.companyId, ctx.company.id)));
    if (!u) throw new UserError("err_not_found");
    back = `/files/${u.u.folder}/${u.u.month}`;
    if (!ctx.can(folderArea(u.u.folder), "write")) throw new UserError("err_no_access");
    // The upload row goes with its file; the stored bytes stay with the attachment record, which nothing else uses.
    await db.delete(schema.fileUploads).where(eq(schema.fileUploads.id, id));
    await audit(db, ctx.company.id, ctx.user.id, "delete", "my_files", `${u.u.folder}/${u.u.month}`, { file: u.name });
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}
