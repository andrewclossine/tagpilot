"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { requireWrite } from "@/lib/auth";
import { isIsoDate, str } from "@/lib/format";
import { taxLinesFor, type TaxLine } from "@/lib/tax-lines";

/** Saves which income tax line each income and expense account belongs to. */
export async function saveTaxLines(fd: FormData) {
  const ctx = await requireWrite("accounts");
  const db = await getDb();
  const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id));
  let changed = 0;
  await db.transaction(async (tx) => {
    for (const a of accounts) {
      const line = str(fd, `tax_${a.id}`);
      if (!line || line === a.taxLine || !taxLinesFor(a.type).includes(line as TaxLine)) continue;
      await tx.update(schema.accounts).set({ taxLine: line }).where(eq(schema.accounts.id, a.id));
      changed++;
    }
    if (changed) await audit(tx, ctx.company.id, ctx.user.id, "update", "tax_lines", ctx.company.id, { accounts: changed });
  });
  revalidatePath("/reports/tax-prep");
  const from = str(fd, "from"), to = str(fd, "to");
  redirect(`/reports/tax-prep?saved=1${isIsoDate(from) ? `&from=${from}` : ""}${isIsoDate(to) ? `&to=${to}` : ""}`);
}
