"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail, withParam } from "@/lib/actions";
import { isIsoDate, isUuid, str, today } from "@/lib/format";
import { addLine } from "@/lib/banking-form";
import { recordExpense } from "@/lib/banking";
import { UserError } from "@/lib/ledger";
import { optionalUpload } from "@/lib/upload";

const BASE = "/purchases/expenses";

/** Records an expense paid on the spot, with its receipt attached when there is one. */
export async function saveExpense(fd: FormData) {
  const ctx = await requireWrite("purchases");
  try {
    const date = str(fd, "date") || today();
    if (!isIsoDate(date)) throw new UserError("err_required");
    const db = await getDb();
    let partnerId: string | null = null, payee = str(fd, "payee");
    if (isUuid(str(fd, "partnerId"))) {
      const [p] = await db.select().from(schema.partners).where(and(eq(schema.partners.id, str(fd, "partnerId")), eq(schema.partners.companyId, ctx.company.id)));
      if (!p) throw new UserError("err_not_found");
      partnerId = p.id; payee = payee || p.name;
    }
    if (!payee) throw new UserError("err_expense_payee");
    const vats = fd.getAll("lineVat").map(String);
    // addLine skips empty rows, so the VAT choice is read against the same rows it keeps.
    const kept = fd.getAll("lineAccount").map(String).map((a, i) => ({ a, amt: String(fd.getAll("lineAmount")[i] ?? ""), vat: vats[i] === "1" })).filter((r) => r.a || r.amt.trim());
    const lines = addLine(fd).map((l, i) => ({ ...l, vatApplies: kept[i]?.vat ?? false }));
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    const rate = ctx.company.vatRegistered ? ctx.company.vatRate : 0;
    await db.transaction((tx) => recordExpense(tx, ctx.company.id, ctx.user.id, str(fd, "accountId"),
      { date, reference: str(fd, "reference"), memo: str(fd, "memo"), partnerId, payee, attachmentId }, lines, { rate, accountCode: ctx.company.settings.vatIn }));
  } catch (e) { fail(e, BASE); }
  revalidatePath(BASE);
  revalidatePath("/banking", "layout");
  revalidatePath("/journal");
  redirect(withParam(BASE, "saved", "1"));
}
