"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { hashPassword, requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUsername, isUuid, parseAmount, str, today } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { UserError } from "@/lib/ledger";
import { nextNumber } from "@/lib/numbering";
import {
  newContractNumber, notifySuppliers, recordEvaluation, STAGE_RULES, standstillOver, type Scores,
} from "@/lib/procurement";
import { optionalUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";
import type { TenderStage } from "@/db/schema";

const refresh = (id: string) => { revalidatePath("/procurement"); revalidatePath(`/procurement/${id}`); };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n) || 0));

async function getTender(companyId: string, id: string) {
  const db = await getDb();
  const [t] = await db.select().from(schema.tenders).where(and(eq(schema.tenders.id, id), eq(schema.tenders.companyId, companyId)));
  if (!t) throw new UserError("err_not_found");
  return t;
}

/** Saves the request for quotation or tender document while it is still a draft. */
export async function saveTender(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id"), kind = str(fd, "kind") === "tender" ? "tender" : "rfq";
  const back = id ? `/procurement/${id}?edit=1` : `/procurement/new?kind=${kind}`;
  let savedId = id;
  try {
    const title = str(fd, "title");
    if (!title) throw new UserError("err_required");
    const deadlineRaw = str(fd, "deadline"), deadline = deadlineRaw ? new Date(deadlineRaw) : null;
    if (deadline && Number.isNaN(deadline.getTime())) throw new UserError("err_deadline");
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    const projectId = isUuid(str(fd, "projectId")) ? str(fd, "projectId") : null;
    const db = await getDb();
    if (projectId) {
      const [p] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.companyId, ctx.company.id)));
      if (!p) throw new UserError("err_not_found");
    }
    const values = {
      title, description: str(fd, "description"), requirements: str(fd, "requirements"), projectId, estimate: parseAmount(fd.get("estimate")), deadline,
      openToAll: fd.get("openToAll") === "on", technicalWeight: clamp(Number(str(fd, "technicalWeight")), 0, 100), standstillDays: clamp(Number(str(fd, "standstillDays")), 0, 60),
    };
    savedId = await db.transaction(async (tx) => {
      if (id) {
        const [old] = await tx.select().from(schema.tenders).where(and(eq(schema.tenders.id, id), eq(schema.tenders.companyId, ctx.company.id))).for("update");
        if (!old) throw new UserError("err_not_found");
        if (old.status !== "draft") throw new UserError("err_tender_state");
        await tx.update(schema.tenders).set({ ...values, attachmentId: attachmentId ?? old.attachmentId }).where(eq(schema.tenders.id, id));
        return id;
      }
      const number = await nextNumber(tx, schema.tenders, { number: schema.tenders.number, companyId: schema.tenders.companyId }, ctx.company.id, kind === "rfq" ? "RFQ" : "TND");
      const [row] = await tx.insert(schema.tenders).values({ ...values, companyId: ctx.company.id, number, kind, attachmentId, createdBy: ctx.user.id }).returning({ id: schema.tenders.id });
      await audit(tx, ctx.company.id, ctx.user.id, "create", "tender", number, { kind });
      return row.id;
    });
  } catch (e) { fail(e, back); }
  refresh(savedId);
  redirect(`/procurement/${savedId}`);
}

