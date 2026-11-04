"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, parseAmount, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { decideAmendment, newContractNumber, requestAmendment } from "@/lib/procurement";
import { optionalUpload } from "@/lib/upload";
import { audit } from "@/lib/audit";

const refresh = (id: string) => { revalidatePath("/contracts"); revalidatePath(`/contracts/${id}`); };

/** Records a contract that did not come through a tender here. */
export async function createContract(fd: FormData) {
  const ctx = await requireWrite("contracts");
  let id = "";
  try {
    const title = str(fd, "title"), partnerId = str(fd, "partnerId"), signedDate = str(fd, "signedDate"), startDate = str(fd, "startDate"), endDate = str(fd, "endDate");
    const amount = parseAmount(fd.get("amount"));
    if (!title || !isUuid(partnerId) || !isIsoDate(signedDate) || !isIsoDate(startDate) || !isIsoDate(endDate)) throw new UserError("err_required");
    if (endDate < startDate) throw new UserError("err_contract_dates");
    if (!(amount > 0)) throw new UserError("err_amount");
    const db = await getDb();
    const [p] = await db.select({ id: schema.partners.id }).from(schema.partners).where(and(eq(schema.partners.id, partnerId), eq(schema.partners.companyId, ctx.company.id)));
    if (!p) throw new UserError("err_not_found");
    const projectId = isUuid(str(fd, "projectId")) ? str(fd, "projectId") : null;
    if (projectId) {
      const [pr] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.companyId, ctx.company.id)));
      if (!pr) throw new UserError("err_not_found");
    }
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    id = await db.transaction(async (tx) => {
      const number = await newContractNumber(tx, ctx.company.id);
      const [c] = await tx.insert(schema.contracts).values({
        companyId: ctx.company.id, number, partnerId, title, scope: str(fd, "scope"), projectId, amount, signedDate, startDate, endDate, attachmentId, createdBy: ctx.user.id,
      }).returning({ id: schema.contracts.id });
      await audit(tx, ctx.company.id, ctx.user.id, "create", "contract", number, { amount });
      return c.id;
    });
  } catch (e) { fail(e, "/contracts/new"); }
  refresh(id);
  redirect(`/contracts/${id}`);
}

async function ownContract(companyId: string, id: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.contracts).where(and(eq(schema.contracts.id, id), eq(schema.contracts.companyId, companyId)));
  if (!c) throw new UserError("err_not_found");
  return c;
}

export async function setContractStatus(fd: FormData) {
  const ctx = await requireWrite("contracts");
  const id = str(fd, "id"), status = str(fd, "status");
  try {
    const c = await ownContract(ctx.company.id, id);
    if (status !== "active" && status !== "completed" && status !== "terminated") throw new UserError("err_generic");
    const db = await getDb();
    await db.update(schema.contracts).set({ status }).where(eq(schema.contracts.id, id));
    await audit(db, ctx.company.id, ctx.user.id, status, "contract", c.number);
  } catch (e) { fail(e, `/contracts/${id}`); }
  refresh(id);
  redirect(`/contracts/${id}`);
}

export async function addGuarantee(fd: FormData) {
  const ctx = await requireWrite("contracts");
  const contractId = str(fd, "contractId"), back = `/contracts/${contractId}`;
  try {
    const c = await ownContract(ctx.company.id, contractId);
    const issueDate = str(fd, "issueDate"), expiryDate = str(fd, "expiryDate"), amount = parseAmount(fd.get("amount"));
    if (!isIsoDate(issueDate) || !isIsoDate(expiryDate)) throw new UserError("err_required");
    if (expiryDate < issueDate) throw new UserError("err_contract_dates");
    if (!(amount > 0)) throw new UserError("err_amount");
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    const db = await getDb();
    await db.insert(schema.performanceGuarantees).values({
      companyId: ctx.company.id, contractId, kind: str(fd, "kind"), issuer: str(fd, "issuer"), reference: str(fd, "reference"), amount, issueDate, expiryDate, attachmentId,
    });
    await audit(db, ctx.company.id, ctx.user.id, "create", "performance_guarantee", c.number, { amount, expiryDate });
  } catch (e) { fail(e, back); }
  refresh(contractId);
  redirect(back);
}

export async function setGuaranteeStatus(fd: FormData) {
  const ctx = await requireWrite("contracts");
  const id = str(fd, "id"), contractId = str(fd, "contractId"), status = str(fd, "status"), back = `/contracts/${contractId}`;
  try {
    if (status !== "released" && status !== "called") throw new UserError("err_generic");
    const db = await getDb();
    const [g] = await db.select().from(schema.performanceGuarantees).where(and(eq(schema.performanceGuarantees.id, id), eq(schema.performanceGuarantees.companyId, ctx.company.id)));
    if (!g) throw new UserError("err_not_found");
    await db.update(schema.performanceGuarantees).set({ status }).where(eq(schema.performanceGuarantees.id, id));
    await audit(db, ctx.company.id, ctx.user.id, status, "performance_guarantee", g.contractId);
  } catch (e) { fail(e, back); }
  refresh(contractId);
  redirect(back);
}

export async function askAmendment(fd: FormData) {
  const ctx = await requireWrite("contracts");
  const contractId = str(fd, "contractId"), back = `/contracts/${contractId}`;
  try {
    const newEndDate = str(fd, "newEndDate");
    if (newEndDate && !isIsoDate(newEndDate)) throw new UserError("err_required");
    const attachmentId = await optionalUpload(ctx.company.id, ctx.user.id, fd);
    const db = await getDb();
    await db.transaction((tx) => requestAmendment(tx, ctx.company.id, ctx.user.id, contractId, false, {
      reason: str(fd, "reason"), amountChange: parseAmount(fd.get("amountChange")), newEndDate: newEndDate || null, attachmentId,
    }));
  } catch (e) { fail(e, back); }
  refresh(contractId);
  redirect(back);
}

export async function decideOnAmendment(fd: FormData) {
  const ctx = await requireWrite("contracts");
  const contractId = str(fd, "contractId"), back = `/contracts/${contractId}`;
  try {
    const approve = str(fd, "decision") === "approve", note = str(fd, "note");
    if (!approve && !note) throw new UserError("err_reason_required");
    const db = await getDb();
    await db.transaction((tx) => decideAmendment(tx, ctx.company.id, ctx.user.id, str(fd, "id"), approve, note));
  } catch (e) { fail(e, back); }
  refresh(contractId);
  redirect(back);
}
