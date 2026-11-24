import "server-only";
import { and, count, eq, gte, isNotNull, ne } from "drizzle-orm";
import { schema, type Db, type Tx } from "@/db";
import type { Ctx } from "./auth";
import { UserError } from "./ledger";
import { LIMITS, limitOf, userLimit } from "./plans";

/** The first moment of this calendar month, for monthly allowances. */
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };

/** One more person may join the organisation. Supplier accounts do not count. */
export async function assertUserSeat(db: Db | Tx, ctx: Ctx) {
  const [{ n }] = await db.select({ n: count() }).from(schema.memberships).where(and(eq(schema.memberships.companyId, ctx.company.id), ne(schema.memberships.role, "supplier")));
  if (n >= userLimit(ctx.plan)) throw new UserError("err_plan_users");
}

/** One more project, in the Projects app's package. The general administration line does not count. */
export async function assertProjectSlot(db: Db | Tx, ctx: Ctx) {
  if (!ctx.has("projects")) return;
  const max = limitOf(ctx.plan, "projects", LIMITS.projects);
  if (!Number.isFinite(max)) return;
  const [{ n }] = await db.select({ n: count() }).from(schema.projects).where(and(eq(schema.projects.companyId, ctx.company.id), eq(schema.projects.isActive, true), ne(schema.projects.code, "GEN")));
  if (n >= max) throw new UserError("err_plan_projects");
}

/** One more tender or request for quotation this month. */
export async function assertTenderSlot(db: Db | Tx, ctx: Ctx) {
  const max = limitOf(ctx.plan, "procurement", LIMITS.tendersPerMonth);
  if (!Number.isFinite(max)) return;
  const [{ n }] = await db.select({ n: count() }).from(schema.tenders).where(and(eq(schema.tenders.companyId, ctx.company.id), gte(schema.tenders.createdAt, monthStart())));
  if (n >= max) throw new UserError("err_plan_tenders");
}

/** One more document sent for signature this month. */
export async function assertEsignSend(db: Db | Tx, ctx: Ctx) {
  const max = limitOf(ctx.plan, "esign", LIMITS.esignPerMonth);
  if (!Number.isFinite(max)) return;
  const [{ n }] = await db.select({ n: count() }).from(schema.esignDocuments).where(and(eq(schema.esignDocuments.companyId, ctx.company.id), isNotNull(schema.esignDocuments.sentAt), gte(schema.esignDocuments.sentAt, monthStart())));
  if (n >= max) throw new UserError("err_plan_esign");
}

/** One more dynamic QR code. */
export async function assertQrDynamic(db: Db | Tx, ctx: Ctx) {
  const max = limitOf(ctx.plan, "qr", LIMITS.qrDynamic);
  if (!Number.isFinite(max)) return;
  const [{ n }] = await db.select({ n: count() }).from(schema.qrCodes).where(and(eq(schema.qrCodes.companyId, ctx.company.id), eq(schema.qrCodes.dynamic, true)));
  if (n >= max) throw new UserError("err_plan_qr");
}

/** One more employee on the payroll. */
export async function assertEmployee(db: Db | Tx, ctx: Ctx) {
  const max = limitOf(ctx.plan, "accounting", LIMITS.payrollEmployees);
  if (!Number.isFinite(max)) return;
  const [{ n }] = await db.select({ n: count() }).from(schema.employees).where(and(eq(schema.employees.companyId, ctx.company.id), eq(schema.employees.isActive, true)));
  if (n >= max) throw new UserError("err_plan_employees");
}
