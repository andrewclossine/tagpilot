"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, str } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { UserError } from "@/lib/ledger";
import { readItemLines } from "@/lib/item-lines";
import { audit } from "@/lib/audit";
import {
  cancelRequisition, convertRequisition, decideRequisition, notifyUser, saveRequisition, submitRequisition,
} from "@/lib/requisitions";

const BASE = "/procurement/requisitions";
const refresh = (id?: string) => { revalidatePath(BASE); if (id) revalidatePath(`${BASE}/${id}`); };

async function numberOf(id: string) {
  const db = await getDb();
  const [r] = await db.select({ number: schema.requisitions.number, title: schema.requisitions.title }).from(schema.requisitions).where(eq(schema.requisitions.id, id));
  return r ? `${r.number} - ${r.title}` : "";
}

/** Saves the request; "submit" also sends it for approval. */
export async function saveRequisitionAction(fd: FormData) {
  const ctx = await requireWrite("requisitions");
  const id = isUuid(str(fd, "id")) ? str(fd, "id") : null;
  const back = id ? `${BASE}/${id}?edit=1` : `${BASE}/new`;
  const submit = str(fd, "intent") === "submit";
  const { t } = await getI18n();
  let saved = id ?? "", notify: string | null = null;
  try {
    const neededBy = str(fd, "neededBy");
    if (neededBy && !isIsoDate(neededBy)) throw new UserError("err_required");
    const db = await getDb();
    // The budget line names its project.
    const lineId = isUuid(str(fd, "budgetItemId")) ? str(fd, "budgetItemId") : null;
    const [line] = lineId ? await db.select({ projectId: schema.logframeItems.projectId }).from(schema.logframeItems)
      .where(and(eq(schema.logframeItems.id, lineId), eq(schema.logframeItems.companyId, ctx.company.id))) : [];
    if (lineId && !line) throw new UserError("err_not_found");
    await db.transaction(async (tx) => {
      saved = await saveRequisition(tx, ctx, id, {
        title: str(fd, "title"), justification: str(fd, "justification"), department: str(fd, "department"),
        projectId: line?.projectId ?? null, budgetItemId: lineId,
        neededBy: neededBy || null, lines: readItemLines(fd),
      });
      if (submit) notify = (await submitRequisition(tx, ctx, saved)).notify;
    });
  } catch (e) { fail(e, saved && !id ? `${BASE}/${saved}?edit=1` : back); }
  if (notify) await notifyUser(notify, t("rq_mail_approve"), `${t("rq_mail_approve")}: ${await numberOf(saved)}`);
  refresh(saved);
  redirect(`${BASE}/${saved}`);
}

export async function submitRequisitionAction(fd: FormData) {
  const ctx = await requireWrite("requisitions");
  const id = str(fd, "id");
  const { t } = await getI18n();
  let notify: string | null = null;
  try {
    const db = await getDb();
    await db.transaction(async (tx) => { notify = (await submitRequisition(tx, ctx, id)).notify; });
  } catch (e) { fail(e, `${BASE}/${id}`); }
  if (notify) await notifyUser(notify, t("rq_mail_approve"), `${t("rq_mail_approve")}: ${await numberOf(id)}`);
  refresh(id);
  redirect(`${BASE}/${id}`);
}

/** The approver's decision. Anyone in the organisation can be an approver, so this needs only the requisitions area. */
export async function decideRequisitionAction(fd: FormData) {
  const ctx = await requireWrite("requisitions");
  const id = str(fd, "id"), approve = str(fd, "decision") === "approve", note = str(fd, "note");
  const { t } = await getI18n();
  let res = { notify: null as string | null, done: false };
  try {
    const db = await getDb();
    await db.transaction(async (tx) => { res = await decideRequisition(tx, ctx, id, approve, note); });
  } catch (e) { fail(e, `${BASE}/${id}`); }
  const what = await numberOf(id);
  if (res.notify) {
    if (!res.done) await notifyUser(res.notify, t("rq_mail_approve"), `${t("rq_mail_approve")}: ${what}`);
    else await notifyUser(res.notify, t(approve ? "rq_mail_approved" : "rq_mail_rejected"), `${t(approve ? "rq_mail_approved" : "rq_mail_rejected")}: ${what}${note ? `\n\n${note}` : ""}`);
  }
  refresh(id);
  redirect(`${BASE}/${id}`);
}

export async function cancelRequisitionAction(fd: FormData) {
  const ctx = await requireWrite("requisitions");
  const id = str(fd, "id");
  try {
    const db = await getDb();
    await db.transaction((tx) => cancelRequisition(tx, ctx, id));
  } catch (e) { fail(e, `${BASE}/${id}`); }
  refresh(id);
  redirect(`${BASE}/${id}`);
}

/** The procurement team turns an approved request into a draft request for quotation or tender. */
export async function convertRequisitionAction(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id"), kind = str(fd, "kind") === "tender" ? "tender" : "rfq";
  let tenderId = "";
  try {
    const db = await getDb();
    await db.transaction(async (tx) => { tenderId = await convertRequisition(tx, ctx, id, kind); });
  } catch (e) { fail(e, `${BASE}/${id}`); }
  refresh(id);
  revalidatePath("/procurement");
  redirect(`/procurement/${tenderId}`);
}

// ---------- approval levels ----------
const LEVELS = `${BASE}/levels`;

/** Adds an approval level. Only administrators decide who approves what. */
export async function addLevel(fd: FormData) {
  const ctx = await requireWrite("requisitions");
  try {
    if (!ctx.isAdmin) throw new UserError("err_admin_only");
    const name = str(fd, "name").slice(0, 80), approverId = str(fd, "approverId"), minAmount = parseAmount(fd.get("minAmount"));
    if (!name || !isUuid(approverId)) throw new UserError("err_required");
    if (!(minAmount >= 0)) throw new UserError("err_amount");
    const db = await getDb();
    const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.companyId, ctx.company.id), eq(schema.memberships.userId, approverId)));
    if (!m || m.role === "supplier") throw new UserError("err_not_found");
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.requisitionLevels).where(eq(schema.requisitionLevels.companyId, ctx.company.id));
    await db.insert(schema.requisitionLevels).values({ companyId: ctx.company.id, sortOrder: Number(n) + 1, name, minAmount, approverId });
    await audit(db, ctx.company.id, ctx.user.id, "add_level", "requisition", name, { minAmount, approverId });
  } catch (e) { fail(e, LEVELS); }
  revalidatePath(LEVELS);
  redirect(`${LEVELS}?saved=1`);
}

export async function removeLevel(fd: FormData) {
  const ctx = await requireWrite("requisitions");
  try {
    if (!ctx.isAdmin) throw new UserError("err_admin_only");
    const id = str(fd, "levelId");
    if (!isUuid(id)) throw new UserError("err_not_found");
    const db = await getDb();
    const [l] = await db.select().from(schema.requisitionLevels).where(and(eq(schema.requisitionLevels.id, id), eq(schema.requisitionLevels.companyId, ctx.company.id)));
    if (!l) throw new UserError("err_not_found");
    await db.delete(schema.requisitionLevels).where(eq(schema.requisitionLevels.id, id));
    await audit(db, ctx.company.id, ctx.user.id, "remove_level", "requisition", l.name);
  } catch (e) { fail(e, LEVELS); }
  revalidatePath(LEVELS);
  redirect(`${LEVELS}?saved=1`);
}