/** Saves who is invited and puts the document out to suppliers. */
export async function publishTender(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id"), back = `/procurement/${id}`;
  const invited = fd.getAll("invite").map(String).filter(isUuid);
  const { t } = await getI18n();
  let number = "", title = "", recipients: string[] = [];
  try {
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [tender] = await tx.select().from(schema.tenders).where(and(eq(schema.tenders.id, id), eq(schema.tenders.companyId, ctx.company.id))).for("update");
      if (!tender) throw new UserError("err_not_found");
      if (tender.status !== "draft") throw new UserError("err_tender_state");
      if (!tender.deadline || tender.deadline.getTime() <= Date.now()) throw new UserError("err_deadline");
      const allowed = await tx.select({ id: schema.partners.id }).from(schema.partners).where(eq(schema.partners.companyId, ctx.company.id));
      const ids = invited.filter((p) => allowed.some((a) => a.id === p));
      if (!ids.length && !tender.openToAll) throw new UserError("err_no_invites");
      await tx.delete(schema.tenderInvites).where(eq(schema.tenderInvites.tenderId, id));
      if (ids.length) await tx.insert(schema.tenderInvites).values(ids.map((partnerId) => ({ tenderId: id, partnerId })));
      await tx.update(schema.tenders).set({ status: "published" }).where(eq(schema.tenders.id, id));
      await audit(tx, ctx.company.id, ctx.user.id, "publish", "tender", tender.number, { invited: ids.length, openToAll: tender.openToAll });
      number = tender.number; title = tender.title; recipients = ids;
      if (tender.openToAll) {
        const accounts = await tx.select({ partnerId: schema.memberships.partnerId }).from(schema.memberships)
          .where(and(eq(schema.memberships.companyId, ctx.company.id), eq(schema.memberships.role, "supplier")));
        recipients = [...new Set([...ids, ...accounts.flatMap((a) => (a.partnerId ? [a.partnerId] : []))])];
      }
    });
    await notifySuppliers(db, recipients, `${number} - ${ctx.company.name}`, `${t("mail_tender_published")}: ${number} - ${title}`);
  } catch (e) { fail(e, back); }
  refresh(id);
  redirect(back);
}

export async function cancelTender(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id");
  try {
    const db = await getDb();
    const tender = await getTender(ctx.company.id, id);
    if (tender.status === "signed") throw new UserError("err_tender_state");
    await db.update(schema.tenders).set({ status: "cancelled" }).where(eq(schema.tenders.id, id));
    await audit(db, ctx.company.id, ctx.user.id, "cancel", "tender", tender.number);
  } catch (e) { fail(e, `/procurement/${id}`); }
  refresh(id);
  redirect(`/procurement/${id}`);
}

/** Scores the opened bids and names the best evaluated bidder. */
export async function evaluateBids(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id"), back = `/procurement/${id}`;
  try {
    const db = await getDb();
    const date = str(fd, "date") || today();
    if (!isIsoDate(date)) throw new UserError("err_required");
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    await db.transaction(async (tx) => {
      const [tender] = await tx.select().from(schema.tenders).where(and(eq(schema.tenders.id, id), eq(schema.tenders.companyId, ctx.company.id))).for("update");
      if (!tender) throw new UserError("err_not_found");
      if (!STAGE_RULES.evaluation.from.includes(tender.status)) throw new UserError("err_tender_state");
      const bids = await tx.select().from(schema.bids).where(eq(schema.bids.tenderId, id));
      const scores: Scores = bids.map((b) => ({
        bidId: b.id, responsive: fd.get(`responsive_${b.id}`) === "on",
        technical: Math.min(100, Math.max(0, parseAmount(fd.get(`technical_${b.id}`)))), note: str(fd, `note_${b.id}`),
      }));
      await recordEvaluation(tx, ctx.company.id, ctx.user.id, tender, scores, isUuid(str(fd, "winnerId")) ? str(fd, "winnerId") : "");
      await upsertStage(tx, ctx.company.id, ctx.user.id, id, "evaluation", date, str(fd, "body"), attachmentId);
      await tx.update(schema.tenders).set({ status: STAGE_RULES.evaluation.to }).where(eq(schema.tenders.id, id));
    });
  } catch (e) { fail(e, back); }
  refresh(id);
  redirect(back);
}

async function upsertStage(tx: Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0], companyId: string, userId: string, tenderId: string, stage: TenderStage, date: string, body: string, attachmentId: string | null) {
  await tx.insert(schema.tenderStages).values({ companyId, tenderId, stage, date, body, attachmentId, createdBy: userId })
    .onConflictDoUpdate({ target: [schema.tenderStages.tenderId, schema.tenderStages.stage], set: { date, body, ...(attachmentId ? { attachmentId } : {}), createdBy: userId } });
}

