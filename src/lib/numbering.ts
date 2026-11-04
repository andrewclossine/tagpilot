import "server-only";
import { and, eq, like, sql, type Column } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "@/db";

/** The next document number ("PV-0007"). The lock makes two people saving at once wait for each other. */
export async function nextNumber(tx: Tx, table: PgTable, cols: { number: Column; companyId: Column }, companyId: string, prefix: string): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${companyId}:${prefix}`}))`);
  const [row] = await tx.select({ n: sql<number>`coalesce(max(cast(substring(${cols.number} from '[0-9]+$') as integer)), 0)` }).from(table)
    .where(and(eq(cols.companyId, companyId), like(cols.number, `${prefix}-%`)));
  return `${prefix}-${String(Number(row?.n ?? 0) + 1).padStart(4, "0")}`;
}
