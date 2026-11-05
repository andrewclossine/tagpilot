"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, str, today } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { closePurchaseOrder, deletePurchaseOrder, issuePurchaseOrder, savePurchaseOrder } from "@/lib/purchase-orders";

const BASE = "/procurement/orders";
const refresh = () => { revalidatePath(BASE); revalidatePath("/purchases/orders"); };

export async function saveOrder(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id");
  const back = id ? `${BASE}/${id}?edit=1` : `${BASE}/new`;
  let saved = id;
  try {
    const date = str(fd, "date") || today(), expected = str(fd, "expectedDate");
    if (!isIsoDate(date) || (expected && !isIsoDate(expected))) throw new UserError("err_required");
    if (id && !isUuid(id)) throw new UserError("err_not_found");
    const partnerId = str(fd, "partnerId"), projectId = str(fd, "projectId");
    if (!isUuid(partnerId)) throw new UserError("err_required");
    if (!isUuid(projectId)) throw new UserError("err_po_project");
    const quantities = fd.getAll("lineQuantity").map(String), prices = fd.getAll("linePrice").map(String), vats = fd.getAll("lineVat").map(String);
    const lines = fd.getAll("lineDescription").map(String).map((description, i) => ({
      description: description.trim(), quantity: parseAmount(quantities[i]), unitPrice: parseAmount(prices[i]), vatApplies: vats[i] === "1",
    })).filter((l) => l.description || l.quantity || l.unitPrice);
    const vatRate = ctx.company.vatRegistered ? ctx.company.vatRate : 0;
    const db = await getDb();
    saved = await db.transaction((tx) => savePurchaseOrder(tx, ctx.company.id, ctx.user.id, id || undefined, {
      partnerId, projectId, date, expectedDate: expected || null, notes: str(fd, "notes"),
    }, lines, vatRate));
  } catch (e) { fail(e, back); }
  refresh();
  redirect(`${BASE}/${saved}`);
}

export async function issueOrder(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    const db = await getDb();
    await db.transaction((tx) => issuePurchaseOrder(tx, ctx.company.id, ctx.user.id, id));
  } catch (e) { fail(e, `${BASE}/${id}`); }
  refresh();
  redirect(`${BASE}/${id}`);
}

export async function deleteOrder(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    const db = await getDb();
    await db.transaction((tx) => deletePurchaseOrder(tx, ctx.company.id, ctx.user.id, id));
  } catch (e) { fail(e, `${BASE}/${id}`); }
  refresh();
  redirect(BASE);
}

export async function closeOrder(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id"), note = str(fd, "note");
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    if (!note) throw new UserError("err_reason_required");
    const db = await getDb();
    await db.transaction((tx) => closePurchaseOrder(tx, ctx.company.id, ctx.user.id, id, note));
  } catch (e) { fail(e, `${BASE}/${id}`); }
  refresh();
  redirect(`${BASE}/${id}`);
}
