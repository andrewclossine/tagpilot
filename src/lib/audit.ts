import "server-only";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";

export async function audit(db: Db | Tx, companyId: string, userId: string | null, action: string, entity: string, entityId: string, details?: Record<string, unknown>) {
  await db.insert(schema.auditLog).values({ companyId, userId, action, entity, entityId, details: details ?? null });
}
