import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { createInMemoryDb, execRows, setDbForTests, type Db } from "@/db/client";

/**
 * Gives a test file its own in-memory Postgres (PGlite) with the full schema, installed as the app database,
 * so services that call `getDb()` just work.
 *
 *   const t = useTestDb();            // at the top of a describe() or the file
 *   it("...", async () => { const db = t.db; ... });
 *
 * Tables are truncated before each test unless `{ truncate: false }`.
 */
export function useTestDb(opts: { truncate?: boolean } = {}): { readonly db: Db } {
  let handle: Awaited<ReturnType<typeof createInMemoryDb>> | null = null;
  beforeAll(async () => {
    handle = await createInMemoryDb();
    setDbForTests(handle);
  });
  if (opts.truncate !== false) {
    beforeEach(async () => {
      await truncateAll(handle!.db);
    });
  }
  afterAll(async () => {
    setDbForTests(null);
    await handle?.close();
    handle = null;
  });
  return {
    get db() {
      if (!handle) throw new Error("useTestDb: database is only available inside tests/hooks");
      return handle.db;
    },
  };
}

export async function truncateAll(db: Db): Promise<void> {
  const res = await execRows<{ tablename: string }>(db, sql`select tablename from pg_tables where schemaname = 'public'`);
  const names = res.map((r) => `"${r.tablename}"`);
  if (names.length > 0) await db.execute(sql.raw(`truncate table ${names.join(", ")} cascade`));
}
