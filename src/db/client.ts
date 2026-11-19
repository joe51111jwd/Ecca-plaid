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
 *    created automatically on first use; if the code's schema later changes, startup says to run
 *    `npm run db:reset`.
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
const SCHEMA_STAMP_TABLE = "_ecca_schema";

/**
 * Keeps an embedded dev database in step with the code, without ever blocking startup.
 *
 * A fresh database gets the full schema plus a stamp (a hash of that schema). On later starts the stamp is
 * compared: same hash → nothing to do. A different hash means the code's schema changed since the database
 * was created; we refuse to guess at a migration (the schema-diff tool can stop to ask interactive
 * questions, which hangs a server) and tell the developer to recreate the local database instead.
 * Production never comes here: it uses DATABASE_URL and `npm run db:migrate`.
 */
async function syncEmbeddedSchema(db: Db, dataDir: string): Promise<void> {
  const statements = await generateSchemaSql();
  const { createHash } = await import("node:crypto");
  // Hash the statements in sorted order: the order they are generated in depends on how the runtime
  // enumerates the schema module (a script and the web server differ), but the set does not.
  const hash = `v2:${createHash("sha256").update([...statements].sort().join("\n")).digest("hex")}`;
  const tables = await execRows<{ n: number }>(
    db,
    sql`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name <> ${SCHEMA_STAMP_TABLE}`,
  );
  await db.execute(sql.raw(`create table if not exists "${SCHEMA_STAMP_TABLE}" (id integer primary key, hash text not null)`));
  if (Number(tables[0]?.n ?? 0) === 0) {
    for (const stmt of statements) await db.execute(sql.raw(stmt));
    await db.execute(sql.raw(`insert into "${SCHEMA_STAMP_TABLE}" (id, hash) values (1, '${hash}') on conflict (id) do update set hash = excluded.hash`));
    return;
  }
  const stamp = await execRows<{ hash: string }>(db, sql.raw(`select hash from "${SCHEMA_STAMP_TABLE}" where id = 1`));
  if (stamp.length === 0 || !stamp[0].hash.startsWith("v2:")) {
    // Created before stamps existed (or with the first, order-sensitive stamp): accept it as current
    // rather than block, and stamp it now.
    console.warn(`[db] ${dataDir} has no usable schema stamp; assuming it matches the current schema.`);
    await db.execute(sql.raw(`insert into "${SCHEMA_STAMP_TABLE}" (id, hash) values (1, '${hash}') on conflict (id) do update set hash = excluded.hash`));
    return;
  }
  if (stamp[0].hash !== hash) {
    throw new Error(
      `The local database in ${dataDir} was created with an older version of the schema. ` +
        `Recreate it with "npm run db:reset" (this deletes local demo data), then "npm run db:seed".`,
    );
  }
}

async function open(): Promise<DbHandle> {
  const url = env().DATABASE_URL;
  if (url) return openPg(url);
  if (isProd()) throw new Error("DATABASE_URL is required in production");
  const dataDir = join(env().ECCA_DATA_DIR, "pglite");
  const handle = await openPglite(dataDir);
  try {
    await syncEmbeddedSchema(handle.db, dataDir);
  } catch (e) {
    await handle.close();
    throw e;
  }
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
