"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { billFromOrder } from "@/lib/purchase-orders";

/** The supplier sent a bill for this order: it becomes a draft bill, with the order's project or cost center, to check and approve. */
export async function receiveOrderBill(fd: FormData) {
  const ctx = await requireWrite("purchases");
  const id = str(fd, "id");
  let billId = "";
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    const date = str(fd, "date"), dueDate = str(fd, "dueDate");
    if (!isIsoDate(date) || !isIsoDate(dueDate)) throw new UserError("err_required");
    const quantities = fd.getAll("lineQuantity").map(String), prices = fd.getAll("linePrice").map(String), accounts = fd.getAll("lineAccount").map(String);
    const lines = fd.getAll("lineId").map(String).map((lineId, i) => ({ lineId, quantity: parseAmount(quantities[i]), unitPrice: parseAmount(prices[i]), accountId: accounts[i] ?? "" }));
    if (lines.some((l) => !isUuid(l.lineId))) throw new UserError("err_not_found");
    const db = await getDb();
    billId = await db.transaction((tx) => billFromOrder(tx, ctx.company.id, ctx.user.id, id, {
      supplierRef: str(fd, "supplierRef"), date, dueDate, vatRate: ctx.company.vatRegistered ? ctx.company.vatRate : 0, lines,
    }));
  } catch (e) { fail(e, `/purchases/orders/${id}`); }
  revalidatePath("/purchases/orders");
  revalidatePath("/procurement/orders");
  redirect(`/purchases/bills/${billId}`);
}
