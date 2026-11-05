"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isUuid, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { acceptSupplierBill, rejectSupplierBill } from "@/lib/purchasing";

const BASE = "/purchases/received-bills";

/** Takes a supplier's bill into the books as a draft bill, to check and approve. */
export async function acceptBill(fd: FormData) {
  const ctx = await requireWrite("purchases");
  let billId = "";
  try {
    const accountId = str(fd, "accountId");
    if (!isUuid(accountId)) throw new UserError("err_account");
    const db = await getDb();
    const [account] = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.companyId, ctx.company.id)));
    if (!account) throw new UserError("err_account");
    const vatRate = ctx.company.vatRegistered ? ctx.company.vatRate : 0;
    billId = await db.transaction((tx) => acceptSupplierBill(tx, ctx.company.id, ctx.user.id, str(fd, "id"), accountId, fd.get("vatApplies") === "on" && vatRate > 0, vatRate));
  } catch (e) { fail(e, BASE); }
  revalidatePath(BASE);
  redirect(`/purchases/bills/${billId}`);
}

export async function rejectBill(fd: FormData) {
  const ctx = await requireWrite("purchases");
  try {
    const note = str(fd, "note");
    if (!note) throw new UserError("err_reason_required");
    const db = await getDb();
    await db.transaction((tx) => rejectSupplierBill(tx, ctx.company.id, ctx.user.id, str(fd, "id"), note));
  } catch (e) { fail(e, BASE); }
  revalidatePath(BASE);
  redirect(BASE);
}
