import "server-only";
import { UserError } from "./ledger";
import { ALLOWED_TYPES, MAX_UPLOAD, saveAttachment } from "./storage";

/** Saves the file a form sent under `field`, if any, and returns its attachment id. */
export async function optionalUpload(companyId: string, userId: string | null, fd: FormData, field = "file"): Promise<string | null> {
  const file = fd.get(field);
  if (!(file instanceof File) || !file.size) return null;
  if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) throw new UserError("err_file_type");
  if (file.size > MAX_UPLOAD) throw new UserError("err_file_size");
  return (await saveAttachment(companyId, userId, file)).id;
}
