"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail, withParam } from "@/lib/actions";
import { isIsoDate, parseAmount, round2, str } from "@/lib/format";
import { accountIdByCode, saveEntry, UserError } from "@/lib/ledger";
import { recordMovement, runDepreciation } from "@/lib/assets";
import { getI18n } from "@/lib/i18n";
import { audit } from "@/lib/audit";
import type { DepMethod } from "@/db/schema";

const methodOf = (fd: FormData): DepMethod => (str(fd, "method") === "reducing_balance" ? "reducing_balance" : "straight_line");

/** Registers an asset and books its cost against the account it was paid or owed from. */
export async function createAsset(fd: FormData) {
  const ctx = await requireWrite("assets");
  let id: string;
  try {
    const name = str(fd, "name"), categoryId = str(fd, "categoryId"), acquisitionDate = str(fd, "acquisitionDate");
    const cost = parseAmount(fd.get("cost")), creditAccountId = str(fd, "creditAccountId");
    if (!name || !categoryId || !isIsoDate(acquisitionDate) || !creditAccountId) throw new UserError("err_required");
    if (cost <= 0) throw new UserError("err_amount");
    const db = await getDb();
    id = await db.transaction(async (tx) => {
      const [cat] = await tx.select().from(schema.assetCategories).where(and(eq(schema.assetCategories.id, categoryId), eq(schema.assetCategories.companyId, ctx.company.id)));
      if (!cat) throw new UserError("err_required");
      const [{ n }] = await tx.select({ n: count() }).from(schema.fixedAssets).where(eq(schema.fixedAssets.companyId, ctx.company.id));
      const method = methodOf(fd);
      const [a] = await tx.insert(schema.fixedAssets).values({
        companyId: ctx.company.id, code: str(fd, "code") || `FA-${String(n + 1).padStart(4, "0")}`, name, categoryId,
        projectId: str(fd, "projectId") || null, location: str(fd, "location"), serialNo: str(fd, "serialNo"),
        acquisitionDate, availableDate: isIsoDate(str(fd, "availableDate")) ? str(fd, "availableDate") : acquisitionDate,
        residualValue: parseAmount(fd.get("residualValue")), usefulLifeMonths: Math.max(1, Math.round(parseAmount(fd.get("usefulLifeMonths")) || cat.usefulLifeMonths)),
        method, rate: method === "reducing_balance" ? parseAmount(fd.get("rate")) || Number(cat.rate) : 0,
      }).returning();
      const entryId = await saveEntry(tx, ctx.company.id, ctx.user.id, {
        date: acquisitionDate, reference: a.code, memo: `Acquisition - ${a.code} ${a.name}`, projectId: a.projectId,
        lines: [
          { accountId: await accountIdByCode(tx, ctx.company.id, cat.assetAccount), debit: cost, credit: 0 },
          { accountId: creditAccountId, debit: 0, credit: cost },
        ],
      }, true);
      await tx.insert(schema.assetMovements).values({ companyId: ctx.company.id, assetId: a.id, date: acquisitionDate, type: "acquisition", cost, entryId });
      await audit(tx, ctx.company.id, ctx.user.id, "create", "fixed_asset", a.code, { cost });
      return a.id;
    });
  } catch (e) { fail(e, "/assets/new"); }
  revalidatePath("/assets");
  redirect(`/assets/${id}`);
}

export async function assetMovement(fd: FormData) {
  const ctx = await requireWrite("assets");
  const id = str(fd, "id");
  const kind = (["impairment", "revaluation", "disposal", "addition"] as const).find((k) => k === str(fd, "kind"));
  try {
    const date = str(fd, "date");
    if (!kind || !isIsoDate(date)) throw new UserError("err_required");
    const db = await getDb();
    await db.transaction((tx) => recordMovement(tx, ctx.company.id, ctx.user.id, id, kind, {
      date, amount: parseAmount(fd.get("amount")), moneyAccountId: str(fd, "moneyAccountId") || undefined, notes: str(fd, "notes"),
    }));
  } catch (e) { fail(e, `/assets/${id}`); }
  revalidatePath("/assets");
  redirect(`/assets/${id}?saved=1`);
}

export async function depreciate(fd: FormData) {
  const ctx = await requireWrite("assets");
  const month = str(fd, "month");
  const { t, money } = await getI18n();
  let total = 0;
  try {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new UserError("err_required");
    const db = await getDb();
    total = (await db.transaction((tx) => runDepreciation(tx, ctx.company.id, ctx.user.id, month, `${t("depreciation")} ${month}`))).total;
  } catch (e) { fail(e, "/assets"); }
  revalidatePath("/assets");
  redirect(withParam("/assets", "dep", `${month}: ${money(round2(total))}`));
}

export async function saveCategory(fd: FormData) {
  const ctx = await requireWrite("assets");
  const id = str(fd, "id");
  const values = {
    name: str(fd, "name"), method: methodOf(fd), usefulLifeMonths: Math.max(1, Math.round(parseAmount(fd.get("usefulLifeMonths")))),
    rate: parseAmount(fd.get("rate")), assetAccount: str(fd, "assetAccount"), accumDepAccount: str(fd, "accumDepAccount"), depExpenseAccount: str(fd, "depExpenseAccount"),
  };
  try {
    if (!values.name || !values.assetAccount || !values.accumDepAccount || !values.depExpenseAccount) throw new UserError("err_required");
    const db = await getDb();
    if (id) await db.update(schema.assetCategories).set(values).where(and(eq(schema.assetCategories.id, id), eq(schema.assetCategories.companyId, ctx.company.id)));
    else await db.insert(schema.assetCategories).values({ ...values, companyId: ctx.company.id });
  } catch (e) { fail(e, "/assets/categories"); }
  revalidatePath("/assets");
  redirect("/assets/categories?saved=1");
}
