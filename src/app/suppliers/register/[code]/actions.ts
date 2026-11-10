"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, count, gt, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { hashPassword } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUsername, str, today } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { companyByCode, EXPIRING, REQUIRED_DOCS, registerSupplier, type RegistrationInput } from "@/lib/suppliers";
import { optionalUpload } from "@/lib/upload";

const PER_HOUR = 5;

/** A supplier registers itself through the organisation's link. Five registrations an hour from one address at most. */
export async function registerAction(fd: FormData) {
  const code = str(fd, "code"), back = `/suppliers/register/${encodeURIComponent(code)}`;
  // Left empty by people; bots fill every field.
  if (str(fd, "homepage")) redirect(`${back}?done=1`);
  const db = await getDb();
  const company = await companyByCode(db, code);
  if (!company) redirect("/login");
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
  const key = `reg:${ip}`;
  const [{ n }] = await db.select({ n: count() }).from(schema.loginFailures).where(and(eq(schema.loginFailures.key, key), gt(schema.loginFailures.at, new Date(Date.now() - 3600000))));
  if (n >= PER_HOUR) redirect(`${back}?error=err_too_many`);
  try {
    const username = str(fd, "username").toLowerCase(), password = String(fd.get("password") ?? "");
    if (!isUsername(username)) throw new UserError("err_username");
    if (password.length < 8) throw new UserError("err_password_short");
    if (password !== String(fd.get("password2") ?? "")) throw new UserError("err_password_match");
    const email = str(fd, "email").toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("err_email");
    const [taken] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, username));
    if (taken) throw new UserError("err_username_taken");
    // Dates first, files after: nothing is stored for a form that is going to be refused.
    const expiry = (k: string) => { const v = str(fd, `exp_${k}`); return v && isIsoDate(v) ? v : null; };
    for (const k of REQUIRED_DOCS) {
      const f = fd.get(`doc_${k}`);
      if (!(f instanceof File) || !f.size) throw new UserError("err_supplier_docs");
      if (EXPIRING.includes(k) && !((expiry(k) ?? "") >= today())) throw new UserError("err_supplier_doc_expiry");
    }
    const tin = str(fd, "tin");
    if (!tin || !str(fd, "companyName") || !str(fd, "contact")) throw new UserError("err_required");
    const [same] = await db.select({ id: schema.partners.id }).from(schema.partners)
      .where(and(eq(schema.partners.companyId, company.id), sql`lower(${schema.partners.tin}) = ${tin.toLowerCase()}`));
    if (same) throw new UserError("err_supplier_exists");
    const documents: RegistrationInput["documents"] = [];
    for (const k of REQUIRED_DOCS) {
      const attachmentId = await optionalUpload(company.id, null, fd, `doc_${k}`);
      documents.push({ kind: k, reference: str(fd, `ref_${k}`), expiresOn: expiry(k), attachmentId: attachmentId! });
    }
    const passwordHash = await hashPassword(password);
    await db.transaction((tx) => registerSupplier(tx, company.id, {
      companyName: str(fd, "companyName"), tin: str(fd, "tin"), phone: str(fd, "phone"), email, address: str(fd, "address"), website: str(fd, "website"),
      contact: str(fd, "contact"), username, passwordHash, categories: fd.getAll("category").map(String), documents,
    }));
    await db.insert(schema.loginFailures).values({ key });
  } catch (e) { fail(e, back); }
  redirect("/login?registered=1");
}
