"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, str, today } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { countStock, ensureInventoryAccounts, openingStock } from "@/lib/inventory";
import { getI18n } from "@/lib/i18n";
import { audit } from "@/lib/audit";

function itemValues(fd: FormData) {
  return {
    sku: str(fd, "sku").toUpperCase(), name: str(fd, "name"), unit: str(fd, "unit") || "pcs",
    kind: (str(fd, "kind") === "service" ? "service" : "stock") as "stock" | "service",
    salePrice: parseAmount(fd.get("salePrice")), purchaseCost: parseAmount(fd.get("purchaseCost")),
    inventoryAccount: str(fd, "inventoryAccount") || "1300", incomeAccount: str(fd, "incomeAccount") || "4100",
    cogsAccount: str(fd, "cogsAccount") || "5100", expenseAccount: str(fd, "expenseAccount") || "6900",
    reorderLevel: parseAmount(fd.get("reorderLevel")), isActive: str(fd, "isActive") !== "0",
  };
}

/** Creates an item; opening stock, if given, is booked against the account chosen (retained earnings by default). */
export async function createItem(fd: FormData) {
  const ctx = await requireWrite("inventory");
  const { t } = await getI18n();
  let id: string;
  try {
    const v = itemValues(fd);
    if (!v.sku || !v.name || !/^[A-Z0-9._-]+$/.test(v.sku)) throw new UserError("err_required");
    const db = await getDb();
    id = await db.transaction(async (tx) => {
      await ensureInventoryAccounts(tx, ctx.company.id);
      const [it] = await tx.insert(schema.items).values({ ...v, companyId: ctx.company.id }).returning({ id: schema.items.id });
      const qty = parseAmount(fd.get("openingQty"));
      if (v.kind === "stock" && qty > 0) {
        const date = isIsoDate(str(fd, "openingDate")) ? str(fd, "openingDate") : today();
        await openingStock(tx, ctx.company.id, ctx.user.id, it.id, date, qty, parseAmount(fd.get("openingCost")) || v.purchaseCost, str(fd, "openingCredit") || "3200", t("inv_opening"));
      }
      await audit(tx, ctx.company.id, ctx.user.id, "create", "item", v.sku);
      return it.id;
    });
  } catch (e) { fail(e, "/inventory/new"); }
  revalidatePath("/inventory");
  redirect(`/inventory/${id}`);
}

export async function updateItem(fd: FormData) {
  const ctx = await requireWrite("inventory");
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    const { kind: _kind, ...v } = itemValues(fd); // an item's kind cannot change once it has stock history
    if (!v.sku || !v.name) throw new UserError("err_required");
    const db = await getDb();
    await db.update(schema.items).set(v).where(and(eq(schema.items.id, id), eq(schema.items.companyId, ctx.company.id)));
    await audit(db, ctx.company.id, ctx.user.id, "update", "item", v.sku);
  } catch (e) { fail(e, `/inventory/${id}`); }
  revalidatePath("/inventory");
  redirect(`/inventory/${id}?saved=1`);
}

/** Stock count: the quantity counted replaces the quantity in the books; the difference is booked. */
export async function countItem(fd: FormData) {
  const ctx = await requireWrite("inventory");
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    const date = str(fd, "date");
    if (!isIsoDate(date) || str(fd, "counted") === "") throw new UserError("err_required");
    const counted = parseAmount(fd.get("counted"));
    if (counted < 0) throw new UserError("err_amount");
    const db = await getDb();
    await db.transaction(async (tx) => {
      await ensureInventoryAccounts(tx, ctx.company.id);
      await countStock(tx, ctx.company.id, ctx.user.id, id, date, counted, parseAmount(fd.get("unitCost")) || undefined, str(fd, "reason"));
    });
  } catch (e) { fail(e, `/inventory/${id}`); }
  revalidatePath("/inventory");
  redirect(`/inventory/${id}?saved=1`);
}
