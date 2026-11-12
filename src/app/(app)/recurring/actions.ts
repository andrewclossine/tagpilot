"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx, requireWrite } from "@/lib/auth";
import { fail, withParam } from "@/lib/actions";
import { isIsoDate, isUuid, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { audit } from "@/lib/audit";
import { EVERY, runRecurring, templateFrom } from "@/lib/recurring";
import type { RecurringEvery, RecurringKind } from "@/db/schema";
import type { Area } from "@/lib/roles";

const BASE = "/recurring";
const areaOf = (k: RecurringKind): Area => (k === "invoice" ? "sales" : k === "bill" ? "purchases" : "journal");
const pageOf = (k: RecurringKind, id: string) => (k === "invoice" ? `/sales/invoices/${id}` : k === "bill" ? `/purchases/bills/${id}` : `/journal/${id}`);

/** Puts an invoice, bill or journal entry on a schedule. */
export async function createRecurring(fd: FormData) {
  const kind = (["invoice", "bill", "journal"].includes(str(fd, "kind")) ? str(fd, "kind") : "journal") as RecurringKind;
  const ctx = await requireWrite(areaOf(kind));
  const sourceId = str(fd, "sourceId"), back = pageOf(kind, sourceId);
  try {
    if (!isUuid(sourceId)) throw new UserError("err_not_found");
    const every = str(fd, "every") as RecurringEvery;
    if (!EVERY.includes(every)) throw new UserError("err_required");
    const nextDate = str(fd, "nextDate"), endDate = str(fd, "endDate");
    if (!isIsoDate(nextDate) || (endDate && (!isIsoDate(endDate) || endDate < nextDate))) throw new UserError("err_rec_dates");
    const db = await getDb();
    await db.transaction(async (tx) => {
      const { name, payload } = await templateFrom(tx, ctx.company.id, kind, sourceId);
      await tx.insert(schema.recurringTemplates).values({
        companyId: ctx.company.id, kind, name: str(fd, "name").slice(0, 120) || name, every, nextDate, endDate: endDate || null,
        autoPost: fd.get("autoPost") === "on", payload, sourceId, createdBy: ctx.user.id,
      });
      await audit(tx, ctx.company.id, ctx.user.id, "create", "recurring", name, { kind, every, nextDate });
    });
  } catch (e) { fail(e, back); }
  revalidatePath(BASE);
  redirect(withParam(BASE, "saved", "1"));
}

async function mine(id: string) {
  const ctx = await getCtx();
  const db = await getDb();
  const [t] = await db.select().from(schema.recurringTemplates).where(and(eq(schema.recurringTemplates.id, id), eq(schema.recurringTemplates.companyId, ctx.company.id)));
  if (!t || !ctx.can(areaOf(t.kind), "write")) throw new UserError("err_not_found");
  return { ctx, db, t };
}

export async function changeRecurring(fd: FormData) {
  try {
    const { ctx, db, t } = await mine(str(fd, "id"));
    const action = str(fd, "do");
    if (action === "delete") await db.delete(schema.recurringTemplates).where(eq(schema.recurringTemplates.id, t.id));
    else if (action === "pause" || action === "resume") {
      if (t.status === "ended") throw new UserError("err_rec_ended");
      await db.update(schema.recurringTemplates).set({ status: action === "pause" ? "paused" : "active" }).where(eq(schema.recurringTemplates.id, t.id));
    }
    await audit(db, ctx.company.id, ctx.user.id, action, "recurring", t.name);
  } catch (e) { fail(e, BASE); }
  revalidatePath(BASE);
  redirect(BASE);
}

/** Makes everything due today now, without waiting for the daily run. */
export async function runDueNow() {
  const ctx = await getCtx();
  if (!ctx.can("journal", "write") && !ctx.can("sales", "write") && !ctx.can("purchases", "write")) throw new Error("No access");
  let res = { made: 0, failed: 0 };
  try {
    const db = await getDb();
    res = await runRecurring(db, ctx.company, ctx.user.id);
  } catch (e) { fail(e, BASE); }
  revalidatePath(BASE);
  redirect(withParam(withParam(BASE, "made", String(res.made)), "failed", String(res.failed)));
}
