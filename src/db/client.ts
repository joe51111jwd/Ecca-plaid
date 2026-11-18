import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { env, isProd } from "@/lib/env";
import * as schema from "./schema";

/**
 * Database access.
 *
 *   const db = await getDb();
 *   await db.select().from(schema.users)...
 *   await db.transaction(async (tx) => { ... });   // pass `tx` down as DbOrTx
 *
 * Two drivers behind one Drizzle type:
 *  - DATABASE_URL set   → node-postgres pool (production, CI, `npm run worker`)
 *  - DATABASE_URL unset → embedded PGlite under ECCA_DATA_DIR (zero-setup local dev) — the schema is
 *    synced automatically on first use, so there is nothing to migrate locally.
 * Tests install their own in-memory database with `setDbForTests` (see tests/helpers/db.ts).
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export { schema };

/** Runs raw SQL and returns typed rows (both drivers return `{ rows }`). */
export async function execRows<T = Record<string, unknown>>(db: DbOrTx, query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

interface DbHandle {
  db: Db;
  close: () => Promise<void>;
  driver: "pglite" | "pg";
}

const g = globalThis as unknown as { __eccaDb?: Promise<DbHandle>; __eccaTestDb?: DbHandle | null };

/** DDL that creates the whole current schema from an empty database (used for the embedded dev DB and tests). */
export async function generateSchemaSql(): Promise<string[]> {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  return generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
}

async function openPglite(dataDir: string | null): Promise<DbHandle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, driver: "pglite", close: () => client.close() };
}

async function openPg(url: string): Promise<DbHandle> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, driver: "pg", close: () => pool.end() };
}

/** Brings an embedded dev database in line with the current schema (like `drizzle-kit push`). Never used in production. */
async function syncEmbeddedSchema(db: Db): Promise<void> {
  const existing = await execRows<{ n: number }>(db, sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
  const n = Number(existing[0]?.n ?? 0);
  if (n === 0) {
    for (const stmt of await generateSchemaSql()) await db.execute(sql.raw(stmt));
    return;
  }
  const { pushSchema } = await import("drizzle-kit/api");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const push = await pushSchema(schema as unknown as Record<string, unknown>, db as any);
  if (push.statementsToExecute.length > 0) await push.apply();
}

async function open(): Promise<DbHandle> {
  const url = env().DATABASE_URL;
  if (url) return openPg(url);
  if (isProd()) throw new Error("DATABASE_URL is required in production");
  const handle = await openPglite(join(env().ECCA_DATA_DIR, "pglite"));
  await syncEmbeddedSchema(handle.db);
  return handle;
}

export async function getDb(): Promise<Db> {
  if (g.__eccaTestDb) return g.__eccaTestDb.db;
  if (!g.__eccaDb) {
    g.__eccaDb = open().catch((e) => {
      g.__eccaDb = undefined;
      throw e;
    });
  }
  return (await g.__eccaDb).db;
}

export async function closeDb(): Promise<void> {
  if (g.__eccaDb) {
    const h = await g.__eccaDb;
    g.__eccaDb = undefined;
    await h.close();
  }
}

/** Test-only: a fresh in-memory database with the full schema, installed as the process-wide database. */
export async function createInMemoryDb(): Promise<DbHandle> {
  const handle = await openPglite(null);
  for (const stmt of await cachedSchemaSql()) await handle.db.execute(sql.raw(stmt));
  return handle;
}

let schemaSqlCache: Promise<string[]> | null = null;
function cachedSchemaSql(): Promise<string[]> {
  schemaSqlCache ??= generateSchemaSql();
  return schemaSqlCache;
}

export function setDbForTests(handle: DbHandle | null): void {
  if (isProd()) throw new Error("setDbForTests is not allowed in production");
  g.__eccaTestDb = handle;
}
