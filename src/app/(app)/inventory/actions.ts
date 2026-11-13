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
import { CLASS_ACCOUNT, ensureManufacturingAccounts, saveBom } from "@/lib/manufacturing";
import type { StockClass } from "@/db/schema";

const CLASSES: StockClass[] = ["goods", "raw", "finished"];

function itemValues(fd: FormData) {
  return {
    sku: str(fd, "sku").toUpperCase(), name: str(fd, "name"), unit: str(fd, "unit") || "pcs",
    kind: (str(fd, "kind") === "service" ? "service" : "stock") as "stock" | "service",
    stockClass: (CLASSES as string[]).includes(str(fd, "stockClass")) ? str(fd, "stockClass") as StockClass : "goods",
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
      // Raw materials and products are kept in their own accounts unless another one was chosen.
      if (v.stockClass !== "goods") {
        await ensureManufacturingAccounts(tx, ctx.company.id);
        if (v.inventoryAccount === "1300") v.inventoryAccount = CLASS_ACCOUNT[v.stockClass];
      }
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
    if (v.stockClass !== "goods") await ensureManufacturingAccounts(db, ctx.company.id);
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

/** Saves what one unit of a product is made of, and the labour and overhead per unit. */
export async function saveItemBom(fd: FormData) {
  const ctx = await requireWrite("inventory");
  const id = str(fd, "id");
  try {
    if (!isUuid(id)) throw new UserError("err_not_found");
    const comps = fd.getAll("componentId").map(String), qtys = fd.getAll("componentQty");
    const lines = comps.map((componentId, i) => ({ componentId: isUuid(componentId) ? componentId : "", quantity: parseAmount(qtys[i] ?? "") }));
    const db = await getDb();
    await db.transaction(async (tx) => {
      await ensureManufacturingAccounts(tx, ctx.company.id);
      await saveBom(tx, ctx.company.id, ctx.user.id, id, lines, parseAmount(fd.get("conversionCost")));
    });
  } catch (e) { fail(e, `/inventory/${id}`); }
  revalidatePath("/inventory");
  redirect(`/inventory/${id}?saved=1#bom`);
}
