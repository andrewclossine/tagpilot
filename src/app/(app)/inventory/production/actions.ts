"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, str, today } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { cancelOrder, createOrder, finishOrder, startOrder, updateOrderDraft } from "@/lib/manufacturing";

const BASE = "/inventory/production";
const dateOf = (fd: FormData, key = "date") => { const d = str(fd, key); if (!isIsoDate(d)) throw new UserError("err_required"); return d; };

export async function newProductionOrder(fd: FormData) {
  const ctx = await requireWrite("inventory");
  let id: string;
  try {
    const itemId = str(fd, "itemId");
    if (!isUuid(itemId)) throw new UserError("err_required");
    const plannedDate = isIsoDate(str(fd, "plannedDate")) ? str(fd, "plannedDate") : today();
    const db = await getDb();
    id = await db.transaction((tx) => createOrder(tx, ctx.company.id, ctx.user.id, { itemId, quantity: parseAmount(fd.get("quantity")), plannedDate, notes: str(fd, "notes") }));
  } catch (e) { fail(e, `${BASE}/new`); }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}`);
}

/** Saves a draft run; with "start" it also issues the materials. */
export async function saveProductionDraft(fd: FormData) {
  const ctx = await requireWrite("inventory");
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    const lines = new Map<string, number>();
    fd.getAll("lineId").forEach((l, i) => { if (isUuid(String(l))) lines.set(String(l), parseAmount(fd.getAll("lineQty")[i] ?? "")); });
    const db = await getDb();
    await db.transaction(async (tx) => {
      await updateOrderDraft(tx, ctx.company.id, id, { quantity: parseAmount(fd.get("quantity")), plannedDate: isIsoDate(str(fd, "plannedDate")) ? str(fd, "plannedDate") : today(), notes: str(fd, "notes"), lines });
      if (str(fd, "do") === "start") await startOrder(tx, ctx.company.id, ctx.user.id, id, dateOf(fd, "startDate"));
    });
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  revalidatePath("/inventory");
  redirect(`${BASE}/${id}?saved=1`);
}

export async function finishProduction(fd: FormData) {
  const ctx = await requireWrite("inventory");
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    const db = await getDb();
    await db.transaction((tx) => finishOrder(tx, ctx.company.id, ctx.user.id, id, dateOf(fd), parseAmount(fd.get("quantityMade"))));
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  revalidatePath("/inventory");
  redirect(`${BASE}/${id}?saved=1`);
}

export async function cancelProduction(fd: FormData) {
  const ctx = await requireWrite("inventory");
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    const db = await getDb();
    await db.transaction((tx) => cancelOrder(tx, ctx.company.id, ctx.user.id, id, isIsoDate(str(fd, "date")) ? str(fd, "date") : today()));
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  revalidatePath("/inventory");
  redirect(`${BASE}/${id}?saved=1`);
}
