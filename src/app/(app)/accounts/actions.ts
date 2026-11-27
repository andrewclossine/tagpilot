"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { getCtx } from "@/lib/auth";
import { isAccountKind, KIND_SPEC, nextCode } from "@/lib/account-kinds";

export type NewAccount = { id: string; code: string; name: string; type: string; subtype: string | null; kind: string | null };

/**
 * Adds an account from any account list, without leaving the page: the person picks the account type, the code is
 * suggested in that type's range, and the new account comes back to be chosen at once.
 */
export async function quickAddAccount(input: { kind: string; code: string; name: string }): Promise<{ ok: true; account: NewAccount } | { ok: false; error: string }> {
  const ctx = await getCtx();
  if (!ctx.can("accounts", "write")) return { ok: false, error: "err_forbidden" };
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!isAccountKind(input.kind)) return { ok: false, error: "err_acc_kind" };
  if (!name) return { ok: false, error: "err_acc_name" };
  const spec = KIND_SPEC[input.kind];
  const db = await getDb();
  const used = (await db.select({ code: schema.accounts.code }).from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id))).map((a) => a.code);
  const code = String(input.code ?? "").trim() || nextCode(input.kind, used);
  if (!/^[A-Za-z0-9._-]{1,20}$/.test(code)) return { ok: false, error: "err_acc_code" };
  if (used.includes(code)) return { ok: false, error: "err_acc_code_used" };
  const [same] = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.companyId, ctx.company.id), eq(schema.accounts.nameEn, name)));
  if (same) return { ok: false, error: "err_acc_name_used" };
  const [row] = await db.insert(schema.accounts).values({ companyId: ctx.company.id, code, nameEn: name, nameFr: name, type: spec.type, subtype: spec.subtype, kind: input.kind }).returning();
  await audit(db, ctx.company.id, ctx.user.id, "create", "account", code, { from: "picker" });
  revalidatePath("/accounts");
  return { ok: true, account: { id: row.id, code: row.code, name: row.nameEn, type: row.type, subtype: row.subtype, kind: row.kind } };
}
