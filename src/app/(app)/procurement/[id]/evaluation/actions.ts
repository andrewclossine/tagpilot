"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx, requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isUuid, parseAmount, str } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { UserError } from "@/lib/ledger";
import { addCriterion, declare, decideAward, removeCriterion, saveScores, setCommittee } from "@/lib/committee";
import { notifyUser } from "@/lib/requisitions";

const page = (id: string) => `/procurement/${id}/evaluation`;
const refresh = (id: string) => { revalidatePath(page(id)); revalidatePath(`/procurement/${id}`); revalidatePath("/procurement/requisitions"); };

async function tenderOf(companyId: string, id: string) {
  if (!isUuid(id)) throw new UserError("err_not_found");
  const db = await getDb();
  const [t] = await db.select().from(schema.tenders).where(and(eq(schema.tenders.id, id), eq(schema.tenders.companyId, companyId)));
  if (!t) throw new UserError("err_not_found");
  return t;
}

/** Committee members, chair and award approver, set by the procurement team. New members are told by email. */
export async function saveCommitteeAction(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id");
  const { t } = await getI18n();
  let fresh: string[] = [], title = "";
  try {
    const tender = await tenderOf(ctx.company.id, id);
    const db = await getDb();
    const before = (await db.select().from(schema.tenderCommittee).where(eq(schema.tenderCommittee.tenderId, id))).map((m) => m.userId);
    const members = fd.getAll("member").map(String).filter(isUuid);
    const approverId = isUuid(str(fd, "approverId")) ? str(fd, "approverId") : null;
    await db.transaction((tx) => setCommittee(tx, ctx, tender, { members, chairId: str(fd, "chairId"), approverId }));
    fresh = members.filter((m) => !before.includes(m));
    title = `${tender.number} - ${tender.title}`;
  } catch (e) { fail(e, page(id)); }
  for (const u of fresh) await notifyUser(u, t("cm_mail_member"), `${t("cm_mail_member")}: ${title}`);
  refresh(id);
  redirect(`${page(id)}?saved=1`);
}

export async function addCriterionAction(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id");
  try {
    const tender = await tenderOf(ctx.company.id, id);
    const db = await getDb();
    await db.transaction((tx) => addCriterion(tx, ctx, tender, str(fd, "name"), parseAmount(fd.get("maxPoints"))));
  } catch (e) { fail(e, page(id)); }
  refresh(id);
  redirect(`${page(id)}#criteria`);
}

export async function removeCriterionAction(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id");
  try {
    const tender = await tenderOf(ctx.company.id, id);
    const db = await getDb();
    await db.transaction((tx) => removeCriterion(tx, tender, str(fd, "criterionId")));
  } catch (e) { fail(e, page(id)); }
  refresh(id);
  redirect(`${page(id)}#criteria`);
}

/** Members and approvers can be anyone in the organisation, so these check membership, not a procurement role. */
async function memberCtx() {
  const ctx = await getCtx();
  if (ctx.role === "supplier" || ctx.locked || !ctx.has("procurement")) throw new Error("You cannot do this.");
  return ctx;
}

export async function declareAction(fd: FormData) {
  const ctx = await memberCtx();
  const id = str(fd, "id");
  try {
    const tender = await tenderOf(ctx.company.id, id);
    const db = await getDb();
    await db.transaction((tx) => declare(tx, ctx, tender, str(fd, "declaration") === "none"));
  } catch (e) { fail(e, page(id)); }
  refresh(id);
  redirect(page(id));
}

export async function saveScoresAction(fd: FormData) {
  const ctx = await memberCtx();
  const id = str(fd, "id"), submit = str(fd, "intent") === "submit";
  try {
    const tender = await tenderOf(ctx.company.id, id);
    const db = await getDb();
    await db.transaction((tx) => saveScores(tx, ctx, tender, fd, submit));
  } catch (e) { fail(e, page(id)); }
  refresh(id);
  redirect(`${page(id)}?saved=1#scores`);
}

export async function decideAwardAction(fd: FormData) {
  const ctx = await memberCtx();
  const id = str(fd, "id"), approve = str(fd, "decision") === "approve", note = str(fd, "note");
  const { t } = await getI18n();
  let creator: string | null = null, title = "";
  try {
    const tender = await tenderOf(ctx.company.id, id);
    const db = await getDb();
    await db.transaction((tx) => decideAward(tx, ctx, tender, approve, note));
    creator = tender.createdBy; title = `${tender.number} - ${tender.title}`;
  } catch (e) { fail(e, page(id)); }
  await notifyUser(creator, t(approve ? "cm_mail_award_ok" : "cm_mail_award_back"), `${t(approve ? "cm_mail_award_ok" : "cm_mail_award_back")}: ${title}${note ? `\n\n${note}` : ""}`);
  refresh(id);
  redirect(page(id));
}
