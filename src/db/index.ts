import "server-only";
import path from "node:path";
import fs from "node:fs";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const migrationsFolder = path.join(/* turbopackIgnore: true */ process.cwd(), "drizzle");

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const db = drizzlePg(new Pool({ connectionString: url }), { schema });
    await migratePg(db, { migrationsFolder });
    return db;
  }
  // No server configured: use PGlite, a full PostgreSQL that runs inside Node and keeps its files in ./data.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const { migrate: migratePglite } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data", "pglite");
  fs.mkdirSync(dir, { recursive: true });
  const db = drizzlePglite(new PGlite(dir), { schema });
  await migratePglite(db, { migrationsFolder });
  // Both drivers expose the same query builder; the app only uses that shared surface.
  return db as unknown as Db;
}

const g = globalThis as unknown as { __kontiDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!g.__kontiDb) g.__kontiDb = connect().catch((e) => { g.__kontiDb = undefined; throw e; });
  return g.__kontiDb;
}

export { schema };
