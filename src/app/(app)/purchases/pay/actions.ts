"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, str } from "@/lib/format";
import { payDoc } from "@/lib/documents";
import { UserError } from "@/lib/ledger";

const BASE = "/purchases/pay";

/** Pays the ticked bills from one account on one date. Either all of them are paid, or none. */
export async function payBills(fd: FormData) {
  const ctx = await requireWrite("purchases");
  const ids = fd.getAll("bill").map(String);
  try {
    const date = str(fd, "date");
    if (!isIsoDate(date) || !ids.length || ids.some((id) => !isUuid(id))) throw new UserError("err_required");
    const db = await getDb();
    await db.transaction(async (tx) => {
      for (const id of ids) {
        await payDoc(tx, "bill", ctx.company.id, ctx.user.id, id, {
          date, amount: parseAmount(fd.get(`amount_${id}`)), moneyAccountId: str(fd, "moneyAccountId"), reference: str(fd, "reference"),
        }, ctx.company.settings);
      }
    });
  } catch (e) { fail(e, BASE); }
  revalidatePath(BASE);
  revalidatePath("/purchases/bills");
  revalidatePath("/journal");
  redirect(`${BASE}?paid=${ids.length}`);
}
