/**
 * Applies the SQL migrations in ./drizzle to the Postgres database at DATABASE_URL.
 *
 *   npm run db:migrate                 apply everything that is not applied yet
 *   npm run db:migrate -- --dir=path   read migrations from another folder
 *
 * Run it once per deploy, before the new code starts serving. It is safe to run from several machines
 * at the same time: a session advisory lock makes them take turns, and each migration is recorded in
 * drizzle.__drizzle_migrations so it runs once. Migration files are generated with `npm run db:generate`.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { env } from "@/lib/env";

/** Arbitrary constant (the bytes of "ECCAMI") identifying the migration advisory lock. */
const MIGRATION_LOCK_ID = 0x45434341_4d49;

/** Same files Next.js reads for the app; variables already set in the environment win. */
function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

function fail(message: string): never {
  console.error(`db:migrate: ${message}`);
  process.exit(1);
}

async function appliedCount(client: Client): Promise<number> {
  const exists = await client.query<{ present: boolean }>("select to_regclass('drizzle.__drizzle_migrations') is not null as present");
  if (!exists.rows[0]?.present) return 0;
  const res = await client.query<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations");
  return res.rows[0]?.n ?? 0;
}

async function main(): Promise<void> {
  loadEnvFiles();
  const dirArg = process.argv.slice(2).find((a) => a.startsWith("--dir="));
  const folder = resolve(process.cwd(), dirArg ? dirArg.slice("--dir=".length) : "drizzle");

  const url = env().DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set. Migrations are for a real Postgres database; the embedded development database is synced automatically.");
  if (!existsSync(join(folder, "meta", "_journal.json"))) fail(`no migrations found in ${folder}. Generate them with "npm run db:generate" and commit the result.`);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    const before = await appliedCount(client);
    await migrate(drizzle(client), { migrationsFolder: folder });
    const after = await appliedCount(client);
    console.log(after === before ? `db:migrate: database is up to date (${after} applied earlier)` : `db:migrate: applied ${after - before} new, ${after} in total`);
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    await client.end();
  }
}

main().catch((e) => {
  console.error("db:migrate: failed", e);
  process.exit(1);
});
