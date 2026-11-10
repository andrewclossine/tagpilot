"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, str, today } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { closePurchaseOrder, deletePurchaseOrder, issuePurchaseOrder, savePurchaseOrder } from "@/lib/purchase-orders";
import { receiveGoods, voidReceipt } from "@/lib/receipts";
import { rateOrder } from "@/lib/suppliers";
import { optionalUpload } from "@/lib/upload";

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
      partnerId, projectId, date, expectedDate: expected || null, notes: str(fd, "notes"), requireReceipt: fd.get("requireReceipt") === "on",
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

/** Records a goods received note: what arrived on each line, what passed inspection, and any defects. */
export async function receiveOrder(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id"), back = `${BASE}/${id}`;
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    const date = str(fd, "date") || today();
    if (!isIsoDate(date)) throw new UserError("err_required");
    const lineIds = fd.getAll("grnLine").map(String);
    const lines = lineIds.map((lineId) => {
      const received = parseAmount(fd.get(`received_${lineId}`));
      const acceptedRaw = str(fd, `accepted_${lineId}`);
      return { lineId, received, accepted: acceptedRaw === "" ? received : parseAmount(acceptedRaw), note: str(fd, `grnNote_${lineId}`) };
    });
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    const db = await getDb();
    await db.transaction((tx) => receiveGoods(tx, ctx, id, {
      date, deliveryNote: str(fd, "deliveryNote"), defects: str(fd, "defects"), attachmentId, lines,
      checks: { quantity: fd.get("chkQuantity") === "on", specification: fd.get("chkSpecification") === "on", condition: fd.get("chkCondition") === "on", documents: fd.get("chkDocuments") === "on" },
    }));
  } catch (e) { fail(e, back); }
  refresh();
  revalidatePath(back);
  redirect(`${back}#receipts`);
}

export async function voidOrderReceipt(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id"), back = `${BASE}/${id}`;
  try {
    const db = await getDb();
    await db.transaction((tx) => voidReceipt(tx, ctx, str(fd, "receiptId"), str(fd, "note")));
  } catch (e) { fail(e, back); }
  refresh();
  revalidatePath(back);
  redirect(`${back}#receipts`);
}

/** Rates how the supplier did on this order, once something was received. Rating again replaces it. */
export async function rateOrderAction(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id"), back = `${BASE}/${id}`;
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    const db = await getDb();
    await db.transaction((tx) => rateOrder(tx, ctx, id, { quality: Number(str(fd, "quality")), delivery: Number(str(fd, "delivery")), service: Number(str(fd, "service")), comment: str(fd, "comment") }));
  } catch (e) { fail(e, back); }
  revalidatePath(back);
  redirect(`${back}#rating`);
}