const SIMPLE: TenderStage[] = ["opening", "provisional", "final", "negotiation", "minutes", "draft_contract", "signed"];

/** Records the next document of the procurement. Each step checks the one before it; suppliers are told by email too. */
export async function recordStage(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const id = str(fd, "id"), back = `/procurement/${id}`;
  const stage = SIMPLE.find((s) => s === str(fd, "stage"));
  const { t } = await getI18n();
  let tell: string[] = [], number = "", title = "", contractId = "";
  try {
    if (!stage) throw new UserError("err_generic");
    const date = str(fd, "date") || today(), body = str(fd, "body");
    if (!isIsoDate(date)) throw new UserError("err_required");
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    if ((stage === "signed" || stage === "draft_contract") && !attachmentId) throw new UserError("err_file_required");
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [tender] = await tx.select().from(schema.tenders).where(and(eq(schema.tenders.id, id), eq(schema.tenders.companyId, ctx.company.id))).for("update");
      if (!tender) throw new UserError("err_not_found");
      if (!STAGE_RULES[stage].from.includes(tender.status)) throw new UserError("err_tender_state");
      if (stage === "opening" && (!tender.deadline || tender.deadline.getTime() > Date.now())) throw new UserError("err_opening_early");
      const bids = await tx.select().from(schema.bids).where(eq(schema.bids.tenderId, id));
      const winner = bids.find((b) => b.isWinner);
      if (stage === "final") {
        const [prov] = await tx.select().from(schema.tenderStages).where(and(eq(schema.tenderStages.tenderId, id), eq(schema.tenderStages.stage, "provisional")));
        if (!prov || !standstillOver(prov.date, tender.standstillDays)) throw new UserError("err_standstill");
      }
      if (stage === "signed") {
        if (!winner) throw new UserError("err_not_found");
        const startDate = str(fd, "startDate"), endDate = str(fd, "endDate"), amount = parseAmount(fd.get("amount"));
        if (!isIsoDate(startDate) || !isIsoDate(endDate)) throw new UserError("err_required");
        if (endDate < startDate) throw new UserError("err_contract_dates");
        if (!(amount > 0)) throw new UserError("err_amount");
        const contractNo = await newContractNumber(tx, ctx.company.id);
        const [c] = await tx.insert(schema.contracts).values({
          companyId: ctx.company.id, number: contractNo, tenderId: id, partnerId: winner.partnerId, title: tender.title, scope: tender.description,
          projectId: tender.projectId, amount, signedDate: date, startDate, endDate, attachmentId, createdBy: ctx.user.id,
        }).returning({ id: schema.contracts.id });
        contractId = c.id;
        await audit(tx, ctx.company.id, ctx.user.id, "create", "contract", contractNo, { tender: tender.number, amount });
      }
      await upsertStage(tx, ctx.company.id, ctx.user.id, id, stage, date, body, attachmentId);
      await tx.update(schema.tenders).set({ status: STAGE_RULES[stage].to }).where(eq(schema.tenders.id, id));
      await audit(tx, ctx.company.id, ctx.user.id, stage, "tender", tender.number);
      number = tender.number; title = tender.title;
      if (stage === "provisional") tell = bids.map((b) => b.partnerId);
      else if (stage !== "opening" && winner) tell = [winner.partnerId];
    });
    if (tell.length) await notifySuppliers(db, tell, `${t(`stage_${stage}`)}: ${number} - ${ctx.company.name}`, `${t("mail_tender_update")}: ${t(`stage_${stage}`)}, ${number} - ${title}.\n\n${body}`);
  } catch (e) { fail(e, back); }
  refresh(id);
  revalidatePath("/contracts");
  redirect(contractId ? `/contracts/${contractId}` : back);
}

