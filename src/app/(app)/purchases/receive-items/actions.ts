"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, str, today } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { UserError } from "@/lib/ledger";
import { billFromReceipt, receiveGoods, voidReceipt, type ReceiptLine } from "@/lib/purchasing";
import { optionalUpload } from "@/lib/upload";

const BASE = "/purchases/receive-items";

/** Records a supplier's delivery note. The goods enter inventory now; the bill can come later. */
export async function receiveItems(fd: FormData) {
  const ctx = await requireWrite("purchases");
  let id = "";
  try {
    const partnerId = str(fd, "partnerId"), date = str(fd, "date");
    if (!isUuid(partnerId) || !isIsoDate(date)) throw new UserError("err_required");
    const lines: ReceiptLine[] = fd.getAll("itemId").map((v, i) => {
      const cost = String(fd.getAll("unitCost")[i] ?? "").trim();
      return { itemId: String(v), quantity: parseAmount(fd.getAll("quantity")[i]), unitCost: cost ? parseAmount(cost) : null };
    }).filter((l) => isUuid(l.itemId));
    const db = await getDb();
    const [partner] = await db.select({ id: schema.partners.id }).from(schema.partners).where(and(eq(schema.partners.id, partnerId), eq(schema.partners.companyId, ctx.company.id)));
    if (!partner) throw new UserError("err_not_found");
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    id = await db.transaction((tx) => receiveGoods(tx, ctx.company.id, ctx.user.id, {
      partnerId, date, deliveryNote: str(fd, "deliveryNote"), notes: str(fd, "notes"), attachmentId, lines,
    }));
  } catch (e) { fail(e, `${BASE}/new`); }
  revalidatePath(BASE);
  revalidatePath("/inventory");
  redirect(`${BASE}/${id}`);
}

export async function makeBill(fd: FormData) {
  const ctx = await requireWrite("purchases");
  const id = str(fd, "id");
  let billId = "";
  try {
    const db = await getDb();
    billId = await db.transaction((tx) => billFromReceipt(tx, ctx.company.id, ctx.user.id, id, ctx.company.vatRegistered ? ctx.company.vatRate : 0));
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  redirect(`/purchases/bills/${billId}`);
}

export async function cancelReceipt(fd: FormData) {
  const ctx = await requireWrite("purchases");
  const id = str(fd, "id");
  const { t } = await getI18n();
  try {
    const db = await getDb();
    await db.transaction((tx) => voidReceipt(tx, ctx.company.id, ctx.user.id, id, today(), t("reverse_of")));
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  revalidatePath("/inventory");
  redirect(`${BASE}/${id}`);
}