// ---------- supplier accounts ----------
const SUPPLIERS = "/procurement/suppliers";

/** Gives a supplier a sign-in. The supplier can be one already on the books, or a new one added here. */
export async function createSupplierAccount(fd: FormData) {
  const ctx = await requireWrite("procurement");
  try {
    const username = str(fd, "username").toLowerCase(), password = String(fd.get("password") ?? ""), contact = str(fd, "name");
    const email = str(fd, "email").toLowerCase() || null;
    if (!contact) throw new UserError("err_required");
    if (!isUsername(username)) throw new UserError("err_username");
    if (password.length < 8) throw new UserError("err_password_short");
    const db = await getDb();
    const [taken] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, username));
    if (taken) throw new UserError("err_username_taken");
    if (email) {
      const [used] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
      if (used) throw new UserError("err_email_taken");
    }
    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      let partnerId = str(fd, "partnerId");
      if (isUuid(partnerId)) {
        const [p] = await tx.select().from(schema.partners).where(and(eq(schema.partners.id, partnerId), eq(schema.partners.companyId, ctx.company.id)));
        if (!p) throw new UserError("err_not_found");
        if (email && !p.email) await tx.update(schema.partners).set({ email }).where(eq(schema.partners.id, partnerId));
      } else {
        const name = str(fd, "companyName");
        if (!name) throw new UserError("err_required");
        const [p] = await tx.insert(schema.partners).values({ companyId: ctx.company.id, name, kind: "supplier", tin: str(fd, "tin"), phone: str(fd, "phone"), email: email ?? "" }).returning({ id: schema.partners.id });
        partnerId = p.id;
      }
      const [u] = await tx.insert(schema.users).values({ username, name: contact, email, passwordHash, createdBy: ctx.user.id }).returning({ id: schema.users.id });
      await tx.insert(schema.memberships).values({ companyId: ctx.company.id, userId: u.id, role: "supplier", partnerId });
      await audit(tx, ctx.company.id, ctx.user.id, "create", "supplier_account", username, { partnerId });
    });
  } catch (e) { fail(e, SUPPLIERS); }
  revalidatePath(SUPPLIERS);
  redirect(`${SUPPLIERS}?saved=1`);
}

async function supplierMember(companyId: string, userId: string) {
  const db = await getDb();
  const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.companyId, companyId), eq(schema.memberships.userId, userId), eq(schema.memberships.role, "supplier")));
  if (!m) throw new UserError("err_not_found");
}

export async function resetSupplierPassword(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const userId = str(fd, "userId"), password = String(fd.get("password") ?? "");
  try {
    if (password.length < 8) throw new UserError("err_password_short");
    await supplierMember(ctx.company.id, userId);
    const db = await getDb();
    await db.update(schema.users).set({ passwordHash: await hashPassword(password) }).where(eq(schema.users.id, userId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await audit(db, ctx.company.id, ctx.user.id, "reset_password", "supplier_account", userId);
  } catch (e) { fail(e, SUPPLIERS); }
  revalidatePath(SUPPLIERS);
  redirect(`${SUPPLIERS}?saved=1`);
}

/** Closes a supplier's sign-in. Their bids and contracts stay on record. */
export async function removeSupplierAccount(fd: FormData) {
  const ctx = await requireWrite("procurement");
  const userId = str(fd, "userId");
  try {
    await supplierMember(ctx.company.id, userId);
    const db = await getDb();
    await db.delete(schema.memberships).where(and(eq(schema.memberships.companyId, ctx.company.id), eq(schema.memberships.userId, userId)));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await audit(db, ctx.company.id, ctx.user.id, "remove", "supplier_account", userId);
  } catch (e) { fail(e, SUPPLIERS); }
  revalidatePath(SUPPLIERS);
  redirect(`${SUPPLIERS}?saved=1`);
}
